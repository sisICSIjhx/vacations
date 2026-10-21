import type { DatosVacaciones, EdicionSolicitud, PerfilUsuario, RevisionSolicitud, SolicitudAusencia } from "../types.ts";

export interface EventoActividad {
  id: string;
  ocurridoEn: string;
  actor: string;
  actorId?: string;
  modulo: string;
  entidad: string;
  registroId: string;
  solicitudId?: string;
  empleadoId?: string;
  sujeto: string;
  accion: string;
  motivo?: string;
  anteriores: Record<string, unknown>;
  nuevos: Record<string, unknown>;
  recuperado?: boolean;
}

export interface FiltrosHistorial { texto?: string; modulo?: string; desde?: string; hasta?: string; solicitudId?: string; pagina?: number }
export interface PaginaHistorial { eventos: EventoActividad[]; hayMas: boolean }
export type ConsultarHistorial = (filtros: FiltrosHistorial) => Promise<PaginaHistorial>;
export const TAMANO_PAGINA = 30;
export const MODULOS: Record<string, string> = { solicitudes: "Solicitudes", personal: "Personal", saldos: "Saldos", catalogos: "Catálogos", festivos: "Días festivos", accesos: "Accesos", importaciones: "Importaciones" };
export const ACCIONES: Record<string, string> = {
  creacion: "Registro creado", actualizacion: "Información actualizada", eliminacion: "Registro eliminado", restauracion: "Registro restaurado",
  aprobacion: "Solicitud aprobada", rechazo: "Solicitud rechazada", cancelacion: "Solicitud cancelada",
  edicion_solicitada: "Edición solicitada", edicion_aplicada: "Edición aplicada", edicion_rechazada: "Edición rechazada",
  acceso_actualizado: "Configuración de acceso actualizada", contrasena_restablecida: "Contraseña restablecida", contrasena_cambiada: "Contraseña cambiada",
};
const CAMPOS: Record<string, string> = {
  estado: "Estado", fecha_inicio: "Inicio", fecha_fin: "Fin", fecha_reintegro: "Reintegro", fechaInicio: "Inicio", fechaFin: "Fin", fechaReintegro: "Reintegro",
  fecha_inicio_propuesta: "Inicio propuesto", fecha_fin_propuesta: "Fin propuesto", fecha_reintegro_propuesta: "Reintegro propuesto",
  etapa: "Etapa", etapa_aprobacion: "Etapa de aprobación", etapaAprobacion: "Etapa de aprobación", etapa_rechazo: "Etapa de rechazo", etapaRechazo: "Etapa de rechazo", decision: "Decisión", estado_resultante: "Estado resultante",
  dias: "Días", diasDisponibles: "Días disponibles", diasTomados: "Días tomados", diasPorDerecho: "Días por derecho", diasAcumulados: "Días acumulados", diasPlaneados: "Días planeados", diasPendientes: "Días pendientes", fechaCorte: "Fecha de corte", registrado: "Saldo registrado",
  dias_disponibles: "Días disponibles", dias_por_derecho: "Días por derecho", dias_acumulados_a_fecha: "Días acumulados", dias_transferidos: "Días transferidos", ajuste_dias: "Ajuste de días", dias_utilizados_antes_sistema: "Días usados antes del sistema", anio_asignacion: "Año", fecha_corte_saldo: "Fecha de corte",
  nombre: "Nombre", nombre_completo: "Nombre", nombre_visible: "Nombre visible", numeroEmpleado: "Número de empleado", numero_empleado: "Número de empleado", correo: "Correo", correo_electronico: "Correo", telefonoWhatsapp: "WhatsApp", telefono_whatsapp: "WhatsApp", color_calendario: "Color del calendario", curp: "CURP", nss: "NSS",
  sede: "Sede", sede_id: "Sede", proyecto: "Proyecto", proyecto_id: "Proyecto", categoria: "Categoría", categoria_id: "Categoría", jefeInmediato: "Jefe inmediato", jefe_inmediato_id: "Jefe inmediato", empleado_id: "Empleado",
  fechaIngreso: "Fecha de ingreso", fecha_ingreso: "Fecha de ingreso", diaDescanso: "Día de descanso", dia_descanso: "Día de descanso", comentarios: "Comentarios", comentario: "Comentario", motivo: "Motivo", respuesta: "Respuesta",
  motivo_cancelacion: "Motivo de cancelación", cancelado_en: "Fecha de cancelación", cancelado_por_nombre: "Canceló", eliminado_en: "Fecha de eliminación", motivo_eliminacion: "Motivo de eliminación", valores_anteriores: "Periodo anterior", valores_nuevos: "Periodo nuevo",
  saldo: "Saldo", propuesta: "Periodo propuesto", anterior: "Periodo anterior", nuevo: "Periodo nuevo", fecha: "Fecha", repeticion: "Repetición", rol: "Rol", activo: "Acceso activo", color: "Color", codigo: "Código", descripcion: "Descripción",
  registroExtemporaneo: "Registro extemporáneo", registro_extemporaneo: "Registro extemporáneo", descontar_saldo: "Descontar saldo", anio: "Año", nombre_archivo: "Archivo", total_filas: "Filas totales", filas_importadas: "Filas importadas", filas_rechazadas: "Filas rechazadas",
  permitirCambioContrasena: "Permitir cambio de contraseña", forzarCambioContrasena: "Solicitar cambio de contraseña", correoInicioSesion: "Correo de inicio de sesión",
};
const VALORES: Record<string, string> = { rrhh: "RRHH", jefe_inmediato: "Jefe inmediato", mesa_directiva: "Mesa Directiva", administrador: "Administración", empleado: "Empleado", aprobada: "Aprobada", aprobado: "Aprobado", rechazada: "Rechazada", rechazado: "Rechazado", cancelada: "Cancelada", pendiente: "Pendiente", planeada: "Planeada", activo: "Activo", inactivo: "Inactivo", aplicada: "Aplicada", ninguna: "Sin repetición" };
export function nombreCampo(campo: string) { return CAMPOS[campo] ?? campo.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"); }
export function valorLegible(valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "Sin dato";
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  if (typeof valor === "object") return Object.entries(valor).map(([k,v]) => `${nombreCampo(k)}: ${valorLegible(v)}`).join(" · ");
  const texto = String(valor);
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto.split("-").reverse().join("/");
  if (/^\d{4}-\d{2}-\d{2}T/.test(texto) && !Number.isNaN(Date.parse(texto))) return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" }).format(new Date(texto));
  return VALORES[texto] ?? texto;
}
export function tituloEvento(evento: EventoActividad) {
  const etapa = evento.nuevos.etapa;
  if (evento.accion === "cancelacion" && (evento.anteriores.estado === "aprobada" || evento.nuevos.cancelado_en)) return "Días cancelados y reintegrados";
  return `${ACCIONES[evento.accion] ?? "Registro actualizado"}${etapa ? ` · ${valorLegible(etapa)}` : ""}`;
}

interface CampoDetalleActividad {
  clave: string;
  etiqueta: string;
  valor: string;
  anterior?: string;
}

// Una decisión registra un hecho; solo las modificaciones con evidencia de
// ambos valores se pueden presentar como una comparación.
export function detalleActividad(evento: EventoActividad): { titulo: string; nota?: string; campos: CampoDetalleActividad[] } {
  const esModificacion = ["actualizacion", "edicion_aplicada", "restauracion", "cancelacion"].includes(evento.accion);
  const anteriores = { ...evento.anteriores };
  const nuevos = { ...evento.nuevos };
  for (const [origen, destino] of [["valores_anteriores", anteriores], ["anterior", anteriores], ["valores_nuevos", nuevos], ["nuevo", nuevos]] as const) {
    const periodo = evento.nuevos[origen];
    if (periodo && typeof periodo === "object" && !Array.isArray(periodo)) Object.assign(destino, periodo);
    delete anteriores[origen];
    delete nuevos[origen];
  }
  const aplanar = (datos: Record<string, unknown>, prefijo = ""): Record<string, unknown> => Object.fromEntries(Object.entries(datos).flatMap(([campo, valor]) => {
    const clave = prefijo ? `${prefijo}.${campo}` : campo;
    if (valor && typeof valor === "object" && !Array.isArray(valor)) return Object.entries(aplanar(valor as Record<string, unknown>, ["periodo", "propuesta"].includes(campo) ? prefijo : clave));
    return [[clave, valor]];
  }));
  const antes = aplanar(anteriores), despues = aplanar(nuevos);
  const vacio = (valor: unknown) => valor === null || valor === undefined || (typeof valor === "string" && !valor.trim());
  const campos = [...new Set([...Object.keys(antes), ...Object.keys(despues)])].flatMap<CampoDetalleActividad>(clave => {
    const previo = antes[clave], valor = despues[clave];
    if (vacio(previo) && vacio(valor)) return [];
    if (["motivo", "respuesta", "comentario", "motivo_cancelacion", "motivo_eliminacion"].includes(clave) && valor === evento.motivo) return [];
    // Autor y fecha ya se muestran en el encabezado del movimiento.
    if (["cancelado_en", "cancelado_por_nombre"].includes(clave)) return [];
    const parte = clave.split(".").at(-1)!;
    let etiqueta = clave.split(".").map(nombreCampo).join(" · ");
    if (clave === "estado_resultante") etiqueta = "Situación después de la revisión";
    if (evento.accion === "creacion" && clave === "estado") etiqueta = "Estado inicial";
    const legible = (dato: unknown) => clave === "estado_resultante" && ["rrhh", "jefe_inmediato", "mesa_directiva"].includes(String(dato))
      ? `Pendiente de revisión por ${valorLegible(dato)}`
      : vacio(dato) ? "Sin asignar" : valorLegible(dato);
    if (evento.accion === "edicion_solicitada" && ["fechaInicio", "fechaFin", "fechaReintegro"].includes(parte)) etiqueta += " propuesto";
    const tieneAntes = Object.hasOwn(antes, clave), tieneDespues = Object.hasOwn(despues, clave);
    if (esModificacion && tieneAntes && tieneDespues && JSON.stringify(previo) !== JSON.stringify(valor)) {
      return [{ clave, etiqueta, anterior: legible(previo), valor: legible(valor) }];
    }
    if (esModificacion && tieneAntes && tieneDespues) return [];
    // La ausencia de una clave no prueba que antes estuviera vacía.
    return [{ clave, etiqueta, valor: legible(tieneDespues ? valor : previo) }];
  });
  const comparables = campos.some(campo => campo.anterior !== undefined);
  const titulos: Record<string, string> = { aprobacion: "Datos de la aprobación", rechazo: "Datos del rechazo", edicion_solicitada: "Periodo propuesto", creacion: "Datos del registro creado", eliminacion: "Datos del registro eliminado", edicion_rechazada: "Datos de la edición rechazada", cancelacion: "Datos de la cancelación" };
  return {
    titulo: comparables ? "Qué cambió" : titulos[evento.accion] ?? "Información registrada",
    nota: esModificacion && campos.length > 0 && !comparables ? "Este registro conserva estos datos, pero no un valor anterior que permita compararlos." : undefined,
    campos,
  };
}
export function eventoDesdeFila(f: Record<string, unknown>): EventoActividad {
  return { id: String(f.id), ocurridoEn: String(f.ocurrido_en), actor: String(f.actor_nombre), modulo: String(f.modulo), entidad: String(f.entidad), registroId: String(f.registro_id), solicitudId: f.solicitud_id ? String(f.solicitud_id) : undefined, empleadoId: f.empleado_id ? String(f.empleado_id) : undefined, sujeto: String(f.sujeto), accion: String(f.accion), motivo: f.motivo ? String(f.motivo) : undefined, anteriores: (f.anteriores ?? {}) as Record<string, unknown>, nuevos: (f.nuevos ?? {}) as Record<string, unknown>, recuperado: Boolean(f.recuperado) };
}

export function historialSolicitudExistente(s: SolicitudAusencia, revisiones: RevisionSolicitud[], ediciones: EdicionSolicitud[]): EventoActividad[] {
  const base = { modulo: "solicitudes", entidad: "solicitudes_ausencia", registroId: s.id, solicitudId: s.id, empleadoId: s.empleadoId, sujeto: `${s.nombreEmpleado} · ${valorLegible(s.fechaInicio)} al ${valorLegible(s.fechaFin)}`, anteriores: {}, nuevos: {} };
  const eventos: EventoActividad[] = [];
  if (s.fechaSolicitud) eventos.push({ ...base, id: `creacion:${s.id}`, ocurridoEn: s.fechaSolicitud, actor: "Autor no registrado", accion: "creacion" });
  for (const r of revisiones) eventos.push({ ...base, id: `revision:${r.id}`, ocurridoEn: r.creadoEn, actor: r.nombreRevisor || "Autor no registrado", accion: r.decision === "aprobado" ? "aprobacion" : "rechazo", motivo: r.comentario, nuevos: { etapa: r.etapa, estado_resultante: r.estadoResultante } });
  for (const e of ediciones) {
    eventos.push({ ...base, id: `edicion-pedido:${e.id}`, ocurridoEn: e.solicitadoEn, actor: e.solicitadoPor || "Autor no registrado", accion: "edicion_solicitada", motivo: e.motivo, nuevos: { propuesta: e.propuesta } });
    if (e.resueltoEn) eventos.push({ ...base, id: `edicion-respuesta:${e.id}`, ocurridoEn: e.resueltoEn, actor: e.resueltoPor || "Autor no registrado", accion: e.estado === "aplicada" ? "edicion_aplicada" : "edicion_rechazada", motivo: e.respuesta, anteriores: e.anterior ? { periodo: e.anterior } : {}, nuevos: e.nuevo ? { periodo: e.nuevo } : {} });
  }
  if (s.estado === "cancelada" || s.cancelacion) eventos.push({ ...base, id: `cancelacion:${s.id}`, ocurridoEn: s.cancelacion?.canceladoEn ?? "", actor: s.cancelacion?.canceladoPor || "Autor no registrado", accion: "cancelacion", motivo: s.cancelacion?.motivo || "Motivo no registrado", anteriores: s.cancelacion ? { estado: "aprobada" } : {}, nuevos: { estado: "cancelada" } });
  return eventos.sort(ordenarEventos);
}
export function ordenarEventos(a: EventoActividad, b: EventoActividad) { return b.ocurridoEn.localeCompare(a.ocurridoEn) || b.id.localeCompare(a.id, undefined, { numeric: true }); }
export function puedeVerEvento(e: EventoActividad, perfil: PerfilUsuario | null, datos: DatosVacaciones) {
  if (!perfil?.activo) return false;
  if (perfil.rol === "administrador") return true;
  if (perfil.rol === "rrhh") return e.modulo !== "accesos";
  if (perfil.rol === "mesa_directiva" && e.modulo === "saldos") return true;
  if (e.modulo !== "solicitudes") return false;
  if (perfil.rol === "mesa_directiva") return true;
  return !!e.empleadoId && (e.empleadoId === perfil.empleadoId || (perfil.esJefeInmediato && datos.empleados.some(emp => emp.id === e.empleadoId && emp.jefeInmediatoId === perfil.empleadoId)));
}
export function filtrarHistorial(eventos: EventoActividad[], filtros: FiltrosHistorial): PaginaHistorial {
  const texto = (filtros.texto ?? "").toLocaleLowerCase("es");
  const resultados = eventos.filter(e => (!filtros.solicitudId || e.solicitudId === filtros.solicitudId) && (!filtros.modulo || e.modulo === filtros.modulo)
    && (!filtros.desde || Date.parse(e.ocurridoEn) >= Date.parse(`${filtros.desde}T00:00:00-06:00`))
    && (!filtros.hasta || Date.parse(e.ocurridoEn) <= Date.parse(`${filtros.hasta}T23:59:59.999-06:00`))
    && (!texto || `${e.actor} ${e.sujeto} ${tituloEvento(e)} ${e.motivo ?? ""}`.toLocaleLowerCase("es").includes(texto))).sort(ordenarEventos);
  const desde = (filtros.pagina ?? 0) * TAMANO_PAGINA;
  return { eventos: resultados.slice(desde, desde + TAMANO_PAGINA), hayMas: resultados.length > desde + TAMANO_PAGINA };
}

// Actualizador puro para demo: el historial forma parte del mismo estado que los datos.
export function cambiosDemo(antes: DatosVacaciones, despues: DatosVacaciones, actor: string, fecha: string): EventoActividad[] {
  const eventos: EventoActividad[] = [];
  const grupos = { empleados: "personal", solicitudes: "solicitudes", ediciones: "solicitudes", sedes: "catalogos", proyectos: "catalogos", categorias: "catalogos", tiposAusencia: "catalogos", diasFestivos: "festivos" } as const;
  const omitidos = new Set(["id","curp","nss","organizacionId","empleadoId","solicitudId","colorEmpleado","nombreEmpleado","sedeId","proyectoId","categoriaId","tipoAusenciaId","jefeInmediatoId","solicitadoEn","solicitadoPor","resueltoEn","resueltoPor","fechaSolicitud","cancelacion"]);
  for (const [grupo, modulo] of Object.entries(grupos)) {
    const clave = grupo as keyof typeof grupos;
    const previos = new Map(antes[clave].map(item => [item.id, item as unknown as Record<string, unknown>]));
    const nuevos = new Map(despues[clave].map(item => [item.id, item as unknown as Record<string, unknown>]));
    for (const id of new Set([...previos.keys(), ...nuevos.keys()])) {
      const a = previos.get(id), b = nuevos.get(id), fila = (b ?? a)!;
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      const anteriores: Record<string, unknown> = {}, valores: Record<string, unknown> = {};
      for (const campo of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
        if (JSON.stringify(a?.[campo]) === JSON.stringify(b?.[campo])) continue;
        if (campo === "curp" || campo === "nss") {
          anteriores[campo] = "Valor reservado"; valores[campo] = "Dato actualizado (valor reservado)"; continue;
        }
        if (omitidos.has(campo)) continue;
        if (a?.[campo] !== undefined) anteriores[campo] = a[campo];
        if (b?.[campo] !== undefined) valores[campo] = b[campo];
      }
      let accion = !a ? "creacion" : !b ? "eliminacion" : "actualizacion";
      let motivo: string | undefined;
      if (grupo === "solicitudes" && a?.estado !== "cancelada" && b?.estado === "cancelada") { accion = "cancelacion"; motivo = (b.cancelacion as SolicitudAusencia["cancelacion"])?.motivo; }
      if (grupo === "ediciones") { accion = !a ? "edicion_solicitada" : b?.estado === "aplicada" ? "edicion_aplicada" : "edicion_rechazada"; motivo = String(b?.respuesta ?? b?.motivo ?? ""); }
      const empleadoId = grupo === "empleados" ? id : fila.empleadoId as string | undefined;
      const solicitudId = grupo === "solicitudes" ? id : fila.solicitudId as string | undefined;
      const empleado = despues.empleados.find(e => e.id === empleadoId) ?? antes.empleados.find(e => e.id === empleadoId);
      const sujeto = String(empleado?.nombre ?? fila.nombre ?? "Registro operativo") + (grupo === "solicitudes" ? ` · ${valorLegible(fila.fechaInicio)} al ${valorLegible(fila.fechaFin)}` : "");
      const base = { ocurridoEn: fecha, actor, entidad: grupo, registroId: id, empleadoId, solicitudId, sujeto, accion, motivo };
      if (grupo === "empleados" && (anteriores.saldo || valores.saldo)) {
        eventos.push({ ...base, id: `demo:${fecha}:saldo:${id}`, modulo: "saldos", anteriores: (anteriores.saldo ?? {}) as Record<string, unknown>, nuevos: (valores.saldo ?? {}) as Record<string, unknown> });
        delete anteriores.saldo; delete valores.saldo;
      }
      if (Object.keys(anteriores).length || Object.keys(valores).length) eventos.push({ ...base, id: `demo:${fecha}:${grupo}:${id}`, modulo, anteriores, nuevos: valores });
    }
  }
  return eventos;
}
