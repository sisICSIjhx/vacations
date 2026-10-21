// Espejo de vacaciones.dias_vacaciones_lft (migración 023): días de
// vacaciones por años de servicio cumplidos según el art. 76 de la LFT.
export function diasVacacionesLft(anios: number): number {
  if (!Number.isFinite(anios) || anios < 1) return 0;
  if (anios <= 5) return 10 + 2 * Math.floor(anios);
  return 22 + 2 * Math.floor((anios - 6) / 5);
}

// Antigüedad que el empleado cumple dentro del año (su aniversario cae en
// ese año). Sin fecha de ingreso: undefined.
export function antiguedadEnAnio(fechaIngreso: string | undefined, anio: number): number | undefined {
  const anioIngreso = Number(fechaIngreso?.slice(0, 4));
  if (!fechaIngreso || !Number.isInteger(anioIngreso)) return undefined;
  return Math.max(anio - anioIngreso, 0);
}

export function diasPorDerechoEnAnio(fechaIngreso: string | undefined, anio: number): number | undefined {
  const antiguedad = antiguedadEnAnio(fechaIngreso, anio);
  return antiguedad === undefined ? undefined : diasVacacionesLft(antiguedad);
}

// Espejo de vacaciones.aniversario_ingreso (migración 024): fecha ISO del
// aniversario de ingreso en el año; el 29 de febrero cae el 28 si no es bisiesto.
export function aniversarioEnAnio(fechaIngreso: string | undefined, anio: number): string | undefined {
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(fechaIngreso ?? "");
  if (!partes) return undefined;
  const mes = Number(partes[2]);
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const dia = Math.min(Number(partes[3]), ultimoDia);
  return `${anio}-${partes[2]}-${String(dia).padStart(2, "0")}`;
}

// Días por derecho ya otorgados al día `hoy` (ISO): la LFT los concede en el
// aniversario, como vacaciones.otorgar_dias_aniversario.
export function diasOtorgadosAl(fechaIngreso: string | undefined, anio: number, hoy: string): number | undefined {
  const aniversario = aniversarioEnAnio(fechaIngreso, anio);
  if (!aniversario) return undefined;
  return aniversario <= hoy ? diasPorDerechoEnAnio(fechaIngreso, anio) : 0;
}
