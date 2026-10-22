// PostgreSQL embebido con DDL y funciones reales: vista de días (019), alta de
// solicitudes (017), aprobación administrativa (012), saldos (023/024) y 028.
// No conecta a Supabase. PGLITE_MODULE debe apuntar a @electric-sql/pglite.
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
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
`);
for (const nombre of ['001_esquema_inicial.sql','004_flujo_aprobacion_tres_niveles.sql','017_solicitudes_edicion.sql','022_conservar_dias_y_cancelar_con_motivo.sql']) {
  for (const tabla of sql(nombre).match(/create table if not exists vacaciones\.[\s\S]*?\n\);/gi) ?? []) await db.exec(tabla);
}
await db.exec(`
alter table vacaciones.perfiles_usuario drop constraint perfiles_usuario_rol_check;
alter table vacaciones.empleados add column if not exists jefe_inmediato_id uuid, add column if not exists dia_descanso smallint;
alter table vacaciones.solicitudes_ausencia
  add column if not exists etapa_aprobacion text default 'rrhh', add column if not exists etapa_rechazo text,
  add column if not exists descuenta_saldo boolean not null default true, add column if not exists registro_extemporaneo boolean not null default false,
  add column if not exists dia_descanso smallint;
alter table vacaciones.dias_festivos add column if not exists repeticion text not null default 'ninguna';
alter table vacaciones.asignaciones_ausencia add column if not exists derecho_otorgado_en date, add column if not exists arrastre_automatico boolean not null default false;
-- 016 copia el descanso del empleado a la solicitud con un disparador.
create function vacaciones.copiar_descanso() returns trigger language plpgsql as $$
begin new.dia_descanso := (select dia_descanso from vacaciones.empleados where id = new.empleado_id); return new; end $$;
create trigger copiar_descanso before insert on vacaciones.solicitudes_ausencia for each row execute function vacaciones.copiar_descanso();
`);
for (const [archivo, nombre] of [
  ['001_esquema_inicial.sql','es_administrador'],
  ['001_esquema_inicial.sql','empleado_actual_id'],
  ['006_permisos_rrhh_personal_catalogos.sql','es_rrhh'],
  ['019_festivos_cada_anio.sql','festivo_en_fecha'],
  ['023_saldos_anuales_por_antiguedad.sql','dias_vacaciones_lft'],
  ['023_saldos_anuales_por_antiguedad.sql','arrastrar_saldo_anio_siguiente'],
  ['024_dias_por_derecho_en_aniversario.sql','aniversario_ingreso'],
  ['024_dias_por_derecho_en_aniversario.sql','otorgar_dias_aniversario'],
  ['024_dias_por_derecho_en_aniversario.sql','generar_saldos_anio'],
  ['017_solicitudes_edicion.sql','guardar_solicitud_vacaciones'],
  ['012_solicitudes_extemporaneas.sql','cambiar_estado_solicitud'],
]) await db.exec(funcion(archivo, nombre));
const vista = sql('019_festivos_cada_anio.sql');
const inicioVista = vista.indexOf('create or replace view vacaciones.v_dias_solicitud_calendario');
await db.exec(vista.slice(inicioVista, vista.indexOf(';', vista.indexOf('ta.eliminado_en is null', inicioVista)) + 1));
await db.exec(`create trigger arrastrar_saldo_anio_siguiente after insert or update of dias_disponibles on vacaciones.asignaciones_ausencia for each row execute function vacaciones.arrastrar_saldo_anio_siguiente();`);

const admin = '10000000-0000-0000-0000-000000000001';
const org = '20000000-0000-0000-0000-000000000001', tipo = '40000000-0000-0000-0000-000000000001';
const emp = n => `30000000-0000-0000-0000-00000000000${n}`;
await db.exec(`
insert into auth.users values ('${admin}');
insert into vacaciones.organizaciones(id,codigo,nombre) values ('${org}','PRUEBA','Organización de prueba');
insert into vacaciones.perfiles_usuario(usuario_id,nombre_visible,rol) values ('${admin}','Administración de prueba','administrador');
insert into vacaciones.tipos_ausencia(id,organizacion_id,codigo,nombre,metodo_conteo,excluir_dias_festivos) values ('${tipo}','${org}','VACACIONES','Vacaciones','dias_naturales',true);
insert into vacaciones.dias_festivos(organizacion_id,fecha,nombre,repeticion) values ('${org}','2026-01-01','Año Nuevo','fecha'),('${org}','2026-12-25','Navidad','fecha');
select set_config('request.jwt.claim.sub','${admin}',false);
`);
// Empleados con descanso en domingo; todos cumplen años de servicio el 26 de diciembre.
const alta = async (n, saldos) => {
  await db.exec(`insert into vacaciones.empleados(id,organizacion_id,numero_empleado,nombre_completo,fecha_ingreso,dia_descanso) values ('${emp(n)}','${org}','P00${n}','Persona ${n}','2023-12-26',0);`);
  for (const [anio, derecho, acumulados, disponibles, otorgado = '2026-08-10', arrastre = false] of saldos) {
    await db.exec(`insert into vacaciones.asignaciones_ausencia(empleado_id,tipo_ausencia_id,anio_asignacion,dias_por_derecho,dias_acumulados_a_fecha,dias_disponibles,fecha_corte_saldo,derecho_otorgado_en,arrastre_automatico)
      values ('${emp(n)}','${tipo}',${anio},${derecho},${acumulados},${disponibles},'2026-08-10',${otorgado ? `'${otorgado}'` : 'null'},${arrastre});`);
  }
};
const solicitar = async (n, inicio, fin) => (await db.query(`select id from vacaciones.guardar_solicitud_vacaciones($1,$2,$3,$4)`, [emp(n), tipo, inicio, fin])).rows[0].id;
const aprobar = id => db.query(`select vacaciones.cambiar_estado_solicitud($1,'aprobada')`, [id]);
const saldo = async (n, anio) => Number((await db.query(`select dias_disponibles from vacaciones.asignaciones_ausencia where empleado_id=$1 and anio_asignacion=$2`, [emp(n), anio])).rows[0]?.dias_disponibles);
const diasPorAnio = async id => Object.fromEntries((await db.query(`select extract(year from fecha_calendario)::int anio, sum(dias_descontados)::float dias from vacaciones.v_dias_solicitud_calendario where solicitud_ausencia_id=$1 group by 1 order by 1`, [id])).rows.map(f => [f.anio, f.dias]));
const solicitudes = async n => Number((await db.query(`select count(*) from vacaciones.solicitudes_ausencia where empleado_id=$1`, [emp(n)])).rows[0].count);

// Caso del reporte, antes de 028: el saldo 2027 no existe.
await alta(1, [[2026, 16, 0, 16]]);
await assert.rejects(solicitar(1, '2026-12-28', '2027-01-15'), /Saldo insuficiente para el ano 2027: la solicitud requiere 12/);

const migracion = sql('028_saldo_anio_siguiente_y_uso_de_derecho.sql');
const transaccion = migracion.slice(0, migracion.indexOf('\ncommit;') + 9);
await db.exec(transaccion);
await db.exec(transaccion); // Reejecución segura.
const anioActual = Number((await db.query(`select extract(year from (now() at time zone 'America/Mexico_City'))::int anio`)).rows[0].anio);
assert.equal(anioActual, 2026, 'La fixture asume que se ejecuta en 2026.');
assert.equal(Number((await db.query(`select count(*) from vacaciones.asignaciones_ausencia where empleado_id=$1`, [emp(1)])).rows[0].count), 2);
const s2027 = (await db.query(`select * from vacaciones.asignaciones_ausencia where empleado_id=$1 and anio_asignacion=2027`, [emp(1)])).rows[0];
assert.equal(Number(s2027.dias_acumulados_a_fecha), 16);
assert.equal(Number(s2027.dias_por_derecho), 0);
assert.equal(s2027.arrastre_automatico, true);

// Cruce de año: 4 días en 2026 y 12 en 2027; al aprobar queda en 0.
const cruce = await solicitar(1, '2026-12-28', '2027-01-15');
assert.deepEqual(await diasPorAnio(cruce), { 2026: 4, 2027: 12 });
await aprobar(cruce);
assert.equal(await saldo(1, 2026), 12);
assert.equal(await saldo(1, 2027), 0);

// Días por derecho capturados por adelantado: no se usan antes del 26/12.
await alta(2, [[2026, 16, 0, 16]]);
await assert.rejects(solicitar(2, '2026-11-16', '2026-11-20'), /Los 16 día\(s\) por derecho de 2026 se pueden usar a partir del 26\/12\/2026.*hay 0 día\(s\) disponibles y la solicitud usa 5/);
assert.equal(await solicitudes(2), 0, 'El rechazo diferido revierte la solicitud.');
const despues = await solicitar(2, '2026-12-28', '2026-12-31');
assert.deepEqual(await diasPorAnio(despues), { 2026: 4 });

// Con 5 acumulados se pueden usar 5 días antes; la aprobación hace cumplir el límite.
await alta(3, [[2026, 16, 5, 21]]);
await assert.rejects(solicitar(3, '2026-11-02', '2026-11-08'), /hay 5 día\(s\) disponibles y la solicitud usa 6/);
const primera = await solicitar(3, '2026-11-02', '2026-11-06');
const segunda = await solicitar(3, '2026-11-09', '2026-11-13');
await aprobar(primera);
assert.equal(await saldo(3, 2026), 16);
await assert.rejects(aprobar(segunda), /hay 0 día\(s\) disponibles y la solicitud usa 5/);
assert.equal(await saldo(3, 2026), 16, 'La aprobación rechazada no descuenta.');
assert.equal((await db.query(`select estado from vacaciones.solicitudes_ausencia where id=$1`, [segunda])).rows[0].estado, 'pendiente');
// Días aprobados desde el aniversario no amplían lo anterior: 21 - 5 - 4 = 12 y antes quedan 0.
const navidad = await solicitar(3, '2026-12-26', '2026-12-30');
await aprobar(navidad);
assert.equal(await saldo(3, 2026), 12);
await assert.rejects(solicitar(3, '2026-11-16', '2026-11-16'), /hay 0 día\(s\) disponibles/);

// Un registro que no descuenta saldo no se valida con la regla.
await db.exec(`insert into vacaciones.solicitudes_ausencia(organizacion_id,empleado_id,tipo_ausencia_id,estado,fecha_inicio,fecha_fin,descuenta_saldo,registro_extemporaneo)
  values ('${org}','${emp(2)}','${tipo}','aprobada','2026-11-16','2026-11-20',false,true);`);
assert.equal(await solicitudes(2), 2);

// Otorgamiento: no duplica días capturados a mano; suma los de un saldo en 0.
await alta(4, [[2026, 16, 0, 16, null, true]]);
await alta(5, [[2026, 0, 3, 3, null, true]]);
await db.query(`select vacaciones.otorgar_dias_aniversario('2026-12-26')`);
const otorgado = async n => (await db.query(`select dias_por_derecho::float derecho, dias_disponibles::float disponibles, derecho_otorgado_en::text otorgado from vacaciones.asignaciones_ausencia where empleado_id=$1 and anio_asignacion=2026`, [emp(n)])).rows[0];
assert.deepEqual(await otorgado(4), { derecho: 16, disponibles: 16, otorgado: '2026-12-26' });
assert.deepEqual(await otorgado(5), { derecho: 16, disponibles: 19, otorgado: '2026-12-26' });

console.log('028: cruce de año, regla del aniversario, otorgamiento y reejecución verificados.');
