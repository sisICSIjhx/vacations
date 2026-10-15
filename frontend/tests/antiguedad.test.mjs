import assert from "node:assert/strict";
import test from "node:test";
import { antiguedadEnAnio, diasPorDerechoEnAnio, diasVacacionesLft } from "../app/lib/antiguedad.ts";

test("días por derecho según el art. 76 de la LFT", () => {
  const esperado = new Map([
    [0, 0], [1, 12], [2, 14], [3, 16], [4, 18], [5, 20],
    [6, 22], [10, 22], [11, 24], [15, 24], [16, 26], [20, 26],
    [21, 28], [25, 28], [26, 30], [30, 30], [31, 32],
  ]);
  for (const [anios, dias] of esperado) assert.equal(diasVacacionesLft(anios), dias, `${anios} año(s)`);
});

test("la antigüedad es la que se cumple dentro del año", () => {
  assert.equal(antiguedadEnAnio("2020-03-15", 2027), 7);
  assert.equal(antiguedadEnAnio("2027-02-01", 2027), 0);
  assert.equal(antiguedadEnAnio(undefined, 2027), undefined);
  assert.equal(diasPorDerechoEnAnio("2025-10-20", 2026), 12);
  assert.equal(diasPorDerechoEnAnio("2024-05-10", 2027), 16);
  assert.equal(diasPorDerechoEnAnio("2027-02-01", 2027), 0);
});
