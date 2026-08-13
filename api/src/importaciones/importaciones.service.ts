import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Express } from 'express';
import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { SupabaseService } from '../common/supabase.service';

type FilaCsv = Record<string, string | undefined>;

interface PeriodoCsv {
  inicio: string;
  fin: string;
  reintegro?: string;
}

interface IncidenciaPendiente {
  numero_fila: number;
  gravedad: 'advertencia' | 'error';
  codigo_incidencia: string;
  mensaje: string;
  datos_originales: FilaCsv;
}

interface EmpleadoImportacion {
  id: string;
  nombre_completo: string;
}

@Injectable()
export class ImportacionesService {
  constructor(private readonly supabase: SupabaseService) {}

  async importar(archivo: Express.Multer.File) {
    let filas: FilaCsv[];
    try {
      filas = parse(archivo.buffer, {
        bom: true,
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        relax_quotes: true,
        trim: true,
      });
    } catch {
      throw new BadRequestException(
        'No fue posible leer el CSV. Revisa delimitadores, comillas y codificación UTF-8.',
      );
    }
    if (!filas.length)
      throw new BadRequestException('El CSV no contiene filas para importar.');

    const cliente = this.supabase.administrador();
    const db = cliente.schema('vacaciones');
    const hash = createHash('sha256').update(archivo.buffer).digest('hex');

    const { data: organizacion, error: errorOrganizacion } = await db
      .from('organizaciones')
      .select('id')
      .eq('codigo', 'ICSI')
      .single();
    if (errorOrganizacion || !organizacion) {
      throw new UnprocessableEntityException(
        'No existe la organización ICSI. Ejecuta primero el script de base de datos.',
      );
    }

    const { data: loteExistente } = await db
      .from('lotes_importacion')
      .select('id, filas_importadas, filas_rechazadas, estado')
      .eq('organizacion_id', organizacion.id)
      .eq('hash_sha256', hash)
      .in('estado', ['completado', 'completado_con_errores'])
      .maybeSingle();
    const lotePrevio = loteExistente as unknown as {
      id: string;
      filas_importadas: number;
      filas_rechazadas: number;
    } | null;
    if (lotePrevio) {
      return {
        importadas: lotePrevio.filas_importadas,
        rechazadas: lotePrevio.filas_rechazadas,
        mensaje:
          'Este archivo ya había sido importado; no se duplicaron registros.',
        loteId: lotePrevio.id,
      };
    }

    const { data: tipoVacaciones, error: errorTipo } = await db
      .from('tipos_ausencia')
      .select('id')
      .eq('organizacion_id', organizacion.id)
      .eq('codigo', 'VACACIONES')
      .single();
    if (errorTipo || !tipoVacaciones) {
      throw new UnprocessableEntityException(
        'No existe el tipo de ausencia VACACIONES. Ejecuta los datos iniciales del script SQL.',
      );
    }

    const { data: horario } = await db
      .from('horarios_laborales')
      .select('id')
      .eq('organizacion_id', organizacion.id)
      .eq('predeterminado', true)
      .maybeSingle();

    const { data: lote, error: errorLote } = await db
      .from('lotes_importacion')
      .insert({
        organizacion_id: organizacion.id,
        nombre_archivo: archivo.originalname,
        hash_sha256: hash,
        estado: 'procesando',
        total_filas: filas.length,
      })
      .select('id')
      .single();
    if (errorLote || !lote)
      throw new UnprocessableEntityException(
        errorLote?.message ?? 'No fue posible iniciar la importación.',
      );

    const loteRespuesta: unknown = lote;
    if (!this.tieneId(loteRespuesta)) {
      throw new UnprocessableEntityException(
        'Supabase no devolvió el identificador del lote.',
      );
    }
    const loteId = loteRespuesta.id;

    const { data: empleadosIniciales } = await db
      .from('empleados')
      .select('id, nombre_completo')
      .eq('organizacion_id', organizacion.id);
    const empleados = new Map<string, EmpleadoImportacion>();
    for (const empleado of (empleadosIniciales ??
      []) as EmpleadoImportacion[]) {
      empleados.set(this.normalizarTexto(empleado.nombre_completo), empleado);
    }

    const incidencias: IncidenciaPendiente[] = [];
    let importadas = 0;
    let rechazadas = 0;

    try {
      for (let indice = 0; indice < filas.length; indice += 1) {
        const fila = filas[indice];
        const numeroFila = indice + 2;
        const nombre = this.valor(fila, ['nombre', 'nombre completo']);
        const periodos = this.obtenerPeriodos(fila);

        if (!nombre) {
          rechazadas += 1;
          incidencias.push(
            this.incidencia(
              numeroFila,
              'NOMBRE_REQUERIDO',
              'La fila no contiene el nombre del empleado.',
              fila,
            ),
          );
          continue;
        }
        if (!periodos.length) {
          rechazadas += 1;
          incidencias.push(
            this.incidencia(
              numeroFila,
              'PERIODO_REQUERIDO',
              'No se encontró un periodo de vacaciones reconocible.',
              fila,
            ),
          );
          continue;
        }

        let empleado = empleados.get(this.normalizarTexto(nombre));
        if (!empleado) {
          const codigo = `CSV-${createHash('sha1').update(this.normalizarTexto(nombre)).digest('hex').slice(0, 10).toUpperCase()}`;
          const { data: creado, error: errorEmpleado } = await db
            .from('empleados')
            .insert({
              organizacion_id: organizacion.id,
              numero_empleado: codigo,
              nombre_completo: this.capitalizarNombre(nombre),
              horario_laboral_id: horario?.id ?? null,
              origen: 'csv',
              clave_empleado_origen: codigo,
            })
            .select('id, nombre_completo')
            .single();
          if (errorEmpleado || !creado) {
            rechazadas += 1;
            incidencias.push(
              this.incidencia(
                numeroFila,
                'EMPLEADO_NO_REGISTRADO',
                errorEmpleado?.message ??
                  'No fue posible registrar al empleado.',
                fila,
              ),
            );
            continue;
          }
          empleado = creado;
          empleados.set(this.normalizarTexto(nombre), empleado);
        }

        const disponibles = this.numero(
          this.valor(fila, [
            'dias disponibles',
            'cuantos dias de vacaciones tienes disponibles actualmente',
          ]),
        );
        const planeados = this.numero(
          this.valor(fila, [
            'dias a tomar en 2026',
            'total de dias que planea tomar en 2026',
          ]),
        );
        const primerAnio = Number(periodos[0].inicio.slice(0, 4));

        if (disponibles !== null) {
          const { error: errorSaldo } = await db
            .from('asignaciones_ausencia')
            .upsert(
              {
                empleado_id: empleado.id,
                tipo_ausencia_id: tipoVacaciones.id,
                anio_asignacion: primerAnio,
                dias_disponibles: Math.max(0, disponibles),
                fecha_corte_saldo: new Date().toISOString().slice(0, 10),
                notas:
                  'Saldo disponible declarado en importación CSV; no equivale al derecho anual ni al acumulado devengado.',
              },
              { onConflict: 'empleado_id,tipo_ausencia_id,anio_asignacion' },
            );
          if (errorSaldo) {
            incidencias.push(
              this.incidencia(
                numeroFila,
                'SALDO_NO_ACTUALIZADO',
                errorSaldo.message,
                fila,
                'advertencia',
              ),
            );
          }
          await db.from('instantaneas_saldo_ausencia').insert({
            empleado_id: empleado.id,
            tipo_ausencia_id: tipoVacaciones.id,
            anio_saldo: primerAnio,
            fecha_captura: new Date().toISOString().slice(0, 10),
            dias_disponibles_declarados: disponibles,
            dias_planeados_declarados: planeados,
            lote_importacion_id: loteId,
            numero_fila_origen: numeroFila,
            datos_originales: fila,
          });
        }

        let filaValida = true;
        for (
          let indicePeriodo = 0;
          indicePeriodo < periodos.length;
          indicePeriodo += 1
        ) {
          const periodo = periodos[indicePeriodo];
          if (periodo.fin < periodo.inicio) {
            filaValida = false;
            incidencias.push(
              this.incidencia(
                numeroFila,
                'RANGO_INVERTIDO',
                `La fecha final ${periodo.fin} es anterior al inicio ${periodo.inicio}.`,
                fila,
              ),
            );
            continue;
          }
          if (periodo.reintegro && periodo.reintegro <= periodo.fin) {
            filaValida = false;
            incidencias.push(
              this.incidencia(
                numeroFila,
                'REINTEGRO_INVALIDO',
                'La fecha de reintegro debe ser posterior al final de las vacaciones.',
                fila,
              ),
            );
            continue;
          }
          const claveOrigen = `${hash}:${numeroFila}:${indicePeriodo + 1}`;
          const { error: errorSolicitud } = await db
            .from('solicitudes_ausencia')
            .upsert(
              {
                organizacion_id: organizacion.id,
                empleado_id: empleado.id,
                tipo_ausencia_id: tipoVacaciones.id,
                estado: 'planeada',
                fecha_inicio: periodo.inicio,
                fecha_fin: periodo.fin,
                fecha_reintegro: periodo.reintegro ?? null,
                comentarios:
                  this.valor(fila, ['comentarios', 'comentarios opcional']) ||
                  null,
                origen: 'csv',
                lote_importacion_id: loteId,
                numero_fila_origen: numeroFila,
                clave_registro_origen: claveOrigen,
                datos_originales: fila,
              },
              {
                onConflict: 'organizacion_id,clave_registro_origen',
                ignoreDuplicates: true,
              },
            );
          if (errorSolicitud) {
            filaValida = false;
            incidencias.push(
              this.incidencia(
                numeroFila,
                'SOLICITUD_NO_REGISTRADA',
                errorSolicitud.message,
                fila,
              ),
            );
          }
        }
        if (filaValida) importadas += 1;
        else rechazadas += 1;
      }

      if (incidencias.length) {
        await db.from('incidencias_importacion').insert(
          incidencias.map((incidencia) => ({
            lote_importacion_id: loteId,
            ...incidencia,
          })),
        );
      }
      const estado = rechazadas ? 'completado_con_errores' : 'completado';
      await db
        .from('lotes_importacion')
        .update({
          estado,
          filas_importadas: importadas,
          filas_rechazadas: rechazadas,
          importado_en: new Date().toISOString(),
        })
        .eq('id', loteId);

      return {
        importadas,
        rechazadas,
        mensaje: rechazadas
          ? 'Importación terminada con incidencias.'
          : 'Importación completada correctamente.',
        loteId,
      };
    } catch (error) {
      await db
        .from('lotes_importacion')
        .update({
          estado: 'fallido',
          notas:
            error instanceof Error
              ? error.message
              : 'Error inesperado durante la importación.',
        })
        .eq('id', loteId);
      throw new UnprocessableEntityException(
        error instanceof Error
          ? error.message
          : 'La importación no pudo completarse.',
      );
    }
  }

