import assert from 'node:assert/strict';
import test from 'node:test';
import { cambioSaldo, validarAjusteSaldo } from '../app/lib/ajusteSaldo.ts';
import { puedeVerEvento } from '../app/lib/historial.ts';
const saldo = { diasPorDerecho: 12, diasAcumulados: 0, diasDisponibles: 12 };
const formulario = { id: 'prueba', ...saldo, saldoAnterior: saldo };
const perfil = rol => ({ activo: true, rol });
test('exige motivo en aumentos y descuentos de cualquiera de los tres campos', () => {
  for (const campo of Object.keys(saldo)) for (const delta of [-1, 1]) {
    if (saldo[campo] + delta < 0) continue;
    const ajustado = { ...formulario, [campo]: saldo[campo] + delta };
    assert.equal(cambioSaldo(ajustado), true);
    for (const motivoAjuste of ['', ' \n\t ', undefined]) assert.match(validarAjusteSaldo({ ...ajustado, motivoAjuste }, perfil('rrhh')), /motivo/);
    assert.equal(validarAjusteSaldo({ ...ajustado, motivoAjuste: 'Corrección justificada' }, perfil('rrhh')), null);
  }
});
test('descuento de cuatro días permitido para los tres roles y bloqueado para los demás', () => {
  const ajuste = { ...formulario, diasDisponibles: 8, motivoAjuste: 'Descuento de 4 días por ausencias solicitado por el empleado' };
  for (const rol of ['administrador','rrhh','mesa_directiva']) assert.equal(validarAjusteSaldo(ajuste, perfil(rol)), null);
  for (const p of [null, perfil('empleado'), { ...perfil('empleado'), esJefeInmediato: true }, { ...perfil('administrador'), activo: false }]) assert.match(validarAjusteSaldo(ajuste, p), /permiso/);
});
test('no exige motivo sin cambio; mesa no crea saldos y se rechazan valores inválidos', () => {
  assert.equal(cambioSaldo(formulario), false);
  assert.equal(validarAjusteSaldo(formulario, perfil('rrhh')), null);
  assert.match(validarAjusteSaldo({ ...formulario, saldoAnterior: undefined }, perfil('mesa_directiva')), /inicial/);
  for (const diasDisponibles of [-1, NaN, Infinity]) assert.match(validarAjusteSaldo({ ...formulario, diasDisponibles }, perfil('rrhh')), /cantidades/);
});
test('mesa consulta saldos sin ampliar acceso a personal o accesos', () => {
  for (const modulo of ['solicitudes','saldos']) assert.equal(puedeVerEvento({ modulo }, perfil('mesa_directiva'), {}), true);
  for (const modulo of ['personal','accesos']) assert.equal(puedeVerEvento({ modulo }, perfil('mesa_directiva'), {}), false);
});
