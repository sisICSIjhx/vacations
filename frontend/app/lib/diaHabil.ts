import { addDays, format, getDay, parseISO } from "date-fns";
import type { DiaFestivo } from "../types";
import { festivoEnFecha } from "./festivos.ts";

// Reintegro sugerido: siguiente dia laboral del empleado despues de la fecha
// final (yyyy-MM-dd), sin su dia de descanso ni festivos globales o de su sede.
// Sin descanso definido se conserva el criterio de lunes a viernes.
export function siguienteDiaHabil(fechaFin: string, diaDescanso?: number, festivos: DiaFestivo[] = [], sedeId?: string): string {
  if (!fechaFin) return "";
  const aplicables = festivos.filter((festivo) => !festivo.sedeId || festivo.sedeId === sedeId);
  const descansa = (d: Date) => diaDescanso === undefined ? getDay(d) === 0 || getDay(d) === 6 : getDay(d) === diaDescanso;
  let d = addDays(parseISO(fechaFin), 1);
  while (descansa(d) || aplicables.some((festivo) => festivoEnFecha(festivo, format(d, "yyyy-MM-dd")))) d = addDays(d, 1);
  return format(d, "yyyy-MM-dd");
}

// Dia de descanso semanal: mismo numero que getDay / extract(dow) (0=domingo).
export const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

// Dias de vacaciones entre dos fechas (inclusive) sin contar el dia de descanso
// del empleado ni los festivos globales o de su sede; replica dias_descontados
// de v_dias_solicitud_calendario (016, 018, 019).
export function diasVacaciones(fechaInicio: string, fechaFin: string, diaDescanso?: number, festivos: DiaFestivo[] = [], sedeId?: string): number {
  const aplicables = festivos.filter((festivo) => !festivo.sedeId || festivo.sedeId === sedeId);
  let dias = 0;
  for (let d = parseISO(fechaInicio); format(d, "yyyy-MM-dd") <= fechaFin; d = addDays(d, 1)) {
    const fecha = format(d, "yyyy-MM-dd");
    if (getDay(d) !== diaDescanso && !aplicables.some((festivo) => festivoEnFecha(festivo, fecha))) dias += 1;
  }
  return dias;
}
