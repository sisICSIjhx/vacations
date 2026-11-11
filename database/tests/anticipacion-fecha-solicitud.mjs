// PostgreSQL embebido con la RPC real, sin conexión a Supabase ni envío de avisos.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const sql = nombre => readFileSync(new URL(`../${nombre}`, import.meta.url), 'utf8');

await db.exec(`
  create role authenticated;
  create role service_role;
  create schema auth;
  create schema vacaciones;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema vacaciones, auth to authenticated;
  set time zone 'Pacific/Auckland';
`);

for (const archivo of ['001_esquema_inicial.sql', '004_flujo_aprobacion_tres_niveles.sql']) {
  for (const tabla of sql(archivo).match(/create table if not exists vacaciones\.[\s\S]*?\n\);/g) ?? []) {
    await db.exec(tabla);
  }
}

await db.exec(sql('001_esquema_inicial.sql').match(/create or replace function vacaciones\.es_administrador\(\)[\s\S]*?\$\$;/)[0]);
await db.exec(`
  alter table vacaciones.perfiles_usuario drop constraint perfiles_usuario_rol_check;
  alter table vacaciones.empleados add column jefe_inmediato_id uuid;
  alter table vacaciones.solicitudes_ausencia
    add column etapa_aprobacion text default 'rrhh',
    add column etapa_rechazo text,
    add column descuenta_saldo boolean not null default false,
    add column registro_extemporaneo boolean not null default false;
  create view vacaciones.v_dias_solicitud_calendario as
    select id as solicitud_ausencia_id, fecha_inicio as fecha_calendario, 1 as dias_descontados
    from vacaciones.solicitudes_ausencia;
`);
await db.exec(sql('013_jefe_mesa_directiva.sql'));
const migracion = sql('031_anticipacion_fecha_solicitud.sql');
await db.exec(migracion);
await db.exec(migracion);

const rrhh = '10000000-0000-0000-0000-000000000001';
const mesa = '10000000-0000-0000-0000-000000000002';
const org = '20000000-0000-0000-0000-000000000001';
const emp = '30000000-0000-0000-0000-000000000001';
const tipo = '40000000-0000-0000-0000-000000000001';
await db.exec(`
  insert into auth.users values ('${rrhh}'), ('${mesa}');
  insert into vacaciones.perfiles_usuario (usuario_id, nombre_visible, rol)
    values ('${rrhh}', 'RRHH de prueba', 'rrhh'), ('${mesa}', 'Mesa de prueba', 'mesa_directiva');
  insert into vacaciones.organizaciones (id, codigo, nombre) values ('${org}', 'PRUEBA', 'Organización de prueba');
  insert into vacaciones.empleados (id, organizacion_id, numero_empleado, nombre_completo)
    values ('${emp}', '${org}', 'P001', 'Persona de prueba');
  insert into vacaciones.tipos_ausencia (id, organizacion_id, codigo, nombre)
    values ('${tipo}', '${org}', 'VAC', 'Vacaciones');
`);

async function solicitar(solicitadoEn, { comentarios = null, extemporanea = false, descuenta = false } = {}) {
  await db.exec('reset role');
  const { rows } = await db.query(`
    insert into vacaciones.solicitudes_ausencia (
      organizacion_id, empleado_id, tipo_ausencia_id, estado, fecha_inicio, fecha_fin,
      solicitado_en, comentarios, registro_extemporaneo, descuenta_saldo
    ) values ($1, $2, $3, 'pendiente', '2026-11-04', '2026-11-18', $4, $5, $6, $7)
    returning id`, [org, emp, tipo, solicitadoEn, comentarios, extemporanea, descuenta]);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [rrhh]);
  await db.exec('set role authenticated');
  return rows[0].id;
}

const revisar = (id, etapa = 'rrhh', decision = 'aprobado') => db.query(`
  select (vacaciones.revisar_solicitud($1, $2, $3, 'Prueba')).etapa_aprobacion as etapa`, [id, etapa, decision]);

const reporte = await solicitar('2026-10-19T18:00:00Z');
assert.equal((await revisar(reporte)).rows[0].etapa, 'mesa_directiva');
await db.query("select set_config('request.jwt.claim.sub', $1, false)", [mesa]);
assert.equal((await revisar(reporte, 'mesa_directiva')).rows[0].etapa, 'aprobada');

const quinceDias = await solicitar('2026-10-21T05:59:59Z'); // 20 de octubre en México.
assert.equal((await revisar(quinceDias)).rows[0].etapa, 'mesa_directiva');
const catorceDias = await solicitar('2026-10-21T06:00:00Z');
await assert.rejects(revisar(catorceDias), /faltan 1 dia/);

const sinFecha = await solicitar(null);
await assert.rejects(revisar(sinFecha), /no tiene fecha de solicitud valida/);
assert.equal((await revisar(sinFecha, 'rrhh', 'rechazado')).rows[0].etapa, 'rechazada');
const urgente = await solicitar('2026-11-03T18:00:00Z', { comentarios: '[URGENTE] Motivo de prueba' });
assert.equal((await revisar(urgente)).rows[0].etapa, 'mesa_directiva');
const extemporanea = await solicitar(null, { extemporanea: true });
assert.equal((await revisar(extemporanea)).rows[0].etapa, 'mesa_directiva');
const sinSaldo = await solicitar('2026-10-19T18:00:00Z', { descuenta: true });
await assert.rejects(revisar(sinSaldo), /Saldo insuficiente/);

await db.close();
console.log('anticipacion-fecha-solicitud: OK');
