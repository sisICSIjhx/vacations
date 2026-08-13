import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = 3411;
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));

async function waitForServer(deadline) {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://localhost:${PORT}/`);
      return response;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("timed out waiting for next start to respond");
}

async function withServer(run) {
  const server = spawn(process.execPath, [nextBin, "start", "-p", String(PORT)], {
    cwd: projectRoot,
    stdio: "ignore",
  });
  try {
    const response = await waitForServer(Date.now() + 30000);
    await run(response);
  } finally {
    server.kill();
    await once(server, "exit").catch(() => {});
  }
}

test("renderiza la pagina principal de ICSI Vacaciones", async () => {
  await withServer(async (response) => {
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    const html = await response.text();
    assert.match(html, /<title>ICSI Vacaciones \| Administración<\/title>/i);
    // El estado inicial depende de si hay credenciales de Supabase configuradas:
    // sin ellas muestra el login/demo, con ellas muestra la pantalla de verificación de sesión.
    assert.match(html, /Acceso administrativo|Inicia sesión|Preparando el panel/i);
    assert.doesNotMatch(html, /Internal Server Error|Application error/i);
  });
});
