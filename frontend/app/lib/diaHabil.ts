import { addDays, format, getDay, parseISO } from "date-fns";

// Siguiente dia habil (lunes a viernes) despues de la fecha final, en formato yyyy-MM-dd.
export function siguienteDiaHabil(fechaFin: string): string {
  if (!fechaFin) return "";
  let d = addDays(parseISO(fechaFin), 1);
  while (getDay(d) === 0 || getDay(d) === 6) d = addDays(d, 1);
  return format(d, "yyyy-MM-dd");
}
