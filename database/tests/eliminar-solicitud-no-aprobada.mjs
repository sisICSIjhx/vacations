// PostgreSQL embebido con la RPC real de 032 y los disparadores que la rodean
// (022 dias conservados, 025 ediciones huerfanas, 026 historial).
// No conecta a Supabase ni envia avisos. PGLITE_MODULE debe apuntar a
// node_modules/@electric-sql/pglite/dist/index.js de una instalacion temporal.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const sql = nombre => readFileSync(new URL(`../${nombre}`, import.meta.url), 'utf8');
const funcion = (archivo, nombre) => {
  const coincidencia = sql(archivo).match(new RegExp(`create or replace function vacaciones\\.${nombre}\\([\\s\\S]*?\\$\\$;`));
  assert.ok(coincidencia, `no se encontro ${nombre} en ${archivo}`);
  return coincidencia[0];
};

await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema vacaciones;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
  grant usage on schema vacaciones, auth to anon, authenticated, service_role;
`);

for (const archivo of ['001_esquema_inicial.sql', '004_flujo_aprobacion_tres_niveles.sql', '008_notificaciones_whatsapp.sql', '017_solicitudes_edicion.sql', '022_conservar_dias_y_cancelar_con_motivo.sql']) {
  for (const tabla of sql(archivo).match(/create table if not exists vacaciones\.[\s\S]*?\n\);/gi) ?? []) await db.exec(tabla);
}

await db.exec(`
  alter table vacaciones.perfiles_usuario drop constraint perfiles_usuario_rol_check;
  alter table vacaciones.empleados add column jefe_inmediato_id uuid;
  alter table vacaciones.solicitudes_ausencia
    add column etapa_aprobacion text default 'rrhh',
    add column descuenta_saldo boolean not null default true,
    add column motivo_cancelacion text, add column cancelado_en timestamptz,
    add column cancelado_por uuid, add column cancelado_por_nombre text;
  -- Un dia por solicitud vigente: basta para comprobar conservados y avisos.
  create view vacaciones.v_dias_solicitud_calendario as
    select id as solicitud_ausencia_id, fecha_inicio as fecha_calendario, 1::numeric as dias_descontados
    from vacaciones.solicitudes_ausencia where eliminado_en is null;
`);
await db.exec(funcion('001_esquema_inicial.sql', 'es_administrador'));
await db.exec(funcion('001_esquema_inicial.sql', 'empleado_actual_id'));
await db.exec(funcion('017_solicitudes_edicion.sql', 'nombre_usuario_actual'));
await db.exec(funcion('022_conservar_dias_y_cancelar_con_motivo.sql', 'ajustar_saldo_borrado_solicitud'));
await db.exec(`
  create trigger ajustar_saldo_antes_borrado
  before update of eliminado_en on vacaciones.solicitudes_ausencia
  for each row execute function vacaciones.ajustar_saldo_borrado_solicitud();
