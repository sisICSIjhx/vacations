// PostgreSQL embebido con la vista de días (019), el aviso de cambio de
// solicitud (016) y el recordatorio (029): los avisos de WhatsApp mandan los
// días que descuenta la solicitud, sin el día de descanso ni festivos.
// No conecta a Supabase ni a Green API. Ejecutar con node --experimental-strip-types.
// PGLITE_MODULE debe apuntar a @electric-sql/pglite.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const sql = nombre => readFileSync(new URL(`../${nombre}`, import.meta.url), 'utf8');
const funcion = (archivo, nombre) => {
  const texto = sql(archivo);
  const inicio = texto.indexOf(`create or replace function vacaciones.${nombre}(`);
  assert.ok(inicio >= 0, nombre);
  return texto.slice(inicio, texto.indexOf('$$;', texto.indexOf('as $$', inicio)) + 3);
};
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema vacaciones;
create table auth.users(id uuid primary key);
`);
for (const nombre of ['001_esquema_inicial.sql','004_flujo_aprobacion_tres_niveles.sql','008_notificaciones_whatsapp.sql']) {
  for (const tabla of sql(nombre).match(/create table if not exists vacaciones\.[\s\S]*?\n\);/gi) ?? []) await db.exec(tabla);
}
await db.exec(`
alter table vacaciones.empleados add column if not exists jefe_inmediato_id uuid, add column if not exists dia_descanso smallint,
  add column if not exists telefono_whatsapp varchar(10);
alter table vacaciones.solicitudes_ausencia
  add column if not exists etapa_aprobacion text default 'rrhh', add column if not exists etapa_rechazo text,
  add column if not exists descuenta_saldo boolean not null default true, add column if not exists registro_extemporaneo boolean not null default false,
  add column if not exists dia_descanso smallint;
alter table vacaciones.dias_festivos add column if not exists repeticion text not null default 'ninguna';
`);
for (const [archivo, nombre] of [
  ['016_dia_descanso_empleado.sql','copiar_dia_descanso_solicitud'],
  ['016_dia_descanso_empleado.sql','notificar_cambio_solicitud'],
  ['019_festivos_cada_anio.sql','festivo_en_fecha'],
  ['010_avisos_empleado_y_recordatorios.sql','en_etapa_desde'],
]) await db.exec(funcion(archivo, nombre));
const vista = sql('019_festivos_cada_anio.sql');
const inicioVista = vista.indexOf('create or replace view vacaciones.v_dias_solicitud_calendario');
await db.exec(vista.slice(inicioVista, vista.indexOf(';', vista.indexOf('ta.eliminado_en is null', inicioVista)) + 1));
await db.exec(`
create trigger copiar_dia_descanso_solicitud before insert or update of empleado_id, fecha_inicio, fecha_fin
  on vacaciones.solicitudes_ausencia for each row execute function vacaciones.copiar_dia_descanso_solicitud();
create constraint trigger trg_notificar_cambio_solicitud after insert or update of etapa_aprobacion
  on vacaciones.solicitudes_ausencia deferrable initially deferred for each row execute function vacaciones.notificar_cambio_solicitud();
