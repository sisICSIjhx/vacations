import { differenceInCalendarDays, isValid, parseISO } from "date-fns";

export const ANTICIPACION_MINIMA_DIAS = 15;

const calendarioMexico = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mexico_City",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function diasDeAnticipacion(fechaInicio: string, fechaSolicitud?: string): number | null {
  if (!fechaSolicitud) return null;
  const inicio = parseISO(fechaInicio);
  const solicitud = parseISO(fechaSolicitud);
  if (!isValid(inicio) || !isValid(solicitud)) return null;

  // Una fecha sin hora ya representa un día de calendario.
  if (/^\d{4}-\d{2}-\d{2}$/.test(fechaSolicitud)) {
    return differenceInCalendarDays(inicio, solicitud);
  }

  const partes = Object.fromEntries(calendarioMexico.formatToParts(solicitud).map(({ type, value }) => [type, value]));
  const diaSolicitud = parseISO(`${partes.year}-${partes.month}-${partes.day}`);
  return differenceInCalendarDays(inicio, diaSolicitud);
}