`);
await db.exec(sql('025_cerrar_ediciones_huerfanas.sql'));
await db.exec(sql('026_historial_actividad.sql'));
const migracion = sql('032_eliminar_solicitud_no_aprobada.sql');
await db.exec(migracion);
await db.exec(migracion); // seguro de re-ejecutar

const admin = '10000000-0000-0000-0000-000000000001';
const duenio = '10000000-0000-0000-0000-000000000002';
const otro = '10000000-0000-0000-0000-000000000003';
const inactivo = '10000000-0000-0000-0000-000000000004';
const org = '20000000-0000-0000-0000-000000000001';
const emp = '30000000-0000-0000-0000-000000000001';
const empOtro = '30000000-0000-0000-0000-000000000002';
const tipo = '40000000-0000-0000-0000-000000000001';
const sol = n => `50000000-0000-0000-0000-00000000000${n}`;
const [pendiente, planeada, aprobada, rechazada, cancelada, ajena, deAdmin, enMesa] = [1, 2, 3, 4, 5, 6, 7, 8].map(sol);

await db.exec(`
  insert into auth.users values ('${admin}'), ('${duenio}'), ('${otro}'), ('${inactivo}');
  insert into vacaciones.organizaciones (id, codigo, nombre) values ('${org}', 'PRUEBA', 'Organización de prueba');
  insert into vacaciones.empleados (id, organizacion_id, numero_empleado, nombre_completo)
    values ('${emp}', '${org}', 'P001', 'Persona de prueba'), ('${empOtro}', '${org}', 'P002', 'Otra persona');
  insert into vacaciones.perfiles_usuario (usuario_id, empleado_id, nombre_visible, rol, activo) values
    ('${admin}', null, 'Administradora de prueba', 'administrador', true),
    ('${duenio}', '${emp}', 'Persona de prueba', 'empleado', true),
    ('${otro}', '${empOtro}', 'Otra persona', 'empleado', true),
    ('${inactivo}', '${emp}', 'Acceso dado de baja', 'empleado', false);
  insert into vacaciones.tipos_ausencia (id, organizacion_id, codigo, nombre) values ('${tipo}', '${org}', 'VAC', 'Vacaciones');
  insert into vacaciones.asignaciones_ausencia (empleado_id, tipo_ausencia_id, anio_asignacion, dias_disponibles)
    values ('${emp}', '${tipo}', 2026, 12);
  insert into vacaciones.solicitudes_ausencia (id, organizacion_id, empleado_id, tipo_ausencia_id, estado, etapa_aprobacion, fecha_inicio, fecha_fin) values
    ('${pendiente}', '${org}', '${emp}', '${tipo}', 'pendiente', 'rrhh', '2026-12-22', '2026-12-29'),
    ('${planeada}', '${org}', '${emp}', '${tipo}', 'planeada', 'rrhh', '2026-11-30', '2026-12-02'),
    ('${aprobada}', '${org}', '${emp}', '${tipo}', 'aprobada', 'aprobada', '2026-10-20', '2026-10-22'),
    ('${rechazada}', '${org}', '${emp}', '${tipo}', 'rechazada', 'rechazada', '2026-09-01', '2026-09-02'),
    ('${cancelada}', '${org}', '${emp}', '${tipo}', 'cancelada', 'aprobada', '2026-08-03', '2026-08-04'),
    ('${ajena}', '${org}', '${empOtro}', '${tipo}', 'pendiente', 'rrhh', '2026-12-07', '2026-12-09'),
    ('${deAdmin}', '${org}', '${empOtro}', '${tipo}', 'pendiente', 'jefe_inmediato', '2026-12-14', '2026-12-16'),
    ('${enMesa}', '${org}', '${emp}', '${tipo}', 'pendiente', 'mesa_directiva', '2027-01-11', '2027-01-13');
  insert into vacaciones.solicitudes_edicion (solicitud_ausencia_id, empleado_id, motivo, fecha_inicio_propuesta, fecha_fin_propuesta)
    values ('${pendiente}', '${emp}', 'Cambio de fechas', '2026-12-23', '2026-12-27');
