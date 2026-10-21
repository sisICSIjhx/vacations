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
insert into vacaciones.tipos_ausencia(id,organizacion_id,codigo,nombre) values ('${tipo}','${org}','VACACIONES','Vacaciones');
insert into vacaciones.solicitudes_ausencia(id,organizacion_id,empleado_id,tipo_ausencia_id,estado,fecha_inicio,fecha_fin) values ('${sol}','${org}','${emp}','${tipo}','aprobada','2026-10-20','2026-10-22');
insert into vacaciones.historial_estados_solicitud(solicitud_ausencia_id,estado_nuevo,cambiado_en) values ('${sol}','aprobada','2026-09-01');
insert into vacaciones.revisiones_solicitud(solicitud_ausencia_id,etapa,decision,estado_resultante,usuario_id,creado_en) values ('${sol}','mesa_directiva','aprobado','aprobada','${admin}','2026-09-01');
`);
await db.exec(`
alter table vacaciones.asignaciones_ausencia add column derecho_otorgado_en date, add column arrastre_automatico boolean not null default false;
grant select, insert, update, delete on vacaciones.asignaciones_ausencia to authenticated;
`);
const funcion = (archivo, nombre) => {
  const texto = sql(archivo);
  const inicio = texto.indexOf(`create or replace function vacaciones.${nombre}(`);
  assert.ok(inicio >= 0, nombre);
  return texto.slice(inicio, texto.indexOf('$$;', texto.indexOf('as $$', inicio)) + 3);
};
await db.exec(funcion('001_esquema_inicial.sql','es_administrador'));
await db.exec(funcion('012_solicitudes_extemporaneas.sql','cambiar_estado_solicitud'));
await db.exec(`alter table vacaciones.solicitudes_ausencia add column etapa_rechazo text, add column descuenta_saldo boolean default true;
-- Calendario de fixture: tres días. Se prueba permisos y transacción, no el cálculo de calendario.
create view vacaciones.v_dias_solicitud_calendario as select id solicitud_ausencia_id,fecha_inicio fecha_calendario,3::numeric dias_descontados from vacaciones.solicitudes_ausencia;`);
await db.exec(sql('026_historial_actividad.sql'));
await db.exec(sql('027_ajuste_saldo_con_motivo.sql'));
await db.exec(sql('027_ajuste_saldo_con_motivo.sql')); // Reejecución segura.
for (const [archivo, nombre] of [
  ['023_saldos_anuales_por_antiguedad.sql','dias_vacaciones_lft'],
  ['023_saldos_anuales_por_antiguedad.sql','arrastrar_saldo_anio_siguiente'],
  ['024_dias_por_derecho_en_aniversario.sql','aniversario_ingreso'],
  ['024_dias_por_derecho_en_aniversario.sql','otorgar_dias_aniversario'],
]) await db.exec(funcion(archivo,nombre));
await db.exec(`create trigger arrastrar_saldo_anio_siguiente after insert or update of dias_disponibles on vacaciones.asignaciones_ausencia for each row execute function vacaciones.arrastrar_saldo_anio_siguiente();`);
const como = async rol => {
  await db.exec(`reset role; update vacaciones.perfiles_usuario set rol='${rol}',activo=true,eliminado_en=null where usuario_id='${admin}'; select set_config('request.jwt.claim.sub','${admin}',false),set_config('request.jwt.claim.role','authenticated',false); set role authenticated;`);
};
const saldo = (disponibles=12) => ({ diasPorDerecho:12,diasAcumulados:0,diasDisponibles:disponibles });
const ajustar = (dias, anterior, motivo, anio=2026, derecho=12, acumulados=0) => db.query('select vacaciones.guardar_saldo_vacaciones($1,$2,$3,$4,$5,$6,$7)',[emp,anio,derecho,acumulados,dias,anterior === null ? null : JSON.stringify(anterior),motivo]);
const disponibles = async () => Number((await db.query(`select dias_disponibles from vacaciones.asignaciones_ausencia where empleado_id='${emp}' and anio_asignacion=2026`)).rows[0].dias_disponibles);
await como('administrador');
await ajustar(12,null,null);
for (const motivo of [null,'','   ','\t\n']) await assert.rejects(ajustar(8,saldo(),motivo),/motivo/);
assert.equal(await disponibles(),12);
for (const rol of ['administrador','rrhh','mesa_directiva']) {
  await como(rol);
  await ajustar(8,saldo(),'  Descuento de cuatro días solicitado por el empleado  ');
  assert.equal(await disponibles(),8);
  const evento = (await db.query("select * from vacaciones.historial_actividad where modulo='saldos' order by id desc limit 1")).rows[0];
  assert.equal(evento.actor_id,admin);
  assert.equal(evento.actor_nombre,'Administradora de prueba');
  assert.equal(evento.motivo,'Descuento de cuatro días solicitado por el empleado');
  assert.equal(evento.anteriores.dias_disponibles,12);
  assert.equal(evento.nuevos.dias_disponibles,8);
  assert.equal(evento.nuevos.anio_asignacion,2026);
  assert.ok(evento.ocurrido_en);
  await assert.rejects(ajustar(10,saldo(),'Datos viejos'),/Recarga/);
  await assert.rejects(ajustar(10,null,'Intento de alta'),/Recarga/);
  await assert.rejects(db.exec(`update vacaciones.asignaciones_ausencia set dias_disponibles=20`),/permission denied/);
  await assert.rejects(db.exec(`delete from vacaciones.asignaciones_ausencia`),/permission denied/);
  await assert.rejects(db.exec(`insert into vacaciones.asignaciones_ausencia(empleado_id,tipo_ausencia_id,anio_asignacion) values('${emp}','${tipo}',2030)`),/permission denied/);
  await ajustar(12,saldo(8),'Reintegro justificado');

}
await como('mesa_directiva');
await assert.rejects(ajustar(0,null,null,2027,0),/saldo inicial/);
await assert.rejects(ajustar(12,saldo(),null,2026,14),/motivo/);
await assert.rejects(ajustar(12,saldo(),'  ',2026,12,1),/motivo/);
await assert.rejects(ajustar(-1,saldo(),'Inválido'),/cantidades/);
await assert.rejects(ajustar(10,saldo(),'x'.repeat(2001)),/2000/);
const cuenta = async () => Number((await db.query("select count(*) n from vacaciones.historial_actividad where modulo='saldos'")).rows[0].n);
const sinCambio = await cuenta();
await ajustar(12,saldo(),null);
assert.equal(await cuenta(),sinCambio,'no crea evento sin cambio');
await db.exec('begin'); await ajustar(8,saldo(),'No confirmar'); await db.exec('rollback');
assert.equal(await disponibles(),12);
assert.equal(await cuenta(),sinCambio);
assert.equal((await db.query(`select vacaciones.puede_leer_actividad('personal','${emp}') permitido`)).rows[0].permitido,false);
for (const rol of ['empleado','otro']) {
  await como(rol);
  await assert.rejects(ajustar(8,saldo(),'No autorizado'),/Solo Administración/);
}
await como('administrador');
await db.exec(`reset role; update vacaciones.perfiles_usuario set activo=false where usuario_id='${admin}'; set role authenticated;`);
await assert.rejects(ajustar(8,saldo(),'Inactivo'),/Solo Administración/);
await db.exec(`reset role; set role anon;`);
await assert.rejects(ajustar(8,saldo(),'Anónimo'),/permission denied/);
await como('administrador');
// Procesos reales: arrastre propaga la diferencia y aniversario sigue sumando.
await ajustar(12,null,null,2027,0,12);
await db.exec(`reset role; update vacaciones.asignaciones_ausencia set arrastre_automatico=true where anio_asignacion=2027; set role authenticated;`);
await ajustar(8,saldo(),'Descuento con arrastre');
assert.equal(Number((await db.query(`select dias_disponibles from vacaciones.asignaciones_ausencia where anio_asignacion=2027`)).rows[0].dias_disponibles),8);
await db.exec(`reset role; update vacaciones.empleados set fecha_ingreso='2025-01-01' where id='${emp}'; select vacaciones.otorgar_dias_aniversario('2027-01-01');`);
assert.equal(Number((await db.query(`select dias_disponibles from vacaciones.asignaciones_ausencia where anio_asignacion=2027`)).rows[0].dias_disponibles),22);
// Fallo de auditoría revierte también el saldo.
await db.exec(`create function vacaciones.fallar_auditoria_prueba() returns trigger language plpgsql as $$ begin if new.motivo='Forzar fallo' then raise exception 'Auditoria no disponible'; end if; return new; end; $$; create trigger fallo_prueba before update on vacaciones.historial_actividad for each row execute function vacaciones.fallar_auditoria_prueba();`);
await como('rrhh');
await assert.rejects(ajustar(7,saldo(8),'Forzar fallo'),/Auditoria no disponible/);
assert.equal(await disponibles(),8);
await como('administrador');
await db.query('select vacaciones.cambiar_estado_solicitud($1,$2,$3)',[sol,'cancelada','Prueba de devolución por solicitud']);
assert.equal(await disponibles(),11,'reintegra tres días con escritura directa revocada');
await db.query('select vacaciones.cambiar_estado_solicitud($1,$2,$3)',[sol,'aprobada','Prueba de descuento por solicitud']);
assert.equal(await disponibles(),8,'descuenta tres días con escritura directa revocada');
await como('mesa_directiva');
await assert.rejects(db.query('select vacaciones.cambiar_estado_solicitud($1,$2,$3)',[sol,'cancelada','No autorizado']),/Solo un administrador/);
console.log('OK: 027 idempotente, tres roles, motivo, autor, antes/después, concurrencia, escritura directa denegada, inactivo/anónimo, rollback, arrastre y aniversario reales.');
await db.close();
