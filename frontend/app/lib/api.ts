import { obtenerSupabase } from "./supabase";
import type { RolUsuario } from "../types";

const urlBase = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, "");

export interface AccesoUsuario {
  usuarioId: string;
  empleadoId: string | null;
  nombreVisible: string;
  rol: RolUsuario;
  activo: boolean;
  correo: string | null;
  puedeCambiarContrasena: boolean;
}

export interface AccesoCreado {
  usuarioId: string;
  correo: string;
  // null cuando el correo ya tenía una cuenta de Supabase (creada antes fuera
  // de esta pantalla) y solo se vinculó: su contraseña no cambió.
  contrasena: string | null;
  rol: RolUsuario;
}

async function solicitar<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  if (!urlBase) throw new Error("NEXT_PUBLIC_API_URL no está configurada.");
  const token = (await obtenerSupabase()?.auth.getSession())?.data.session?.access_token;
  if (!token) throw new Error("No hay una sesión activa.");

  let respuesta: Response;
  try {
    respuesta = await fetch(`${urlBase}${ruta}`, {
      ...opciones,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...opciones.headers },
    });
  } catch {
    throw new Error(`No fue posible contactar la API (${urlBase}). Verifica que esté desplegada y accesible.`);
  }
  const cuerpo = await respuesta.json().catch(() => null);
  if (!respuesta.ok) throw new Error(cuerpo?.message ?? "No fue posible completar la operación.");
  return cuerpo as T;
}

export const accesosDisponibles = Boolean(urlBase);

export function listarAccesos(): Promise<AccesoUsuario[]> {
  return solicitar<AccesoUsuario[]>("/accesos");
}

export function crearAcceso(datos: { empleadoId: string; correo: string; rol: RolUsuario; permitirCambioContrasena?: boolean; forzarCambioContrasena?: boolean }): Promise<AccesoCreado> {
  return solicitar<AccesoCreado>("/accesos", { method: "POST", body: JSON.stringify(datos) });
}

export function actualizarAcceso(usuarioId: string, cambios: { rol?: RolUsuario; activo?: boolean; empleadoId?: string; correo?: string; permitirCambioContrasena?: boolean; forzarCambioContrasena?: boolean }): Promise<{ actualizado: boolean }> {
  return solicitar<{ actualizado: boolean }>(`/accesos/${usuarioId}`, { method: "PATCH", body: JSON.stringify(cambios) });
}

export function restablecerContrasena(usuarioId: string, permitirCambio?: boolean, forzarCambio?: boolean): Promise<{ contrasena: string }> {
  return solicitar<{ contrasena: string }>(`/accesos/${usuarioId}/restablecer-contrasena`, { method: "POST", body: JSON.stringify({ permitirCambio, forzarCambio }) });
}

export function verContrasena(usuarioId: string): Promise<{ contrasena: string | null }> {
  return solicitar<{ contrasena: string | null }>(`/accesos/${usuarioId}/contrasena`);
}

export function cambiarMiContrasena(contrasenaActual: string, contrasenaNueva: string): Promise<{ actualizado: boolean }> {
  return solicitar<{ actualizado: boolean }>("/cuenta/contrasena", { method: "POST", body: JSON.stringify({ contrasenaActual, contrasenaNueva }) });
}