`);

const como = async (usuario, rol = 'authenticated') => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)", [usuario ?? '', rol]);
  await db.exec(`set role ${rol}`);
};
const eliminar = id => db.query('select (vacaciones.eliminar_solicitud_no_aprobada($1)).id', [id]);
const fila = async id => {
  await db.exec('reset role');
  return (await db.query('select estado, eliminado_en, eliminado_por, motivo_eliminacion from vacaciones.solicitudes_ausencia where id = $1', [id])).rows[0];
};
const uno = async (consulta, parametros = []) => {
  await db.exec('reset role');
  return (await db.query(consulta, parametros)).rows[0];
};

// Sin sesion, con acceso inactivo o de otra persona: nada se elimina.
await como(null, 'anon');
await assert.rejects(eliminar(pendiente), /permission denied/);
await como(inactivo);
await assert.rejects(eliminar(pendiente), /Solo puedes eliminar tus propias solicitudes/);
await como(otro);
await assert.rejects(eliminar(pendiente), /Solo puedes eliminar tus propias solicitudes/);
assert.equal((await fila(pendiente)).eliminado_en, null);

// El dueño no elimina lo que ya se aprobo ni lo que ya esta cerrado.
await como(duenio);
await assert.rejects(eliminar(aprobada), /aun no han sido aprobadas; esta se encuentra aprobada/);
await assert.rejects(eliminar(rechazada), /esta se encuentra rechazada/);
await assert.rejects(eliminar(cancelada), /esta se encuentra cancelada/);
await assert.rejects(eliminar('59999999-0000-0000-0000-000000000000'), /no existe o ya fue eliminada/);
assert.equal((await fila(aprobada)).eliminado_en, null);

// El dueño elimina su pendiente: borrado logico, sin tocar saldo ni conservar dias.
await como(duenio);
assert.equal((await eliminar(pendiente)).rows[0].id, pendiente);
const eliminada = await fila(pendiente);
assert.ok(eliminada.eliminado_en, 'marca eliminado_en');
assert.equal(eliminada.eliminado_por, duenio);
assert.equal(eliminada.estado, 'pendiente', 'conserva su estado para el historial');
assert.match(eliminada.motivo_eliminacion, /por el empleado antes de su aprobacion/);
assert.equal(Number((await uno(`select dias_disponibles d from vacaciones.asignaciones_ausencia where empleado_id = '${emp}'`)).d), 12, 'saldo intacto');
assert.equal(Number((await uno('select count(*) n from vacaciones.dias_conservados_solicitud')).n), 0, 'no conserva dias de una no aprobada');
assert.equal(Number((await uno('select count(*) n from vacaciones.v_dias_solicitud_calendario where solicitud_ausencia_id = $1', [pendiente])).n), 0, 'ya no cuenta como dias pendientes');

// 025: la edicion pendiente se cierra sola. 026: queda el evento con su autor.
const edicion = await uno('select estado, respuesta from vacaciones.solicitudes_edicion where solicitud_ausencia_id = $1', [pendiente]);
assert.equal(edicion.estado, 'rechazada');
assert.match(edicion.respuesta, /la solicitud de vacaciones fue eliminada/);
const evento = await uno("select actor_nombre, motivo from vacaciones.historial_actividad where solicitud_id = $1 and entidad = 'solicitudes_ausencia' and accion = 'eliminacion'", [pendiente]);
assert.equal(evento.actor_nombre, 'Persona de prueba');
assert.match(evento.motivo, /por el empleado antes de su aprobacion/);

// Aviso para el grupo, con los dias que tenia antes de eliminarse.
const aviso = await uno("select titulo, mensaje from vacaciones.notificaciones where tipo = 'solicitud_eliminada' and solicitud_ausencia_id = $1", [pendiente]);
assert.match(aviso.mensaje, /Empleado: Persona de prueba \| Del: 22\/12\/2026 \| Al: 29\/12\/2026 \| Días: 1 \| Estado: pendiente \| Eliminó: Persona de prueba/);

// No se puede eliminar dos veces; planeada y pendiente en otra etapa si se pueden.
await como(duenio);
await assert.rejects(eliminar(pendiente), /no existe o ya fue eliminada/);
await eliminar(planeada);
await eliminar(enMesa);
assert.ok((await fila(planeada)).eliminado_en);
assert.ok((await fila(enMesa)).eliminado_en, 'pendiente en Mesa Directiva: aun no aprobada');

// El administrador puede retirar la no aprobada de otra persona, no una aprobada.
await como(admin);
await eliminar(deAdmin);
await assert.rejects(eliminar(aprobada), /esta se encuentra aprobada/);
assert.match((await fila(deAdmin)).motivo_eliminacion, /por el administrador antes de su aprobacion/);
assert.equal((await fila(ajena)).eliminado_en, null, 'las demas solicitudes no se tocan');

await db.close();
console.log('eliminar-solicitud-no-aprobada: OK');
