import { addDays, format, getDay, parseISO } from "date-fns";

// Siguiente dia habil (lunes a viernes) despues de la fecha final, en formato yyyy-MM-dd.
export function siguienteDiaHabil(fechaFin: string): string {
  if (!fechaFin) return "";
  let d = addDays(parseISO(fechaFin), 1);
  while (getDay(d) === 0 || getDay(d) === 6) d = addDays(d, 1);
  return format(d, "yyyy-MM-dd");
}

// Dia de descanso semanal: mismo numero que getDay / extract(dow) (0=domingo).
export const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

// Dias de vacaciones entre dos fechas (inclusive) sin contar el dia de descanso
// del empleado; replica dias_descontados de v_dias_solicitud_calendario (016).
export function diasVacaciones(fechaInicio: string, fechaFin: string, diaDescanso?: number): number {
  let dias = 0;
  for (let d = parseISO(fechaInicio); format(d, "yyyy-MM-dd") <= fechaFin; d = addDays(d, 1)) {
    if (getDay(d) !== diaDescanso) dias += 1;
  }
  return dias;
}
