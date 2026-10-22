import { addDays, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { aniversarioEnAnio } from "./antiguedad.ts";
import { diasVacaciones } from "./diaHabil.ts";
import type { DiaFestivo, Empleado, SaldoVacaciones, SolicitudAusencia } from "../types.ts";

// Saldo que queda tras una solicitud, mostrado al capturarla. Los disponibles
// de v_saldo_vacaciones_empleado ya restan solo lo aprobado; lo pendiente o
// planeado se informa aparte porque todavía puede rechazarse.
export interface ProyeccionSaldo {
  dias: number;
  disponibles: number;
  restantes: number;
  enTramite: number;
  restantesConTramite: number;
  descuenta: boolean;
  insuficiente: boolean;
}

const redondear = (valor: number) => Math.round(valor * 100) / 100;

export function proyectarSaldo(saldo: Pick<SaldoVacaciones, "diasDisponibles" | "diasPendientes" | "diasPlaneados">, dias: number, descuenta = true): ProyeccionSaldo {
  const descontados = descuenta ? dias : 0;
  const enTramite = redondear(saldo.diasPendientes + saldo.diasPlaneados);
  const restantes = redondear(saldo.diasDisponibles - descontados);
  return {
    dias,
    disponibles: saldo.diasDisponibles,
    restantes,
    enTramite,
    restantesConTramite: redondear(restantes - enTramite),
    descuenta,
    insuficiente: descontados > saldo.diasDisponibles,
  };
}

// Espejo de vacaciones.validar_uso_dias_por_derecho (028): los días por
// derecho del año solo se usan desde el aniversario de ingreso (cuando cumple
// su año de servicio). Antes de esa fecha caben disponibles − derecho más lo
// aprobado del año desde el aniversario. Solo cubre el año del saldo cargado.
export interface UsoDiasPorDerecho {
  anio: number;
  aniversario: string;
  derecho: number;
  disponiblesAntes: number;
  diasAntes: number;
  excedido: boolean;
}

export function usoDiasPorDerecho(
  periodo: { fechaInicio: string; fechaFin: string },
  empleado: Pick<Empleado, "id" | "fechaIngreso" | "diaDescanso" | "sedeId" | "saldo">,
  solicitudes: Pick<SolicitudAusencia, "id" | "empleadoId" | "estado" | "fechaInicio" | "fechaFin">[],
  festivos: DiaFestivo[] = [],
  solicitudId?: string,
): UsoDiasPorDerecho | null {
  const { anio, diasPorDerecho, diasDisponibles } = empleado.saldo;
  const aniversario = aniversarioEnAnio(empleado.fechaIngreso, anio);
  if (!aniversario || diasPorDerecho <= 0) return null;
  const vispera = format(addDays(parseISO(aniversario), -1), "yyyy-MM-dd");
  const diasEntre = (inicio: string, fin: string, desde: string, hasta: string) => {
    const a = inicio > desde ? inicio : desde;
    const b = fin < hasta ? fin : hasta;
    return a <= b ? diasVacaciones(a, b, empleado.diaDescanso, festivos, empleado.sedeId) : 0;
  };
  const { fechaInicio, fechaFin } = periodo;
  const diasAntes = fechaInicio && fechaFin && fechaFin >= fechaInicio ? diasEntre(fechaInicio, fechaFin, `${anio}-01-01`, vispera) : 0;
  const aprobadosDesde = solicitudes
    .filter((solicitud) => solicitud.empleadoId === empleado.id && solicitud.estado === "aprobada" && solicitud.id !== solicitudId)
    .reduce((total, solicitud) => total + diasEntre(solicitud.fechaInicio, solicitud.fechaFin, aniversario, `${anio}-12-31`), 0);
  const disponiblesAntes = Math.max(redondear(diasDisponibles + aprobadosDesde - diasPorDerecho), 0);
  return { anio, aniversario, derecho: diasPorDerecho, disponiblesAntes, diasAntes, excedido: diasAntes > disponiblesAntes };
}

export function fechaUsoDerecho(aniversario: string): string {
  return format(parseISO(aniversario), "d 'de' MMMM 'de' yyyy", { locale: es });
}

// Equivalente al error de la base, para el modo demostración.
export function mensajeUsoDerecho(uso: UsoDiasPorDerecho): string {
  return `Los ${uso.derecho} día(s) por derecho de ${uso.anio} se pueden usar a partir del ${fechaUsoDerecho(uso.aniversario)}, cuando cumple su año de servicio. Antes de esa fecha hay ${uso.disponiblesAntes} día(s) disponibles y la solicitud usa ${uso.diasAntes}.`;
}
