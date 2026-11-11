// PostgreSQL embebido, fixture aislada con DDL real (001/004/017/022 + 026 + 030).
// No conecta a Supabase. PGLITE_MODULE debe apuntar a @electric-sql/pglite.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const sql = nombre => readFileSync(new URL(`../${nombre}`, import.meta.url), 'utf8');
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema vacaciones;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
grant usage on schema vacaciones, auth to authenticated, service_role;
`);
for (const nombre of ['001_esquema_inicial.sql','004_flujo_aprobacion_tres_niveles.sql','017_solicitudes_edicion.sql','022_conservar_dias_y_cancelar_con_motivo.sql']) {
  const tablas = sql(nombre).match(/create table if not exists vacaciones\.[\s\S]*?\n\);/gi) ?? [];
  for (const tabla of tablas) await db.exec(tabla);
}
await db.exec(sql('001_esquema_inicial.sql').match(/create or replace function vacaciones\.es_administrador\(\)[\s\S]*?\$\$;/)[0]);
await db.exec(`
alter table vacaciones.perfiles_usuario drop constraint perfiles_usuario_rol_check;
alter table vacaciones.empleados add column jefe_inmediato_id uuid;
alter table vacaciones.solicitudes_ausencia add column etapa_aprobacion text default 'rrhh', add column motivo_cancelacion text, add column cancelado_en timestamptz, add column cancelado_por uuid, add column cancelado_por_nombre text;
grant select on vacaciones.revisiones_solicitud to authenticated;
`);
const admin = '10000000-0000-0000-0000-000000000001', rrhh = '10000000-0000-0000-0000-000000000002', inactivo = '10000000-0000-0000-0000-000000000003';
const org = '20000000-0000-0000-0000-000000000001', emp = '30000000-0000-0000-0000-000000000001', tipo = '40000000-0000-0000-0000-000000000001', sol = '50000000-0000-0000-0000-000000000001';
const aprobada = '60000000-0000-0000-0000-000000000001', rechazada = '60000000-0000-0000-0000-000000000002';
await db.exec(`
insert into auth.users values ('${admin}'),('${rrhh}'),('${inactivo}');
insert into vacaciones.organizaciones(id,codigo,nombre) values ('${org}','PRUEBA','Organización de prueba');
insert into vacaciones.empleados(id,organizacion_id,numero_empleado,nombre_completo) values ('${emp}','${org}','P001','Persona de prueba');
insert into vacaciones.perfiles_usuario(usuario_id,nombre_visible,rol,activo) values ('${admin}','Administradora de prueba','administrador',true),('${rrhh}','RRHH de prueba','rrhh',true),('${inactivo}','Admin inactivo','administrador',false);
insert into vacaciones.tipos_ausencia(id,organizacion_id,codigo,nombre) values ('${tipo}','${org}','VAC','Vacaciones');
insert into vacaciones.solicitudes_ausencia(id,organizacion_id,empleado_id,tipo_ausencia_id,estado,fecha_inicio,fecha_fin) values ('${sol}','${org}','${emp}','${tipo}','pendiente','2026-11-20','2026-11-22');
`);
await db.exec(sql('026_historial_actividad.sql'));
await db.exec(`
insert into vacaciones.revisiones_solicitud(id,solicitud_ausencia_id,etapa,decision,estado_resultante,usuario_id,comentario) values
  ('${aprobada}','${sol}','rrhh','aprobado','jefe_inmediato','${rrhh}','Comentario equivocado'),
  ('${rechazada}','${sol}','jefe_inmediato','rechazado','rechazada','${rrhh}','Motivo con error');
`);
const migracion = sql('030_editar_comentario_revision.sql');
await db.exec(migracion);
await db.exec(migracion);

const como = usuario => db.exec(`reset role; select set_config('request.jwt.claim.sub','${usuario}',false), set_config('request.jwt.claim.role','authenticated',false); set role authenticated;`);
const editar = (id, comentario, motivo) => db.query('select vacaciones.editar_comentario_revision($1,$2,$3)', [id, comentario, motivo]);
const comentario = async id => (await db.query('select comentario from vacaciones.revisiones_solicitud where id = $1', [id])).rows[0].comentario;
const eventos = async () => (await db.query(`select * from vacaciones.historial_actividad where entidad = 'revisiones_solicitud' order by id`)).rows;
const inicial = (await eventos()).length;

await como(rrhh);
await assert.rejects(editar(aprobada, null, 'Prueba'), /Solo un administrador/, 'RRHH no puede editar');
await assert.rejects(db.exec(`update vacaciones.revisiones_solicitud set comentario = null where id = '${aprobada}'`), /permission denied/, 'sin escritura directa');
await como(inactivo);
await assert.rejects(editar(aprobada, null, 'Prueba'), /Solo un administrador/, 'administrador inactivo no puede editar');

await como(admin);
await assert.rejects(editar(aprobada, null, '   '), /motivo del cambio/, 'motivo obligatorio');
await assert.rejects(editar(aprobada, ' Comentario equivocado ', 'Sin cambio'), /no cambió/, 'sin cambios');
await assert.rejects(editar(rechazada, '  ', 'Quitar'), /Un rechazo debe conservar su motivo/, 'rechazo sin motivo');
await assert.rejects(editar('60000000-0000-0000-0000-000000000099', null, 'x'), /no existe/);
assert.equal((await eventos()).length, inicial, 'los intentos fallidos no dejan eventos');

await editar(aprobada, '   ', 'Lo escribió en la solicitud equivocada');
assert.equal(await comentario(aprobada), null, 'comentario quitado');
await editar(rechazada, 'Coincide con el cierre de mes', 'Corrección de redacción');
assert.equal(await comentario(rechazada), 'Coincide con el cierre de mes');

const nuevos = (await eventos()).slice(inicial);
assert.equal(nuevos.length, 2, 'un evento por corrección');
assert.ok(nuevos.every(e => e.accion === 'edicion_comentario'), 'no aparece como aprobación o rechazo nuevos');
assert.equal(nuevos[0].actor_nombre, 'Administradora de prueba');
assert.equal(nuevos[0].motivo, 'Lo escribió en la solicitud equivocada');
assert.deepEqual(nuevos[0].anteriores, { comentario: 'Comentario equivocado' });
assert.deepEqual(nuevos[0].nuevos, { comentario: null, etapa: 'rrhh' });
assert.deepEqual(nuevos[1].nuevos, { comentario: 'Coincide con el cierre de mes', etapa: 'jefe_inmediato' });

const revision = (await db.query(`select decision, estado_resultante from vacaciones.revisiones_solicitud where id = '${aprobada}'`)).rows[0];
assert.deepEqual(revision, { decision: 'aprobado', estado_resultante: 'jefe_inmediato' }, 'la decisión no cambia');
console.log('comentario-revision: ok');
