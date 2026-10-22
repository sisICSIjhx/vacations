import assert from "node:assert/strict";
import test from "node:test";
import { mensajeUsoDerecho, proyectarSaldo, usoDiasPorDerecho } from "../app/lib/proyeccionSaldo.ts";

const saldo = { diasDisponibles: 9, diasPendientes: 0, diasPlaneados: 0 };

test("resta los días solicitados de los disponibles", () => {
  const proyeccion = proyectarSaldo(saldo, 5);
  assert.equal(proyeccion.dias, 5);
  assert.equal(proyeccion.disponibles, 9);
  assert.equal(proyeccion.restantes, 4);
  assert.equal(proyeccion.insuficiente, false);
});

test("marca saldo insuficiente solo cuando se supera lo disponible", () => {
  assert.equal(proyectarSaldo(saldo, 9).insuficiente, false);
  assert.equal(proyectarSaldo(saldo, 9).restantes, 0);
  const excedida = proyectarSaldo(saldo, 11);
  assert.equal(excedida.insuficiente, true);
  assert.equal(excedida.restantes, -2);
});

test("informa aparte los días de otras solicitudes en trámite", () => {
  const proyeccion = proyectarSaldo({ diasDisponibles: 14, diasPendientes: 3, diasPlaneados: 2 }, 4);
  assert.equal(proyeccion.restantes, 10);
  assert.equal(proyeccion.enTramite, 5);
  assert.equal(proyeccion.restantesConTramite, 5);
});

test("un registro que no descuenta conserva los disponibles", () => {
  const proyeccion = proyectarSaldo(saldo, 12, false);
  assert.equal(proyeccion.descuenta, false);
  assert.equal(proyeccion.restantes, 9);
  assert.equal(proyeccion.insuficiente, false);
});

test("redondea medios días sin errores de coma flotante", () => {
  assert.equal(proyectarSaldo({ diasDisponibles: 0.3, diasPendientes: 0.1, diasPlaneados: 0.2 }, 0.1).restantesConTramite, -0.1);
  assert.equal(proyectarSaldo({ diasDisponibles: 7.5, diasPendientes: 0, diasPlaneados: 0 }, 2).restantes, 5.5);
});

// Mismos casos que database/tests/uso-derecho.mjs (028): descanso en domingo,
// cumple su año de servicio el 26 de diciembre.
const empleado = (diasPorDerecho, diasDisponibles) => ({
  id: "emp-1", fechaIngreso: "2023-12-26", diaDescanso: 0,
  saldo: { anio: 2026, diasPorDerecho, diasDisponibles, diasAcumulados: 0, diasTomados: 0, diasPlaneados: 0, diasPendientes: 0, fechaCorte: "2026-08-10" },
});
const periodo = (fechaInicio, fechaFin) => ({ fechaInicio, fechaFin });

test("los días por derecho no se usan antes del aniversario", () => {
  const uso = usoDiasPorDerecho(periodo("2026-11-16", "2026-11-20"), empleado(16, 16), []);
  assert.deepEqual(uso, { anio: 2026, aniversario: "2026-12-26", derecho: 16, disponiblesAntes: 0, diasAntes: 5, excedido: true });
  assert.match(mensajeUsoDerecho(uso), /a partir del 26 de diciembre de 2026.*hay 0 día\(s\) disponibles y la solicitud usa 5/);
});

test("un periodo desde el aniversario o que cruza de año no usa días antes", () => {
  assert.equal(usoDiasPorDerecho(periodo("2026-12-28", "2027-01-15"), empleado(16, 16), []).excedido, false);
  assert.equal(usoDiasPorDerecho(periodo("2026-12-28", "2027-01-15"), empleado(16, 16), []).diasAntes, 0);
});

test("los acumulados sí se usan antes y lo aprobado desde el aniversario no los amplía", () => {
  assert.equal(usoDiasPorDerecho(periodo("2026-11-02", "2026-11-06"), empleado(16, 21), []).excedido, false);
  assert.equal(usoDiasPorDerecho(periodo("2026-11-02", "2026-11-08"), empleado(16, 21), []).excedido, true);
  const aprobada = { id: "sol-1", empleadoId: "emp-1", estado: "aprobada", fechaInicio: "2026-12-26", fechaFin: "2026-12-30" };
  assert.equal(usoDiasPorDerecho(periodo("2026-11-02", "2026-11-06"), empleado(16, 17), [aprobada]).disponiblesAntes, 5);
});

test("sin días por derecho o sin fecha de ingreso no hay restricción", () => {
  assert.equal(usoDiasPorDerecho(periodo("2026-11-16", "2026-11-20"), empleado(0, 5), []), null);
  assert.equal(usoDiasPorDerecho(periodo("2026-11-16", "2026-11-20"), { ...empleado(16, 16), fechaIngreso: undefined }, []), null);
});
