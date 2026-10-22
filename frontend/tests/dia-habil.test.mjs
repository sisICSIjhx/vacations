import assert from "node:assert/strict";
import test from "node:test";
import { diasVacaciones, siguienteDiaHabil } from "../app/lib/diaHabil.ts";

const DOMINGO = 0;
const SABADO = 6;
const navidad = { id: "f-1", fecha: "2026-12-25", nombre: "Navidad", repeticion: "fecha" };
const anioNuevo = { id: "f-2", fecha: "2026-01-01", nombre: "Año Nuevo", repeticion: "fecha" };
const festivoSede = { id: "f-3", fecha: "2026-11-23", nombre: "Fiesta local", repeticion: "ninguna", sedeId: "sede-a" };

test("con descanso en domingo regresa el sábado siguiente", () => {
  assert.equal(siguienteDiaHabil("2027-01-15", DOMINGO, [anioNuevo]), "2027-01-16");
  assert.equal(siguienteDiaHabil("2027-01-16", DOMINGO, [anioNuevo]), "2027-01-18");
});

test("salta el día de descanso y los festivos encadenados", () => {
  assert.equal(siguienteDiaHabil("2026-12-24", DOMINGO, [navidad]), "2026-12-26");
  assert.equal(siguienteDiaHabil("2026-12-31", SABADO, [anioNuevo]), "2027-01-03");
});

test("solo considera los festivos globales o de la sede del empleado", () => {
  assert.equal(siguienteDiaHabil("2026-11-22", DOMINGO, [festivoSede], "sede-a"), "2026-11-24");
  assert.equal(siguienteDiaHabil("2026-11-22", DOMINGO, [festivoSede], "sede-b"), "2026-11-23");
});

test("sin descanso definido conserva lunes a viernes y salta festivos", () => {
  assert.equal(siguienteDiaHabil("2027-01-15"), "2027-01-18");
  assert.equal(siguienteDiaHabil("2026-12-24", undefined, [navidad]), "2026-12-28");
  assert.equal(siguienteDiaHabil(""), "");
});

test("los días descontados excluyen el descanso y los festivos del periodo", () => {
  assert.equal(diasVacaciones("2026-12-28", "2027-01-15", DOMINGO, [anioNuevo]), 16);
});
