import { obtenerSupabase } from "./supabase";
import { ACCIONES, eventoDesdeFila, TAMANO_PAGINA, type FiltrosHistorial, type PaginaHistorial } from "./historial";

export async function consultarHistorialRemoto(filtros: FiltrosHistorial): Promise<PaginaHistorial> {
  const supabase = obtenerSupabase();
  if (!supabase) throw new Error("No hay conexión disponible.");
  let consulta = supabase.schema("vacaciones").from("historial_actividad")
    .select("id,ocurrido_en,actor_nombre,modulo,entidad,registro_id,solicitud_id,empleado_id,sujeto,accion,motivo,anteriores,nuevos,recuperado")
    .order("ocurrido_en", { ascending: false }).order("id", { ascending: false });
  if (filtros.solicitudId) consulta = consulta.eq("solicitud_id", filtros.solicitudId);
  if (filtros.modulo) consulta = consulta.eq("modulo", filtros.modulo);
  if (filtros.desde) consulta = consulta.gte("ocurrido_en", `${filtros.desde}T00:00:00-06:00`);
  if (filtros.hasta) consulta = consulta.lte("ocurrido_en", `${filtros.hasta}T23:59:59.999-06:00`);
  // Quitar sintaxis de filtros PostgREST; el texto nunca puede introducir otro filtro.
  const texto = filtros.texto?.trim().replace(/[^\p{L}\p{N}\s@._-]/gu, "").slice(0, 150);
  if (texto) {
    const acciones = Object.entries(ACCIONES).filter(([id, nombre]) => `${nombre} ${id === "cancelacion" ? "Días cancelados y reintegrados cancelación" : ""}`.toLocaleLowerCase("es").includes(texto.toLocaleLowerCase("es"))).map(([id]) => id);
    consulta = consulta.or([`actor_nombre.ilike.*${texto}*`, `sujeto.ilike.*${texto}*`, `motivo.ilike.*${texto}*`, ...acciones.map(id => `accion.eq.${id}`)].join(","));
  }
  const desde = (filtros.pagina ?? 0) * TAMANO_PAGINA;
  const { data, error } = await consulta.range(desde, desde + TAMANO_PAGINA);
  if (error) throw new Error(["42P01", "PGRST205"].includes(error.code)
    ? "El historial completo todavía no está habilitado. Administración debe aplicar la actualización de base de datos 026."
    : "No se pudo cargar el historial. Comprueba tu conexión y vuelve a intentarlo.");
  return { eventos: (data ?? []).slice(0, TAMANO_PAGINA).map(eventoDesdeFila), hayMas: (data?.length ?? 0) > TAMANO_PAGINA };
}
