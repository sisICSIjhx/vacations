import { format, getDate, getDaysInMonth, getDay, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import type { DiaFestivo, RepeticionFestivo } from "../types";

// Repeticion anual de los festivos (019). Un festivo que se repite aplica desde
// el anio de su fecha en adelante; replica vacaciones.festivo_en_fecha.

const ORDINALES = ["primer", "segundo", "tercer", "cuarto", "quinto"];

// 0 = primera semana del mes (dias 1-7), 1 = segunda (8-14), ...
function semanaDelMes(fecha: Date): number {
  return Math.floor((getDate(fecha) - 1) / 7);
}

export function festivoEnFecha(festivo: DiaFestivo, fecha: string): boolean {
  if (festivo.repeticion === "ninguna") return festivo.fecha === fecha;
  if (fecha.slice(0, 4) < festivo.fecha.slice(0, 4) || fecha.slice(5, 7) !== festivo.fecha.slice(5, 7)) return false;
  if (festivo.repeticion === "fecha") return fecha.slice(8) === festivo.fecha.slice(8);
  const base = parseISO(festivo.fecha);
  const dia = parseISO(fecha);
  return getDay(dia) === getDay(base) && semanaDelMes(dia) === semanaDelMes(base);
}

// Fecha (yyyy-MM-dd) en que cae el festivo en ese anio, o null si no aplica.
function fechaEnAnio(festivo: DiaFestivo, anio: number): string | null {
  const anioBase = Number(festivo.fecha.slice(0, 4));
  if (festivo.repeticion === "ninguna") return anioBase === anio ? festivo.fecha : null;
  if (anio < anioBase) return null;
  const base = parseISO(festivo.fecha);
  const primeroDelMes = new Date(anio, base.getMonth(), 1);
  const dia = festivo.repeticion === "fecha"
    ? getDate(base)
    : 1 + ((getDay(base) - getDay(primeroDelMes) + 7) % 7) + 7 * semanaDelMes(base);
  if (dia > getDaysInMonth(primeroDelMes)) return null; // 29 de febrero en anio no bisiesto
  return format(new Date(anio, base.getMonth(), dia), "yyyy-MM-dd");
}

// Festivos de un anio con su fecha real, para pintarlos en el calendario.
export function festivosDelAnio(festivos: DiaFestivo[], anio: number): DiaFestivo[] {
  return festivos.flatMap((festivo) => {
    const fecha = fechaEnAnio(festivo, anio);
    return fecha ? [{ ...festivo, fecha }] : [];
  });
}

// Texto para el catalogo y el selector de repeticion.
export function descripcionRepeticion(fecha: string, repeticion: RepeticionFestivo): string {
  const base = parseISO(fecha);
  if (repeticion === "fecha") return `Cada año el ${format(base, "d 'de' MMMM", { locale: es })}`;
  if (repeticion === "dia_semana") return `Cada año el ${ORDINALES[semanaDelMes(base)]} ${format(base, "EEEE 'de' MMMM", { locale: es })}`;
  return `Solo el ${format(base, "d 'de' MMMM 'de' yyyy", { locale: es })}`;
}