  private obtenerPeriodos(fila: FilaCsv): PeriodoCsv[] {
    const inicio = this.fecha(this.valor(fila, ['inicio']));
    const fin = this.fecha(this.valor(fila, ['fin']));
    const reintegro = this.fecha(this.valor(fila, ['reintegro']));
    if (inicio && fin)
      return [{ inicio, fin, ...(reintegro ? { reintegro } : {}) }];

    const texto = this.valor(fila, ['periodos de vacaciones']);
    if (!texto) return [];
    const periodos: PeriodoCsv[] = [];
    const patron =
      /(?:Desde|Fecha de inicio)\s*:\s*([0-9]{2}[-/][0-9]{2}[-/][0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})\s*,?\s*(?:Hasta|Fecha de fin)\s*:\s*([0-9]{2}[-/][0-9]{2}[-/][0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})(?:\s*,?\s*Reintegro\s*:\s*([0-9]{2}[-/][0-9]{2}[-/][0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2}))?/gim;
    let coincidencia: RegExpExecArray | null;
    while ((coincidencia = patron.exec(texto)) !== null) {
      const fechaInicio = this.fecha(coincidencia[1]);
      const fechaFin = this.fecha(coincidencia[2]);
      const fechaReintegro = this.fecha(coincidencia[3]);
      if (fechaInicio && fechaFin) {
        periodos.push({
          inicio: fechaInicio,
          fin: fechaFin,
          ...(fechaReintegro ? { reintegro: fechaReintegro } : {}),
        });
      }
    }
    return periodos;
  }

