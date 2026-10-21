import type { EmpleadoFormulario, PerfilUsuario } from "../types.ts";

export type ValoresSaldo = Pick<EmpleadoFormulario, "diasPorDerecho" | "diasAcumulados" | "diasDisponibles">;

export function valoresSaldo(saldo: ValoresSaldo): ValoresSaldo {
  return { diasPorDerecho: saldo.diasPorDerecho, diasAcumulados: saldo.diasAcumulados, diasDisponibles: saldo.diasDisponibles };
}

export function cambioSaldo(formulario: EmpleadoFormulario): boolean {
  const antes = formulario.saldoAnterior;
  return !!antes && (antes.diasPorDerecho !== formulario.diasPorDerecho
    || antes.diasAcumulados !== formulario.diasAcumulados
    || antes.diasDisponibles !== formulario.diasDisponibles);
}

export function validarAjusteSaldo(formulario: EmpleadoFormulario, perfil: PerfilUsuario | null): string | null {
  if (!perfil?.activo || !["administrador", "rrhh", "mesa_directiva"].includes(perfil.rol)) return "No tienes permiso para ajustar saldos.";
  if (perfil.rol === "mesa_directiva" && (!formulario.id || !formulario.saldoAnterior)) return "Solo Administración y RRHH pueden crear el saldo inicial.";
  if (Object.values(valoresSaldo(formulario)).some(n => !Number.isFinite(n) || n < 0 || n > 999999.99)) return "Los días deben ser cantidades válidas no negativas.";
  if (cambioSaldo(formulario) && !formulario.motivoAjuste?.trim()) return "Es obligatorio indicar el motivo del ajuste de saldo.";
  if ((formulario.motivoAjuste?.trim().length ?? 0) > 2000) return "El motivo no puede superar 2000 caracteres.";
  return null;
}
