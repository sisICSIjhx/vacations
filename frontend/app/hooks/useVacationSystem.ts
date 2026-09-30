"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { datosDemostracion, revisionesDemostracion } from "../data/demo";
import { obtenerSupabase, supabaseConfigurado } from "../lib/supabase";
import { comentarioConUrgencia, separarUrgencia } from "../lib/urgente";
import { siguienteDiaHabil } from "../lib/diaHabil";
import type {
  Catalogo,
  DatosVacaciones,
  DecisionRevision,
  Empleado,
  EmpleadoFormulario,
  EstadoSolicitud,
  EtapaAprobacion,
  RevisionSolicitud,
  SolicitudAusencia,
  SolicitudFormulario,
} from "../types";

type TipoCatalogo = "sedes" | "proyectos" | "categorias";

const copiarDemo = (): DatosVacaciones => structuredClone(datosDemostracion);

const ANTICIPACION_MINIMA_DIAS = 15;

// Refleja exactamente la secuencia obligatoria RRHH -> Jefe inmediato -> Mesa
// Directiva que hace cumplir vacaciones.revisar_solicitud en la base de datos.
// Se usa solo en modo demostracion (sin Supabase) para poder probar el flujo
// completo de punta a punta sin una base real.
function siguienteEtapa(etapa: EtapaAprobacion, decision: DecisionRevision, tieneJefe: boolean): { etapa: EtapaAprobacion; estado: EstadoSolicitudResultante } {
  if (decision === "rechazado") return { etapa: "rechazada", estado: "rechazada" };
  if (etapa === "mesa_directiva") return { etapa: "aprobada", estado: "aprobada" };
  if (etapa === "rrhh") return { etapa: tieneJefe ? "jefe_inmediato" : "mesa_directiva", estado: "pendiente" };
  return { etapa: "mesa_directiva", estado: "pendiente" };
}

type EstadoSolicitudResultante = "pendiente" | "aprobada" | "rechazada";

function codigoDesdeNombre(nombre: string) {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24);
}