  private valor(fila: FilaCsv, candidatos: string[]): string {
    for (const [clave, valor] of Object.entries(fila)) {
      const normalizada = this.normalizarTexto(clave);
      if (
        candidatos.some(
          (candidato) =>
            normalizada === candidato || normalizada.includes(candidato),
        )
      ) {
        return String(valor ?? '').trim();
      }
    }
    return '';
  }

  private fecha(valor?: string): string | null {
    if (!valor) return null;
    const limpio = valor.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(limpio)) return limpio;
    const partes = limpio.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (!partes) return null;
    const [, dia, mes, anio] = partes;
    return `${anio}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  }

  private numero(valor?: string): number | null {
    if (!valor) return null;
    const resultado = Number(valor.replace(',', '.'));
    return Number.isFinite(resultado) ? resultado : null;
  }

  private normalizarTexto(valor: string): string {
    return valor
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private capitalizarNombre(nombre: string): string {
    return nombre
      .trim()
      .toLocaleLowerCase('es-MX')
      .replace(/(^|\s)\p{L}/gu, (letra) => letra.toLocaleUpperCase('es-MX'));
  }

  private tieneId(valor: unknown): valor is { id: string } {
    return (
      typeof valor === 'object' &&
      valor !== null &&
      'id' in valor &&
      typeof valor.id === 'string'
    );
  }

  private incidencia(
    numeroFila: number,
    codigo: string,
    mensaje: string,
    fila: FilaCsv,
    gravedad: 'advertencia' | 'error' = 'error',
  ): IncidenciaPendiente {
    return {
      numero_fila: numeroFila,
      gravedad,
      codigo_incidencia: codigo,
      mensaje,
      datos_originales: fila,
    };
  }
}
