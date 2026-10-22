"use client";

import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { DIAS_SEMANA, diasVacaciones } from "../lib/diaHabil";
import { fechaUsoDerecho, proyectarSaldo, usoDiasPorDerecho } from "../lib/proyeccionSaldo";
import type { DiaFestivo, Empleado, SolicitudAusencia, SolicitudFormulario } from "../types";

// Resumen compartido por los dos formularios de solicitud: días que se
// descuentan (mismo cálculo que el guardado), saldo que quedará después y
// desde cuándo se pueden usar los días por derecho (028).
export function ResumenSolicitud({ formulario, empleado, festivos, solicitudes, descuentaSaldo, autoservicio }: {
  formulario: SolicitudFormulario;
  empleado: Empleado | undefined;
  festivos: DiaFestivo[];
  solicitudes: SolicitudAusencia[];
  descuentaSaldo: boolean;
  autoservicio: boolean;
}) {
  const { fechaInicio, fechaFin } = formulario;
  if (!empleado || !fechaInicio || !fechaFin || fechaFin < fechaInicio) return null;
  const dias = diasVacaciones(fechaInicio, fechaFin, empleado.diaDescanso, festivos, empleado.sedeId);
  const naturales = differenceInCalendarDays(parseISO(fechaFin), parseISO(fechaInicio)) + 1;
  const excluidos = naturales - dias;
  const proyeccion = proyectarSaldo(empleado.saldo, dias, descuentaSaldo);
  const { anio } = empleado.saldo;
  const fueraDelAnio = !fechaInicio.startsWith(`${anio}-`) || !fechaFin.startsWith(`${anio}-`);
  const uso = usoDiasPorDerecho(formulario, empleado, solicitudes, festivos);
  const mostrarUso = uso && (uso.aniversario > format(new Date(), "yyyy-MM-dd") || uso.diasAntes > 0);
  const motivoExclusion = empleado.diaDescanso === undefined ? "festivo" : `descanso semanal (${DIAS_SEMANA[empleado.diaDescanso]?.toLowerCase()}) o festivo`;

  return (
    <section className="span-two request-summary" aria-live="polite" aria-label="Resumen de la solicitud">
      <div className="stat-grid">
        <div className="mini-stat"><span>Días solicitados</span><strong>{dias}</strong></div>
        {proyeccion.insuficiente
          ? <div className="mini-stat saldo-insuficiente"><span>Días que faltan</span><strong>{-proyeccion.restantes}</strong></div>
          : <div className="mini-stat"><span>{autoservicio ? "Te quedarán" : "Le quedarán"}</span><strong>{proyeccion.restantes}</strong></div>}
      </div>
      <p>
        {naturales} día(s) naturales{excluidos > 0 ? `; no se descuentan ${excluidos} por ${motivoExclusion}` : ""}.
        {proyeccion.descuenta ? ` ${proyeccion.disponibles} disponible(s) − ${dias} solicitado(s).` : " Este registro no descuenta saldo; los disponibles no cambian."}
      </p>
      {proyeccion.insuficiente && <p className="request-summary-alert" role="alert">Saldo insuficiente: se solicitan {dias} día(s) y hay {proyeccion.disponibles} disponible(s).</p>}
      {mostrarUso && <p>Los {uso.derecho} día(s) por derecho de {uso.anio} se pueden usar a partir del {fechaUsoDerecho(uso.aniversario)}, cuando se cumple el año de servicio; antes de esa fecha hay {uso.disponiblesAntes} disponible(s).</p>}
      {descuentaSaldo && uso?.excedido && <p className="request-summary-alert" role="alert">Esta solicitud usa {uso.diasAntes} día(s) antes del {fechaUsoDerecho(uso.aniversario)} y solo hay {uso.disponiblesAntes} disponible(s) antes de esa fecha: no podrá registrarse.</p>}
      {proyeccion.descuenta && proyeccion.enTramite > 0 && !proyeccion.insuficiente && (
        <p>Hay {proyeccion.enTramite} día(s) más en otras solicitudes pendientes o planeadas; si también se aprueban, {proyeccion.restantesConTramite >= 0 ? `quedarían ${proyeccion.restantesConTramite}` : `faltarían ${-proyeccion.restantesConTramite} día(s) de saldo`}.</p>
      )}
      {fueraDelAnio && <p>El saldo mostrado es de {anio}; los días de otro año se descuentan del saldo de ese año.</p>}
    </section>
  );
}
