// PostgreSQL embebido, fixture aislada con DDL real. No conecta a Supabase.
// PGLITE_MODULE debe apuntar a la instalación temporal de @electric-sql/pglite.
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
await db.exec(`
alter table vacaciones.perfiles_usuario drop constraint perfiles_usuario_rol_check;
alter table vacaciones.empleados add column jefe_inmediato_id uuid;
alter table vacaciones.solicitudes_ausencia add column etapa_aprobacion text default 'rrhh', add column motivo_cancelacion text, add column cancelado_en timestamptz, add column cancelado_por uuid, add column cancelado_por_nombre text;
`);
const admin = '10000000-0000-0000-0000-000000000001', empleado = '10000000-0000-0000-0000-000000000002', otro = '10000000-0000-0000-0000-000000000003';
const org = '20000000-0000-0000-0000-000000000001', emp = '30000000-0000-0000-0000-000000000001', tipo = '40000000-0000-0000-0000-000000000001', sol = '50000000-0000-0000-0000-000000000001';
await db.exec(`
insert into auth.users values ('${admin}'),('${empleado}'),('${otro}');
insert into vacaciones.organizaciones(id,codigo,nombre) values ('${org}','PRUEBA','Organización de prueba');
insert into vacaciones.empleados(id,organizacion_id,numero_empleado,nombre_completo) values ('${emp}','${org}','P001','Persona de prueba');
insert into vacaciones.perfiles_usuario(usuario_id,empleado_id,nombre_visible,rol) values ('${admin}',null,'Administradora de prueba','administrador'),('${empleado}','${emp}','Empleado de prueba','empleado'),('${otro}',null,'Otro usuario','empleado');
insert into vacaciones.tipos_ausencia(id,organizacion_id,codigo,nombre) values ('${tipo}','${org}','VAC','Vacaciones');
insert into vacaciones.solicitudes_ausencia(id,organizacion_id,empleado_id,tipo_ausencia_id,estado,fecha_inicio,fecha_fin) values ('${sol}','${org}','${emp}','${tipo}','aprobada','2026-10-20','2026-10-22');
insert into vacaciones.historial_estados_solicitud(solicitud_ausencia_id,estado_nuevo,cambiado_en) values ('${sol}','aprobada','2026-09-01');
insert into vacaciones.revisiones_solicitud(solicitud_ausencia_id,etapa,decision,estado_resultante,usuario_id,creado_en) values ('${sol}','mesa_directiva','aprobado','aprobada','${admin}','2026-09-01');
`);
const migracion = sql('026_historial_actividad.sql');
await db.exec(migracion);
const count = async (where='true') => Number((await db.query(`select count(*) n from vacaciones.historial_actividad where ${where}`)).rows[0].n);
assert.equal(await count(), 2, 'recupera evidencia anterior');
await db.exec(migracion);
assert.equal(await count(), 2, 'recuperación idempotente');
await db.exec(`select set_config('request.jwt.claim.sub','${admin}',false),set_config('request.jwt.claim.role','authenticated',false);`);
await db.exec(`begin; update vacaciones.solicitudes_ausencia set estado='cancelada' where id='${sol}'; update vacaciones.solicitudes_ausencia set motivo_cancelacion='No se utilizaron',cancelado_en=now(),cancelado_por='${admin}',cancelado_por_nombre='Administradora de prueba' where id='${sol}'; commit;`);
assert.equal(await count("accion='cancelacion'"), 1, 'una cancelación, no dos');
const cancelacion = (await db.query("select * from vacaciones.historial_actividad where accion='cancelacion'")).rows[0];
assert.equal(cancelacion.actor_nombre,'Administradora de prueba');
assert.equal(cancelacion.motivo,'No se utilizaron');
await db.exec(`insert into vacaciones.dias_conservados_solicitud(solicitud_ausencia_id,empleado_id,tipo_ausencia_id,anio,dias) values ('${sol}','${emp}','${tipo}',2026,3);`);
assert.equal(await count("modulo='saldos'"), 1, 'clave compuesta de días conservados');
const previo = await count();
await db.exec(`begin; update vacaciones.empleados set nombre_completo='Cambio revertido' where id='${emp}'; rollback;`);
assert.equal(await count(), previo, 'rollback revierte también el evento');
await db.exec(`update vacaciones.empleados set actualizado_en=now() where id='${emp}';`);
assert.equal(await count(), previo, 'sin ruido por fecha técnica');
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${otro}',false);`);
assert.equal(await count(), 0, 'empleado ajeno no ve eventos');
await db.exec(`select set_config('request.jwt.claim.sub','${empleado}',false);`);
assert.equal(await count(), 3, 'empleado solo ve eventos de su solicitud, no saldos generales');
await assert.rejects(db.exec(`insert into vacaciones.historial_actividad(actor_nombre,modulo,entidad,registro_id,sujeto,accion) values ('Falso','solicitudes','x','x','x','creacion')`), /permission denied/);
await assert.rejects(db.exec(`update vacaciones.historial_actividad set actor_nombre='Falso'`), /permission denied/);
await assert.rejects(db.exec(`delete from vacaciones.historial_actividad`), /permission denied/);
await assert.rejects(db.exec(`select vacaciones.registrar_cambio_acceso('${admin}','contrasena_cambiada','{}')`), /permission denied/);
await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','service_role',false),set_config('request.headers','{"x-vacaciones-actor-id":"${admin}"}',false);`);
await db.exec(`update vacaciones.empleados set nombre_completo='Nombre corregido' where id='${emp}'; select vacaciones.registrar_cambio_acceso('${empleado}','contrasena_restablecida','{"password":"NUNCA-GUARDAR"}');`);
assert.equal((await db.query("select actor_nombre from vacaciones.historial_actividad where modulo='personal'")).rows[0].actor_nombre, 'Administradora de prueba');
assert.doesNotMatch(JSON.stringify((await db.query("select * from vacaciones.historial_actividad")).rows), /NUNCA-GUARDAR/);
await db.exec(`select set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claim.sub','${empleado}',false); update vacaciones.solicitudes_ausencia set comentarios='Comentario propio' where id='${sol}';`);
assert.equal((await db.query("select actor_nombre from vacaciones.historial_actividad order by id desc limit 1")).rows[0].actor_nombre,'Empleado de prueba','cabecera falsa ignorada para authenticated');
await db.exec(`delete from vacaciones.solicitudes_ausencia where id='${sol}';`);
assert.ok(await count("accion='cancelacion'") > 0, 'evidencia sobrevive borrado físico');
console.log('OK: migración SQL, recuperación idempotente, cancelación, autor, clave compuesta, rollback, RLS, escritura denegada, secretos excluidos y conservación tras borrado.');
await db.close();
