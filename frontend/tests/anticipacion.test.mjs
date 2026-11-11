import assert from "node:assert/strict";
import test from "node:test";
import { ANTICIPACION_MINIMA_DIAS, diasDeAnticipacion } from "../app/lib/anticipacion.ts";

test("calcula 16 días desde la fecha registrada hasta el inicio de las vacaciones", () => {
  assert.equal(diasDeAnticipacion("2026-11-04", "2026-10-19T18:00:00Z"), 16);
});

test("aplica el límite de 15 días según el día de la solicitud en Ciudad de México", () => {
  assert.equal(diasDeAnticipacion("2026-11-04", "2026-10-21T05:59:59Z"), ANTICIPACION_MINIMA_DIAS);
  assert.equal(diasDeAnticipacion("2026-11-04", "2026-10-21T06:00:00Z"), ANTICIPACION_MINIMA_DIAS - 1);
  assert.equal(diasDeAnticipacion("2026-11-04", "2026-10-20"), ANTICIPACION_MINIMA_DIAS);
});

test("identifica una fecha de solicitud ausente o inválida", () => {
  assert.equal(diasDeAnticipacion("2026-11-04"), null);
  assert.equal(diasDeAnticipacion("2026-11-04", "inválida"), null);
});