export function useVacationSystem(habilitado: boolean, anio: number) {
  const [datos, setDatos] = useState<DatosVacaciones>(() => copiarDemo());
  const [cargando, setCargando] = useState(supabaseConfigurado);
  const [error, setError] = useState<string | null>(null);
  const [actualizando, setActualizando] = useState(false);

  const cargarDesdeSupabase = useCallback(async () => {
    const supabase = obtenerSupabase();
    if (!supabase || !habilitado) return;

    setCargando(true);
    setError(null);
    const db = supabase.schema("vacaciones");
    const desde = `${anio}-01-01`;
    const hasta = `${anio}-12-31`;

    const [
      empleadosResultado,
      saldosResultado,
      calendarioResultado,
      festivosResultado,
      sedesResultado,
      proyectosResultado,
      categoriasResultado,
      tiposResultado,
    ] = await Promise.all([
      db.from("empleados").select("*").is("eliminado_en", null).order("nombre_completo"),
      db.from("v_saldo_vacaciones_empleado").select("*").eq("anio_asignacion", anio),
      db.from("v_dias_solicitud_calendario").select("*").gte("fecha_calendario", desde).lte("fecha_calendario", hasta),
      db.from("dias_festivos").select("*").gte("fecha", desde).lte("fecha", hasta).order("fecha"),
      db.from("sedes").select("id,codigo,nombre").eq("activo", true).is("eliminado_en", null).order("nombre"),
      db.from("proyectos").select("id,codigo,nombre").eq("activo", true).is("eliminado_en", null).order("nombre"),
      db.from("categorias_empleado").select("id,codigo,nombre,color").eq("activo", true).is("eliminado_en", null).order("nombre"),
      db.from("tipos_ausencia").select("id,codigo,nombre,color").eq("activo", true).is("eliminado_en", null).order("nombre"),
    ]);

    const resultados = [
      empleadosResultado,
      saldosResultado,
      calendarioResultado,
      festivosResultado,
      sedesResultado,
      proyectosResultado,
      categoriasResultado,
      tiposResultado,
    ];
    const primerError = resultados.find((resultado) => resultado.error)?.error;
    if (primerError) {
      setError(primerError.message);
      setCargando(false);
      return;
    }

    const sedes = (sedesResultado.data ?? []) as Catalogo[];
    const proyectos = (proyectosResultado.data ?? []) as Catalogo[];
    const categorias = (categoriasResultado.data ?? []) as Catalogo[];
    const tiposAusencia = (tiposResultado.data ?? []) as Catalogo[];
    const sedePorId = new Map(sedes.map((item) => [item.id, item.nombre]));
    const proyectoPorId = new Map(proyectos.map((item) => [item.id, item.nombre]));
    const categoriaPorId = new Map(categorias.map((item) => [item.id, item.nombre]));
    const saldoPorEmpleado = new Map((saldosResultado.data ?? []).map((saldo: Record<string, unknown>) => [String(saldo.empleado_id), saldo]));
    const nombrePorEmpleado = new Map(
      (empleadosResultado.data ?? []).map((fila: Record<string, unknown>) => [String(fila.id), String(fila.nombre_completo)]),
    );

    const empleados: Empleado[] = (empleadosResultado.data ?? []).map((fila: Record<string, unknown>) => {
      const saldo = saldoPorEmpleado.get(String(fila.id)) as Record<string, unknown> | undefined;
      const jefeInmediatoId = fila.jefe_inmediato_id ? String(fila.jefe_inmediato_id) : undefined;
      return {
        id: String(fila.id),
        organizacionId: String(fila.organizacion_id),
        numeroEmpleado: String(fila.numero_empleado),
        nombre: String(fila.nombre_completo),
        correo: fila.correo_electronico ? String(fila.correo_electronico) : undefined,
        telefonoWhatsapp: fila.telefono_whatsapp ? String(fila.telefono_whatsapp) : undefined,
        curp: fila.curp ? String(fila.curp) : undefined,
        nss: fila.nss ? String(fila.nss) : undefined,
        color: String(fila.color_calendario ?? "#2563EB"),
        sedeId: fila.sede_id ? String(fila.sede_id) : undefined,
        sede: sedePorId.get(String(fila.sede_id)) ?? "Sin sede",
        proyectoId: fila.proyecto_id ? String(fila.proyecto_id) : undefined,
        proyecto: proyectoPorId.get(String(fila.proyecto_id)) ?? "Sin proyecto",
        categoriaId: fila.categoria_id ? String(fila.categoria_id) : undefined,
        categoria: categoriaPorId.get(String(fila.categoria_id)) ?? "Sin categoría",
        fechaIngreso: fila.fecha_ingreso ? String(fila.fecha_ingreso) : undefined,
        estado: fila.estado === "inactivo" ? "inactivo" : "activo",
        jefeInmediatoId,
        jefeInmediato: jefeInmediatoId ? nombrePorEmpleado.get(jefeInmediatoId) : undefined,
        saldo: {
          anio,
          diasPorDerecho: Number(saldo?.dias_por_derecho ?? 0),
          diasAcumulados: Number(saldo?.dias_acumulados_a_fecha ?? 0),
          diasDisponibles: Number(saldo?.dias_disponibles ?? 0),
          diasTomados: Number(saldo?.dias_tomados_anio ?? 0),
          diasPlaneados: Number(saldo?.dias_planeados ?? 0),
          diasPendientes: Number(saldo?.dias_pendientes ?? 0),
          fechaCorte: String(saldo?.fecha_corte_saldo ?? `${anio}-01-01`),
        },
      };
    });

    const solicitudesPorId = new Map<string, SolicitudAusencia>();
    for (const fila of calendarioResultado.data ?? []) {
      const id = String(fila.solicitud_ausencia_id);
      const actual = solicitudesPorId.get(id);
      if (!actual) {
        solicitudesPorId.set(id, {
          id,
          organizacionId: String(fila.organizacion_id),
          empleadoId: String(fila.empleado_id),
          tipoAusenciaId: String(fila.tipo_ausencia_id),
          nombreEmpleado: String(fila.nombre_completo),
          colorEmpleado: String(fila.color_calendario ?? "#2563EB"),
          fechaSolicitud: fila.solicitado_en ? String(fila.solicitado_en) : undefined,
          fechaInicio: String(fila.fecha_inicio),
          fechaFin: String(fila.fecha_fin),
          fechaReintegro: fila.fecha_reintegro ? String(fila.fecha_reintegro) : undefined,
          estado: fila.estado as EstadoSolicitud,
          etapaAprobacion: (fila.etapa_aprobacion as SolicitudAusencia["etapaAprobacion"]) ?? "rrhh",
          etapaRechazo: fila.etapa_rechazo ? (fila.etapa_rechazo as SolicitudAusencia["etapaRechazo"]) : undefined,
          dias: Number(fila.dias_descontados ?? 0),
          comentarios: fila.comentarios ? String(fila.comentarios) : undefined,
          origen: fila.origen as SolicitudAusencia["origen"],
        });
      } else {
        actual.dias += Number(fila.dias_descontados ?? 0);
      }
    }

    setDatos({
      empleados,
      solicitudes: [...solicitudesPorId.values()],
      diasFestivos: (festivosResultado.data ?? []).map((fila: Record<string, unknown>) => ({
        id: String(fila.id),
        fecha: String(fila.fecha),
        nombre: String(fila.nombre),
        sedeId: fila.sede_id ? String(fila.sede_id) : undefined,
      })),
      sedes,
      proyectos,
      categorias,
      tiposAusencia,
    });
    setCargando(false);
  }, [anio, habilitado]);

  useEffect(() => {
    if (!supabaseConfigurado || !habilitado) return;
    const temporizador = window.setTimeout(() => void cargarDesdeSupabase(), 0);
    return () => window.clearTimeout(temporizador);
  }, [cargarDesdeSupabase, habilitado]);

  const guardarEmpleado = useCallback(async (formulario: EmpleadoFormulario) => {
    setActualizando(true);
    setError(null);
    const supabase = obtenerSupabase();
    if (!supabase) {
      setDatos((actual) => {
        const existente = formulario.id ? actual.empleados.find((item) => item.id === formulario.id) : undefined;
        const sede = actual.sedes.find((item) => item.id === formulario.sedeId)?.nombre ?? "Sin sede";
        const proyecto = actual.proyectos.find((item) => item.id === formulario.proyectoId)?.nombre ?? "Sin proyecto";
        const categoria = actual.categorias.find((item) => item.id === formulario.categoriaId)?.nombre ?? "Sin categoría";
        const jefeInmediato = actual.empleados.find((item) => item.id === formulario.jefeInmediatoId)?.nombre;
        const empleado: Empleado = {
          id: formulario.id ?? `emp-${Date.now()}`,
          organizacionId: existente?.organizacionId ?? "org-icsi",
          numeroEmpleado: formulario.numeroEmpleado,
          nombre: formulario.nombre,
          correo: formulario.correo || undefined,
          telefonoWhatsapp: formulario.telefonoWhatsapp || undefined,
          curp: formulario.curp || undefined,
          nss: formulario.nss || undefined,
          color: formulario.color,
          sedeId: formulario.sedeId || undefined,
          sede,
          proyectoId: formulario.proyectoId || undefined,
          proyecto,
          categoriaId: formulario.categoriaId || undefined,
          categoria,
          fechaIngreso: formulario.fechaIngreso || undefined,
          estado: existente?.estado ?? "activo",
          jefeInmediatoId: formulario.jefeInmediatoId || undefined,
          jefeInmediato,
          saldo: {
            anio,
            diasPorDerecho: formulario.diasPorDerecho,
            diasAcumulados: formulario.diasAcumulados,
            diasDisponibles: formulario.diasDisponibles,
            diasTomados: existente?.saldo.diasTomados ?? 0,
            diasPlaneados: existente?.saldo.diasPlaneados ?? 0,
            diasPendientes: existente?.saldo.diasPendientes ?? 0,
            fechaCorte: new Date().toISOString().slice(0, 10),
          },
        };
        return {
          ...actual,
          empleados: existente
            ? actual.empleados.map((item) => (item.id === empleado.id ? empleado : item))
            : [...actual.empleados, empleado],
        };
      });
      setActualizando(false);
      return true;
    }

    const db = supabase.schema("vacaciones");
    const { data: organizacion } = datos.empleados[0]?.organizacionId
      ? { data: { id: datos.empleados[0].organizacionId } }
      : await db.from("organizaciones").select("id").eq("codigo", "ICSI").single();
    const organizacionId = organizacion?.id;
    if (!organizacionId) {
      setError("No se encontró la organización ICSI.");
      setActualizando(false);
      return false;
    }

    const payload = {
      organizacion_id: organizacionId,
      numero_empleado: formulario.numeroEmpleado,
      nombre_completo: formulario.nombre,
      correo_electronico: formulario.correo || null,
      telefono_whatsapp: formulario.telefonoWhatsapp || null,
      curp: formulario.curp ? formulario.curp.toUpperCase() : null,
      nss: formulario.nss || null,
      color_calendario: formulario.color,
      sede_id: formulario.sedeId || null,
      proyecto_id: formulario.proyectoId || null,
      categoria_id: formulario.categoriaId || null,
      fecha_ingreso: formulario.fechaIngreso || null,
      jefe_inmediato_id: formulario.jefeInmediatoId || null,
    };

    let empleadoId = formulario.id;
    let operacionCorrecta = true;
    if (empleadoId) {
      const { error: updateError } = await db.from("empleados").update(payload).eq("id", empleadoId);
      if (updateError) {
        setError(updateError.message);
        operacionCorrecta = false;
      }
    } else {
      const { data, error: insertError } = await db.from("empleados").insert(payload).select("id").single();
      if (insertError) {
        setError(insertError.message);
        operacionCorrecta = false;
      }
      empleadoId = data?.id;
    }

    if (empleadoId) {
      const tipoVacaciones = datos.tiposAusencia.find((item) => item.codigo === "VACACIONES") ?? datos.tiposAusencia[0];
      if (tipoVacaciones) {
        const { error: saldoError } = await db.from("asignaciones_ausencia").upsert({
          empleado_id: empleadoId,
          tipo_ausencia_id: tipoVacaciones.id,
          anio_asignacion: anio,
          dias_por_derecho: formulario.diasPorDerecho,
          dias_acumulados_a_fecha: formulario.diasAcumulados,
          dias_disponibles: formulario.diasDisponibles,
          fecha_corte_saldo: new Date().toISOString().slice(0, 10),
        }, { onConflict: "empleado_id,tipo_ausencia_id,anio_asignacion" });
        if (saldoError) {
          setError(saldoError.message);
          operacionCorrecta = false;
        }
      }
    }
    if (operacionCorrecta) await cargarDesdeSupabase();
    setActualizando(false);
    return operacionCorrecta;
  }, [anio, cargarDesdeSupabase, datos.empleados, datos.tiposAusencia]);

  const guardarSolicitud = useCallback(async (formulario: SolicitudFormulario) => {
    setActualizando(true);
    setError(null);
    const empleado = datos.empleados.find((item) => item.id === formulario.empleadoId);
    if (!empleado) {
      setError("Selecciona un empleado válido.");
      setActualizando(false);
      return false;
    }
    const dias = differenceInCalendarDays(parseISO(formulario.fechaFin), parseISO(formulario.fechaInicio)) + 1;
    // El reintegro lo elige quien captura (por defecto, el siguiente día hábil)
    // y puede coincidir con la fecha final, pero no ser anterior.
    const fechaReintegro = formulario.fechaReintegro || siguienteDiaHabil(formulario.fechaFin);
    if (fechaReintegro < formulario.fechaFin) {
      setError("La fecha de reintegro no puede ser anterior a la fecha final.");
      setActualizando(false);
      return false;
    }
    const tipoVacaciones = datos.tiposAusencia.find((item) => item.codigo === "VACACIONES") ?? datos.tiposAusencia[0];
    const supabase = obtenerSupabase();
    if (!supabase) {
      const existente = formulario.id ? datos.solicitudes.find((item) => item.id === formulario.id) : undefined;
      if (formulario.id && existente?.etapaAprobacion !== "rrhh") {
        setError("La solicitud ya inició su revisión y no puede editarse.");
        setActualizando(false);
        return false;
      }
      if (formulario.urgente && !formulario.comentarios.trim()) {
        setError("Las solicitudes extraordinarias requieren un comentario que explique el motivo.");
        setActualizando(false);
        return false;
      }
      if (dias > empleado.saldo.diasDisponibles) {
        setError(`Saldo insuficiente: la solicitud requiere ${dias} día(s) y el empleado tiene ${empleado.saldo.diasDisponibles} disponible(s).`);
        setActualizando(false);
        return false;
      }
      setDatos((actual) => ({
        ...actual,
        solicitudes: formulario.id
          ? actual.solicitudes.map((item) => item.id === formulario.id ? {
              ...item,
              empleadoId: empleado.id,
              nombreEmpleado: empleado.nombre,
              colorEmpleado: empleado.color,
              fechaInicio: formulario.fechaInicio,
              fechaFin: formulario.fechaFin,
              fechaReintegro,
              dias,
              comentarios: comentarioConUrgencia(formulario.comentarios, formulario.urgente) || undefined,
            } : item)
          : [...actual.solicitudes, {
              id: `sol-${Date.now()}`,
              empleadoId: empleado.id,
              nombreEmpleado: empleado.nombre,
              colorEmpleado: empleado.color,
              fechaSolicitud: new Date().toISOString(),
              fechaInicio: formulario.fechaInicio,
              fechaFin: formulario.fechaFin,
              fechaReintegro,
              estado: "pendiente" as const,
              etapaAprobacion: "rrhh" as const,
              dias,
              comentarios: comentarioConUrgencia(formulario.comentarios, formulario.urgente) || undefined,
              origen: "empleado" as const,
            }],
      }));
      setActualizando(false);
      return true;
    }

    const { error: rpcError } = await supabase.schema("vacaciones").rpc("guardar_solicitud_vacaciones", {
      p_empleado_id: empleado.id,
      p_tipo_ausencia_id: tipoVacaciones?.id,
      p_fecha_inicio: formulario.fechaInicio,
      p_fecha_fin: formulario.fechaFin,
      p_fecha_reintegro: fechaReintegro,
      p_comentarios: comentarioConUrgencia(formulario.comentarios, formulario.urgente) || null,
      p_solicitud_id: formulario.id ?? null,
    });
    if (rpcError) setError(rpcError.message);
    else await cargarDesdeSupabase();
    setActualizando(false);
    return !rpcError;
  }, [cargarDesdeSupabase, datos.empleados, datos.solicitudes, datos.tiposAusencia]);

  const [revisionesDemo, setRevisionesDemo] = useState<Record<string, RevisionSolicitud[]>>(() => structuredClone(revisionesDemostracion));

  const revisarSolicitud = useCallback(async (id: string, etapa: Exclude<EtapaAprobacion, "aprobada" | "rechazada">, decision: DecisionRevision, comentario?: string) => {
    setActualizando(true);
    setError(null);
    const solicitud = datos.solicitudes.find((item) => item.id === id);
    if (!solicitud) {
      setError("La solicitud no existe.");
      setActualizando(false);
      return false;
    }
    if (solicitud.etapaAprobacion !== etapa) {
      setError(`La solicitud está en la etapa ${solicitud.etapaAprobacion} y no puede revisarse en ${etapa}. No se pueden saltar etapas.`);
      setActualizando(false);
      return false;
    }
    if (solicitud.estado !== "pendiente") {
      setError(`La solicitud no está en revisión activa (estado ${solicitud.estado}).`);
      setActualizando(false);
      return false;
    }

    const supabase = obtenerSupabase();
    if (!supabase) {
      if (etapa === "rrhh" && decision === "aprobado") {
        const diasAnticipacion = differenceInCalendarDays(parseISO(solicitud.fechaInicio), new Date());
        if (diasAnticipacion < ANTICIPACION_MINIMA_DIAS && !separarUrgencia(solicitud.comentarios).urgente) {
          setError(`La solicitud no cumple la anticipación mínima de ${ANTICIPACION_MINIMA_DIAS} días (faltan ${ANTICIPACION_MINIMA_DIAS - diasAnticipacion} día(s)).`);
          setActualizando(false);
          return false;
        }
        const empleado = datos.empleados.find((item) => item.id === solicitud.empleadoId);
        if (empleado && solicitud.dias > empleado.saldo.diasDisponibles) {
          setError(`Saldo insuficiente: la solicitud requiere ${solicitud.dias} día(s) y el empleado tiene ${empleado.saldo.diasDisponibles} disponible(s).`);
          setActualizando(false);
          return false;
        }
      }
      const { etapa: etapaSiguiente, estado: estadoResultante } = siguienteEtapa(
        etapa,
        decision,
        Boolean(datos.empleados.find((item) => item.id === solicitud.empleadoId)?.jefeInmediatoId),
      );
      setDatos((actual) => ({
        ...actual,
        solicitudes: actual.solicitudes.map((item) => item.id === id ? {
          ...item,
          etapaAprobacion: etapaSiguiente,
          etapaRechazo: decision === "rechazado" ? etapa : item.etapaRechazo,
          estado: estadoResultante,
        } : item),
        empleados: estadoResultante === "aprobada"
          ? actual.empleados.map((empleado) => empleado.id === solicitud.empleadoId ? {
              ...empleado,
              saldo: {
                ...empleado.saldo,
                diasDisponibles: empleado.saldo.diasDisponibles - solicitud.dias,
                diasTomados: empleado.saldo.diasTomados + solicitud.dias,
              },
            } : empleado)
          : actual.empleados,
      }));
      setRevisionesDemo((actual) => ({
        ...actual,
        [id]: [...(actual[id] ?? []), {
          id: `rev-${Date.now()}`,
          solicitudId: id,
          etapa,
          decision,
          estadoResultante,
          comentario: comentario || undefined,
          creadoEn: new Date().toISOString(),
        }],
      }));
      setActualizando(false);
      return true;
    }

    const { error: rpcError } = await supabase.schema("vacaciones").rpc("revisar_solicitud", {
      p_solicitud_id: id,
      p_etapa: etapa,
      p_decision: decision,
      p_comentario: comentario || null,
    });
    if (rpcError) setError(rpcError.message);
    else await cargarDesdeSupabase();
    setActualizando(false);
    return !rpcError;
  }, [cargarDesdeSupabase, datos.empleados, datos.solicitudes]);

  const obtenerRevisiones = useCallback(async (solicitudId: string): Promise<RevisionSolicitud[]> => {
    const supabase = obtenerSupabase();
    if (!supabase) return revisionesDemo[solicitudId] ?? [];

    const { data, error: consultaError } = await supabase
      .schema("vacaciones")
      .from("revisiones_solicitud")
      .select("id, etapa, decision, estado_resultante, comentario, creado_en, usuario_id, perfiles_usuario(nombre_visible)")
      .eq("solicitud_ausencia_id", solicitudId)
      .order("creado_en", { ascending: true });
    if (consultaError) {
      setError(consultaError.message);
      return [];
    }
    return (data ?? []).map((fila: Record<string, unknown>) => ({
      id: String(fila.id),
      solicitudId,
      etapa: fila.etapa as RevisionSolicitud["etapa"],
      decision: fila.decision as RevisionSolicitud["decision"],
      estadoResultante: String(fila.estado_resultante),
      comentario: fila.comentario ? String(fila.comentario) : undefined,
      creadoEn: String(fila.creado_en),
      nombreRevisor: (fila.perfiles_usuario as { nombre_visible?: string } | null)?.nombre_visible,
    }));
  }, [revisionesDemo]);

  const eliminarSolicitud = useCallback(async (id: string) => {
    setActualizando(true);
    setError(null);
    const supabase = obtenerSupabase();
    if (!supabase) {
      setDatos((actual) => ({ ...actual, solicitudes: actual.solicitudes.filter((item) => item.id !== id) }));
      setActualizando(false);
      return true;
    }
    const { error: deleteError } = await supabase.schema("vacaciones").from("solicitudes_ausencia").delete().eq("id", id);
    if (deleteError) setError(deleteError.message);
    else await cargarDesdeSupabase();
    setActualizando(false);
    return !deleteError;
  }, [cargarDesdeSupabase]);

  const cambiarEstadoSolicitud = useCallback(async (id: string, estado: EstadoSolicitud) => {
    setActualizando(true);
    const supabase = obtenerSupabase();
    if (!supabase) {
      setDatos((actual) => ({ ...actual, solicitudes: actual.solicitudes.map((solicitud) => solicitud.id === id ? { ...solicitud, estado } : solicitud) }));
      setActualizando(false);
      return true;
    }
    const { error: rpcError } = await supabase.schema("vacaciones").rpc("cambiar_estado_solicitud", {
      p_solicitud_id: id,
      p_estado_nuevo: estado,
    });
    if (rpcError) setError(rpcError.message);
    else await cargarDesdeSupabase();
    setActualizando(false);
    return !rpcError;
  }, [cargarDesdeSupabase]);

  const cambiarEstadoEmpleado = useCallback(async (id: string, estado: "activo" | "inactivo") => {
    setActualizando(true);
    setError(null);
    const supabase = obtenerSupabase();
    if (!supabase) {
      setDatos((actual) => ({ ...actual, empleados: actual.empleados.map((item) => item.id === id ? { ...item, estado } : item) }));
      setActualizando(false);
      return true;
    }
    const { error: updateError } = await supabase.schema("vacaciones").from("empleados").update({ estado }).eq("id", id);
    if (updateError) setError(updateError.message);
    else await cargarDesdeSupabase();
    setActualizando(false);
    return !updateError;
  }, [cargarDesdeSupabase]);

  const eliminarEmpleado = useCallback(async (id: string) => {
    setActualizando(true);
    setError(null);
    const supabase = obtenerSupabase();
    if (!supabase) {
      setDatos((actual) => ({ ...actual, empleados: actual.empleados.filter((item) => item.id !== id) }));
      setActualizando(false);
      return true;
    }
    // DELETE directo: un disparador en la base lo convierte en borrado logico
    // (marca eliminado_en) en vez de eliminar la fila físicamente.
    const { error: deleteError } = await supabase.schema("vacaciones").from("empleados").delete().eq("id", id);
    if (deleteError) setError(deleteError.message);
    else await cargarDesdeSupabase();
    setActualizando(false);
    return !deleteError;
  }, [cargarDesdeSupabase]);

  const guardarCatalogo = useCallback(async (tipo: TipoCatalogo, entrada: { id?: string; nombre: string }) => {
    const limpio = entrada.nombre.trim();
    if (!limpio) return false;
    setActualizando(true);
    setError(null);
    const supabase = obtenerSupabase();
    if (!supabase) {
      setDatos((actual) => ({
        ...actual,
        [tipo]: entrada.id
          ? actual[tipo].map((item) => (item.id === entrada.id ? { ...item, nombre: limpio, codigo: codigoDesdeNombre(limpio) } : item))
          : [...actual[tipo], { id: `${tipo}-${Date.now()}`, nombre: limpio, codigo: codigoDesdeNombre(limpio) }],
      }));
      setActualizando(false);
      return true;
    }

    const tabla = tipo === "categorias" ? "categorias_empleado" : tipo;
    const db = supabase.schema("vacaciones");

    if (entrada.id) {
      const { error: updateError } = await db.from(tabla).update({ nombre: limpio, codigo: codigoDesdeNombre(limpio) }).eq("id", entrada.id);
      if (updateError) setError(updateError.message);
      else await cargarDesdeSupabase();
      setActualizando(false);
      return !updateError;
    }

    const { data: organizacion } = datos.empleados[0]?.organizacionId
      ? { data: { id: datos.empleados[0].organizacionId } }
      : await db.from("organizaciones").select("id").eq("codigo", "ICSI").single();
    const organizacionId = organizacion?.id;
    if (!organizacionId) {
      setError("No se encontró la organización ICSI.");
      setActualizando(false);
      return false;
    }
    const { error: insertError } = await db.from(tabla).insert({ organizacion_id: organizacionId, nombre: limpio, codigo: codigoDesdeNombre(limpio) });
    if (insertError) setError(insertError.message);
    else await cargarDesdeSupabase();
    setActualizando(false);
    return !insertError;
  }, [cargarDesdeSupabase, datos.empleados]);

  const eliminarCatalogo = useCallback(async (tipo: TipoCatalogo, id: string) => {
    setActualizando(true);
    setError(null);
    const supabase = obtenerSupabase();
    if (!supabase) {
      setDatos((actual) => ({ ...actual, [tipo]: actual[tipo].filter((item) => item.id !== id) }));
      setActualizando(false);
      return true;
    }
    const tabla = tipo === "categorias" ? "categorias_empleado" : tipo;
    const db = supabase.schema("vacaciones");
    // DELETE directo: un disparador en la base lo convierte en borrado logico
    // (marca eliminado_en) en vez de eliminar la fila físicamente.
    const { error: deleteError } = await db.from(tabla).delete().eq("id", id);
    if (deleteError) setError(deleteError.message);
    else await cargarDesdeSupabase();
    setActualizando(false);
    return !deleteError;
  }, [cargarDesdeSupabase]);

  const guardarFestivo = useCallback(async (entrada: { id?: string; fecha: string; nombre: string }) => {
    const nombre = entrada.nombre.trim();
    if (!nombre || !entrada.fecha) return false;
    setActualizando(true);
    setError(null);
    const supabase = obtenerSupabase();
    if (!supabase) {
      setDatos((actual) => ({
        ...actual,
        diasFestivos: entrada.id
          ? actual.diasFestivos.map((item) => (item.id === entrada.id ? { ...item, fecha: entrada.fecha, nombre } : item))
          : [...actual.diasFestivos, { id: `festivo-${Date.now()}`, fecha: entrada.fecha, nombre }],
      }));
      setActualizando(false);
      return true;
    }

    const db = supabase.schema("vacaciones");
    if (entrada.id) {
      const { error: updateError } = await db.from("dias_festivos").update({ fecha: entrada.fecha, nombre }).eq("id", entrada.id);
      if (updateError) setError(updateError.message);
      else await cargarDesdeSupabase();
      setActualizando(false);
      return !updateError;
    }

    const { data: organizacion } = datos.empleados[0]?.organizacionId
      ? { data: { id: datos.empleados[0].organizacionId } }
      : await db.from("organizaciones").select("id").eq("codigo", "ICSI").single();
    const organizacionId = organizacion?.id;
    if (!organizacionId) {
      setError("No se encontró la organización ICSI.");
      setActualizando(false);
      return false;
    }
    const { error: insertError } = await db.from("dias_festivos").insert({ organizacion_id: organizacionId, fecha: entrada.fecha, nombre });
    if (insertError) setError(insertError.message);
    else await cargarDesdeSupabase();
    setActualizando(false);
    return !insertError;
  }, [cargarDesdeSupabase, datos.empleados]);

  const eliminarFestivo = useCallback(async (id: string) => {
    setActualizando(true);
    setError(null);
    const supabase = obtenerSupabase();
    if (!supabase) {
      setDatos((actual) => ({ ...actual, diasFestivos: actual.diasFestivos.filter((item) => item.id !== id) }));
      setActualizando(false);
      return true;
    }
    const { error: deleteError } = await supabase.schema("vacaciones").from("dias_festivos").delete().eq("id", id);
    if (deleteError) setError(deleteError.message);
    else await cargarDesdeSupabase();
    setActualizando(false);
    return !deleteError;
  }, [cargarDesdeSupabase]);

  return useMemo(() => ({
    datos,
    cargando,
    actualizando,
    error,
    modoDemostracion: !supabaseConfigurado,
    recargar: cargarDesdeSupabase,
    guardarEmpleado,
    cambiarEstadoEmpleado,
    eliminarEmpleado,
    guardarSolicitud,
    eliminarSolicitud,
    cambiarEstadoSolicitud,
    revisarSolicitud,
    obtenerRevisiones,
    guardarCatalogo,
    eliminarCatalogo,
    guardarFestivo,
    eliminarFestivo,
  }), [actualizando, cambiarEstadoEmpleado, cambiarEstadoSolicitud, cargando, cargarDesdeSupabase, datos, eliminarCatalogo, eliminarEmpleado, eliminarFestivo, eliminarSolicitud, error, guardarCatalogo, guardarEmpleado, guardarFestivo, guardarSolicitud, obtenerRevisiones, revisarSolicitud]);
}
