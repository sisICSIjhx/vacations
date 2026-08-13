"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { datosDemostracion } from "../data/demo";
import { obtenerSupabase, supabaseConfigurado } from "../lib/supabase";
import type {
  Catalogo,
  DatosVacaciones,
  Empleado,
  EmpleadoFormulario,
  EstadoSolicitud,
  SolicitudAusencia,
  SolicitudFormulario,
} from "../types";

type TipoCatalogo = "sedes" | "proyectos" | "categorias";

const copiarDemo = (): DatosVacaciones => structuredClone(datosDemostracion);

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
      incidenciasResultado,
    ] = await Promise.all([
      db.from("empleados").select("*").order("nombre_completo"),
      db.from("v_saldo_vacaciones_empleado").select("*").eq("anio_asignacion", anio),
      db.from("v_dias_solicitud_calendario").select("*").gte("fecha_calendario", desde).lte("fecha_calendario", hasta),
      db.from("dias_festivos").select("*").gte("fecha", desde).lte("fecha", hasta).order("fecha"),
      db.from("sedes").select("id,codigo,nombre").eq("activo", true).is("eliminado_en", null).order("nombre"),
      db.from("proyectos").select("id,codigo,nombre").eq("activo", true).is("eliminado_en", null).order("nombre"),
      db.from("categorias_empleado").select("id,codigo,nombre,color").eq("activo", true).is("eliminado_en", null).order("nombre"),
      db.from("tipos_ausencia").select("id,codigo,nombre,color").eq("activo", true).is("eliminado_en", null).order("nombre"),
      db.from("incidencias_importacion").select("id,numero_fila,gravedad,mensaje").order("creado_en", { ascending: false }).limit(20),
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
      incidenciasResultado,
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

    const empleados: Empleado[] = (empleadosResultado.data ?? []).map((fila: Record<string, unknown>) => {
      const saldo = saldoPorEmpleado.get(String(fila.id)) as Record<string, unknown> | undefined;
      return {
        id: String(fila.id),
        organizacionId: String(fila.organizacion_id),
        numeroEmpleado: String(fila.numero_empleado),
        nombre: String(fila.nombre_completo),
        correo: fila.correo_electronico ? String(fila.correo_electronico) : undefined,
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
          fechaInicio: String(fila.fecha_inicio),
          fechaFin: String(fila.fecha_fin),
          fechaReintegro: fila.fecha_reintegro ? String(fila.fecha_reintegro) : undefined,
          estado: fila.estado as EstadoSolicitud,
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
      incidencias: (incidenciasResultado.data ?? []).map((fila: Record<string, unknown>) => ({
        id: String(fila.id),
        fila: Number(fila.numero_fila ?? 0),
        gravedad: fila.gravedad === "advertencia" ? "advertencia" : "error",
        mensaje: String(fila.mensaje),
      })),
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
        const empleado: Empleado = {
          id: formulario.id ?? `emp-${Date.now()}`,
          organizacionId: existente?.organizacionId ?? "org-icsi",
          numeroEmpleado: formulario.numeroEmpleado,
          nombre: formulario.nombre,
          correo: formulario.correo || undefined,
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
      curp: formulario.curp ? formulario.curp.toUpperCase() : null,
      nss: formulario.nss || null,
      color_calendario: formulario.color,
      sede_id: formulario.sedeId || null,
      proyecto_id: formulario.proyectoId || null,
      categoria_id: formulario.categoriaId || null,
      fecha_ingreso: formulario.fechaIngreso || null,
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
    const supabase = obtenerSupabase();
    if (!supabase) {
      setDatos((actual) => ({
        ...actual,
        solicitudes: [...actual.solicitudes, {
          id: `sol-${Date.now()}`,
          empleadoId: empleado.id,
          nombreEmpleado: empleado.nombre,
          colorEmpleado: empleado.color,
          fechaInicio: formulario.fechaInicio,
          fechaFin: formulario.fechaFin,
          fechaReintegro: formulario.fechaReintegro || undefined,
          estado: formulario.estado,
          dias,
          comentarios: formulario.comentarios || undefined,
          origen: "administrador",
        }],
      }));
      setActualizando(false);
      return true;
    }
    const tipoVacaciones = datos.tiposAusencia.find((item) => item.codigo === "VACACIONES") ?? datos.tiposAusencia[0];
    const { error: insertError } = await supabase.schema("vacaciones").from("solicitudes_ausencia").insert({
      organizacion_id: empleado.organizacionId,
      empleado_id: empleado.id,
      tipo_ausencia_id: tipoVacaciones?.id,
      estado: formulario.estado,
      fecha_inicio: formulario.fechaInicio,
      fecha_fin: formulario.fechaFin,
      fecha_reintegro: formulario.fechaReintegro || null,
      comentarios: formulario.comentarios || null,
      origen: "administrador",
      solicitado_en: new Date().toISOString(),
    });
    if (insertError) setError(insertError.message);
    else await cargarDesdeSupabase();
    setActualizando(false);
    return !insertError;
  }, [cargarDesdeSupabase, datos.empleados, datos.tiposAusencia]);

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

  const importarCsv = useCallback(async (archivo: File) => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
    const supabase = obtenerSupabase();
    if (!apiUrl || !supabase) {
      await new Promise((resolver) => setTimeout(resolver, 650));
      return { importadas: 8, rechazadas: 1, mensaje: "Importación demostrativa completada." };
    }
    const { data: sesion } = await supabase.auth.getSession();
    const cuerpo = new FormData();
    cuerpo.append("archivo", archivo);
    const respuesta = await fetch(`${apiUrl}/importaciones/vacaciones`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sesion.session?.access_token ?? ""}` },
      body: cuerpo,
    });
    const resultado = await respuesta.json();
    if (!respuesta.ok) throw new Error(resultado.message ?? "No fue posible importar el archivo.");
    await cargarDesdeSupabase();
    return resultado;
  }, [cargarDesdeSupabase]);

  return useMemo(() => ({
    datos,
    cargando,
    actualizando,
    error,
    modoDemostracion: !supabaseConfigurado,
    recargar: cargarDesdeSupabase,
    guardarEmpleado,
    guardarSolicitud,
    cambiarEstadoSolicitud,
    guardarCatalogo,
    eliminarCatalogo,
    importarCsv,
  }), [actualizando, cambiarEstadoSolicitud, cargando, cargarDesdeSupabase, datos, eliminarCatalogo, error, guardarCatalogo, guardarEmpleado, guardarSolicitud, importarCsv]);
}
