// Espejo de vacaciones.dias_vacaciones_lft (migración 023): días de
// vacaciones por años de servicio cumplidos según el art. 76 de la LFT.
export function diasVacacionesLft(anios: number): number {
  if (!Number.isFinite(anios) || anios < 1) return 0;
  if (anios <= 5) return 10 + 2 * Math.floor(anios);
  return 22 + 2 * Math.floor((anios - 6) / 5);
}

// Antigüedad que el empleado cumple dentro del año (su aniversario cae en
// ese año), igual que generar_saldos_anio. Sin fecha de ingreso: undefined.
export function antiguedadEnAnio(fechaIngreso: string | undefined, anio: number): number | undefined {
  const anioIngreso = Number(fechaIngreso?.slice(0, 4));
  if (!fechaIngreso || !Number.isInteger(anioIngreso)) return undefined;
  return Math.max(anio - anioIngreso, 0);
}

export function diasPorDerechoEnAnio(fechaIngreso: string | undefined, anio: number): number | undefined {
  const antiguedad = antiguedadEnAnio(fechaIngreso, anio);
  return antiguedad === undefined ? undefined : diasVacacionesLft(antiguedad);
}