`);
const migracion = sql('029_dias_reales_en_recordatorios.sql');
await db.exec(migracion);
await db.exec(migracion); // Reejecución segura.

const org = '20000000-0000-0000-0000-000000000001', tipo = '40000000-0000-0000-0000-000000000001';
const emp = '30000000-0000-0000-0000-000000000001';
await db.exec(`
insert into vacaciones.organizaciones(id,codigo,nombre) values ('${org}','PRUEBA','Organización de prueba');
insert into vacaciones.tipos_ausencia(id,organizacion_id,codigo,nombre,metodo_conteo,excluir_dias_festivos) values ('${tipo}','${org}','VACACIONES','Vacaciones','dias_naturales',true);
-- Tercer lunes de noviembre, capturado en 2026 y repetido cada año.
insert into vacaciones.dias_festivos(organizacion_id,fecha,nombre,repeticion) values ('${org}','2026-11-16','Revolución Mexicana','dia_semana');
insert into vacaciones.empleados(id,organizacion_id,numero_empleado,nombre_completo,fecha_ingreso,dia_descanso) values ('${emp}','${org}','P001','Persona 1','2020-01-06',0);
`);
const solicitar = async (inicio, fin) => (await db.query(
  `insert into vacaciones.solicitudes_ausencia(organizacion_id,empleado_id,tipo_ausencia_id,estado,fecha_inicio,fecha_fin,origen,solicitado_en)
   values ($1,$2,$3,'pendiente',$4,$5,'empleado',now() - interval '3 days') returning id`, [org, emp, tipo, inicio, fin])).rows[0].id;
const campos = mensaje => Object.fromEntries(mensaje.split(' | ').map(p => [p.slice(0, p.indexOf(':')), p.slice(p.indexOf(':') + 1).trim()]));
const aviso = async (id, tipoAviso) => (await db.query(
  `select id, tipo, titulo, mensaje from vacaciones.notificaciones where solicitud_ausencia_id=$1 and tipo=$2 order by creado_en desc limit 1`, [id, tipoAviso])).rows[0];

// Caso del reporte: 03/11 al 10/11/2026 son 8 días naturales; el domingo 08/11 es descanso.
const reporte = await solicitar('2026-11-03', '2026-11-10');
// Con festivo: 16/11 al 22/11/2026 son 7 naturales, menos el festivo y el domingo.
const festivo = await solicitar('2026-11-16', '2026-11-22');
const soloFestivo = await solicitar('2026-11-16', '2026-11-16');

const avisoReporte = await aviso(reporte, 'solicitud_nueva');
const avisoFestivo = await aviso(festivo, 'solicitud_nueva');
const avisoSinDescuento = await aviso(soloFestivo, 'solicitud_nueva');
assert.equal(campos(avisoReporte.mensaje)['Días'], '7');
assert.equal(campos(avisoFestivo.mensaje)['Días'], '5');
assert.equal(campos(avisoSinDescuento.mensaje)['Días'], '0');

assert.equal((await db.query(`select vacaciones.enviar_recordatorios_pendientes() n`)).rows[0].n, 3);
const avisoRecordatorio = await aviso(reporte, 'recordatorio');
const recordatorio = campos(avisoRecordatorio.mensaje);
assert.equal(recordatorio['Días'], '7');
assert.equal(recordatorio['Del'], '03/11/2026');
assert.equal(recordatorio['Pendiente de'], 'RRHH');
assert.equal(recordatorio['Días en espera'], '3');
assert.equal(campos((await aviso(festivo, 'recordatorio')).mensaje)['Días'], '5');
// No repite el recordatorio dentro de 20 horas.
assert.equal((await db.query(`select vacaciones.enviar_recordatorios_pendientes() n`)).rows[0].n, 0);
await db.close();

let atenderAviso;
let mensajeWhatsApp;
const entorno = new Map([
  ['WEBHOOK_SECRET', 'prueba'],
  ['GREENAPI_API_URL', 'https://green-api.example.test'],
  ['GREENAPI_ID_INSTANCE', 'prueba'],
  ['GREENAPI_API_TOKEN_INSTANCE', 'prueba'],
  ['GREENAPI_CHAT_ID', 'prueba@g.us'],
]);
globalThis.Deno = { env: entorno, serve: atender => { atenderAviso = atender; } };
globalThis.fetch = async (_url, opciones) => {
  mensajeWhatsApp = JSON.parse(opciones.body).message;
  return new Response(null, { status: 200 });
};
await import('../../supabase/functions/notificar/index.ts');

async function textoWhatsApp(aviso) {
  mensajeWhatsApp = undefined;
  const respuesta = await atenderAviso(new Request('https://webhook.example.test', {
    method: 'POST',
    headers: { 'x-webhook-secret': 'prueba' },
    body: JSON.stringify(aviso),
  }));
  assert.equal((await respuesta.json()).resultado.enviado, true);
  return mensajeWhatsApp;
}

assert.match(await textoWhatsApp(avisoReporte), /03\/11\/2026 al 10\/11\/2026 \(7 días\)/);
assert.match(await textoWhatsApp(avisoFestivo), /16\/11\/2026 al 22\/11\/2026 \(5 días\)/);
assert.match(await textoWhatsApp(avisoRecordatorio), /03\/11\/2026 al 10\/11\/2026 \(7 días\)/);
assert.match(await textoWhatsApp(avisoSinDescuento), /16\/11\/2026 al 16\/11\/2026 \(0 días\)/);

const avisoAnterior = { ...avisoReporte, mensaje: avisoReporte.mensaje.replace(' | Días: 7', '') };
assert.match(await textoWhatsApp(avisoAnterior), /03\/11\/2026 al 10\/11\/2026\n/);

console.log('dias-avisos: OK');
