-- ICSI OIL & GAS - Alta de empleados y saldo de vacaciones 2026
-- PostgreSQL / Supabase
--
-- Origen: tabla "Empleado / Fecha de Ingreso / Dias Pendientes" entregada por
-- RH el 12/08/2026 (mensaje de chat, no el CSV de solicitudes de vacaciones).
-- No incluye numero de empleado, NSS ni CURP; se genera un numero de empleado
-- provisional (MANUAL-NNN) que se puede reemplazar despues por el numero real
-- de nomina con un UPDATE.
--
-- El script es seguro de volver a correr y NO duplica empleados que ya
-- existan (por ejemplo, si el CSV de solicitudes de vacaciones ya se importo
-- desde el panel y genero registros en vacaciones.empleados con origen
-- 'csv'). La coincidencia se hace por nombre en mayusculas sin acentos.
--
-- Casos especiales:
--   * Ricardo Molina Villagran y Angel Hernandez Escamilla: alta de IMSS
--     pendiente. Se dan de alta en el sistema sin fecha de ingreso ni saldo
--     2026; hay que completarlos cuando RH tenga la fecha real (bloque de
--     UPDATE comentado al final).
--   * Empleados con "Na" en dias pendientes: ingresaron en 2026 y todavia no
--     cumplen un anio de antiguedad, por lo que no tienen derecho a dias de
--     vacaciones (Art. 76 LFT). No se crea registro de saldo 2026 para ellos.
--   * "Dias Pendientes" se guarda como dias_disponibles del saldo 2026: es el
--     remanente declarado por RH, no el derecho anual completo.

begin;

create temporary table tmp_alta_empleados_2026 (
  numero_empleado_provisional text not null,
  nombre_completo text not null,
  fecha_ingreso date,
  dias_pendientes_2026 numeric
) on commit drop;

insert into tmp_alta_empleados_2026
  (numero_empleado_provisional, nombre_completo, fecha_ingreso, dias_pendientes_2026)
values
  ('MANUAL-001', 'RICARDO ANTONIO VALDEZ PEREZ', date '2024-03-11', 10),
  ('MANUAL-002', 'NATHANAEL VITELIO GUTIERREZ ALVARADO', date '2023-12-26', 16),
  ('MANUAL-003', 'VICTOR ADRIAN SOSA CASTILLO', date '2023-12-26', 9),
  ('MANUAL-004', 'CESAR MANUEL MARQUEZ GARCIA', date '2025-10-20', 12),
  ('MANUAL-005', 'WILBER MARÍN VALDIVIESO', date '2023-04-15', 16),
  ('MANUAL-006', 'ABDIEL DAGOBERTO RIVERA AMARO', date '2023-03-16', 15),
  ('MANUAL-007', 'CESAR AUGUSTO CASTRO RESENDIZ', date '2025-11-18', 12),
  ('MANUAL-008', 'ZALATIEL MARTINEZ MARTINEZ', date '2023-03-01', 16),
  ('MANUAL-009', 'NORMAN DANIEL WRIGHT DIAZ', date '2025-01-02', 0),
  ('MANUAL-010', 'BRANDON YAIR REBOLLEDO IZQUIERDO', date '2025-11-16', 12),
  ('MANUAL-011', 'FRANCISCO DE JESUS GRACIA MATEO', date '2023-12-26', 16),
  ('MANUAL-012', 'ANTONIO DOMINGUEZ VAZQUEZ', date '2025-09-16', 12),
  ('MANUAL-013', 'JORGE ANTONIO CORNELIO BENITEZ', date '2024-03-16', 14),
  ('MANUAL-014', 'ISMAEL MARTINEZ GONZALEZ', date '2024-09-01', 2),
  ('MANUAL-015', 'ANGEL GABRIEL ORTIZ ALVARADO', date '2024-09-10', 14),
  ('MANUAL-016', 'LUCERO MORALEZ SANTIAGO', date '2023-04-25', 16),
  ('MANUAL-017', 'GUADALUPE ESTEFANIA ÁLVAREZ IZQUIERDO', date '2024-04-19', 5),
  ('MANUAL-018', 'RICARDO RAMIREZ ARMENTA', date '2026-04-01', null),
  ('MANUAL-019', 'JHONNY EDUARDO HERNANDEZ ESTRADA', date '2025-12-16', 12),
  ('MANUAL-020', 'JULIO CESAR LARA ALOR', date '2025-09-09', 0),
  ('MANUAL-021', 'ABIMAEL MARTÍNEZ MARTÍNEZ', date '2026-07-01', null),
  ('MANUAL-022', 'MIRLETTE HERNANDEZ MATUS', date '2025-12-16', 12),
  ('MANUAL-023', 'ANA DEL CARMEN MARTINEZ SANCHEZ', date '2025-05-01', 12),
  ('MANUAL-024', 'MAYRA BERENICE MARIANO GONZALEZ', date '2023-07-29', 16),
  ('MANUAL-025', 'ALEJANDRO VAZQUEZ SANTIAGO', date '2026-02-25', null),
  ('MANUAL-026', 'GILBERTO BARRERA NOLASCO', date '2026-03-12', null),
  ('MANUAL-027', 'ARMANDO ARCANGEL SANCHEZ BRITO', date '2024-08-16', 12),
  ('MANUAL-028', 'NEREIDA CRUZ FERNANDEZ', date '2024-08-16', 12),
  ('MANUAL-029', 'KARINA SOSA BARAHONA', date '2026-07-01', null),
  ('MANUAL-030', 'MOISES ANTONIO DOMÍNGUEZ GONZÁLEZ', date '2024-10-01', 14),
  ('MANUAL-031', 'OMAR HERNANDEZ GARCIA', date '2025-02-05', 0),
  ('MANUAL-032', 'GABRIEL DE LA CRUZ SAGRESO', date '2024-01-16', 10),
  ('MANUAL-033', 'GERARDO MACIAS SANTIAGO', date '2024-12-12', 14),
  ('MANUAL-034', 'ELPIDIO CABRERA BARRIOS', date '2025-03-27', 12),
  ('MANUAL-035', 'JOSE MANUEL SOSA CABAÑAS', date '2026-05-01', 0),
  ('MANUAL-036', 'DANIEL EDUARDO ARELLANO MOLINA', date '2026-03-09', null),
  ('MANUAL-037', 'JOSE LUIS VIDAL RAMIREZ', date '2024-06-09', 14),
  ('MANUAL-038', 'MOISÉS HERNÁNDEZ ALEJANDRO', date '2024-10-01', 10),
  ('MANUAL-039', 'LUIS ALBERTO SANTIAGO TOLEDO', date '2024-10-01', 14),
  ('MANUAL-040', 'BERNARDO DEL ÁNGEL VILLALOBOS RAMÍREZ', date '2024-10-01', 14),
  ('MANUAL-041', 'DOMINGO DOMINGUEZ GONZÁLEZ', date '2024-10-01', 14),
  ('MANUAL-042', 'JORGE ALBERTO LINARES GUTIERREZ', date '2024-08-01', 14),
  ('MANUAL-043', 'RICARDO MOLINA VILLAGRAN', null, null),
  ('MANUAL-044', 'WENDY MARGARITA ROMERO MORENO', date '2024-10-10', 14),
  ('MANUAL-045', 'ANGEL HERNANDEZ ESCAMILLA', null, null);

-- 1) Completar fecha_ingreso en empleados que ya existieran (por ejemplo,
--    dados de alta antes por el importador de CSV de solicitudes) y que
--    todavia no la tuvieran. No se toca numero_empleado ni origen.
update vacaciones.empleados e
set fecha_ingreso = coalesce(e.fecha_ingreso, t.fecha_ingreso)
from vacaciones.organizaciones o, tmp_alta_empleados_2026 t
where e.organizacion_id = o.id
  and o.codigo = 'ICSI'
  and o.eliminado_en is null
  and e.eliminado_en is null
  and translate(upper(e.nombre_completo), 'ÁÉÍÓÚÑÜ', 'AEIOUNU')
    = translate(upper(t.nombre_completo), 'ÁÉÍÓÚÑÜ', 'AEIOUNU');

-- 2) Dar de alta a los empleados que todavia no existan.
insert into vacaciones.empleados (
  organizacion_id,
  numero_empleado,
  nombre_completo,
  fecha_ingreso,
  horario_laboral_id,
  origen,
  clave_empleado_origen
)
select
  o.id,
  t.numero_empleado_provisional,
  t.nombre_completo,
  t.fecha_ingreso,
  h.id,
  'manual',
  t.numero_empleado_provisional
from tmp_alta_empleados_2026 t
join vacaciones.organizaciones o
  on o.codigo = 'ICSI'
 and o.eliminado_en is null
left join vacaciones.horarios_laborales h
  on h.organizacion_id = o.id
 and h.predeterminado = true
 and h.eliminado_en is null
where not exists (
  select 1
  from vacaciones.empleados e
  where e.organizacion_id = o.id
    and e.eliminado_en is null
    and translate(upper(e.nombre_completo), 'ÁÉÍÓÚÑÜ', 'AEIOUNU')
      = translate(upper(t.nombre_completo), 'ÁÉÍÓÚÑÜ', 'AEIOUNU')
);

-- 3) Registrar el saldo 2026 declarado por RH (dias pendientes). Se omiten a
--    proposito los empleados con "Na" (sin un anio de antiguedad todavia) y
--    los que tienen alta de IMSS pendiente (fecha_ingreso nula): para ellos
--    dias_pendientes_2026 quedo en null en la tabla temporal de arriba.
insert into vacaciones.asignaciones_ausencia (
  empleado_id,
  tipo_ausencia_id,
  anio_asignacion,
  dias_disponibles,
  fecha_corte_saldo,
  notas
)
select
  e.id,
  ta.id,
  2026,
  t.dias_pendientes_2026,
  current_date,
  'Saldo 2026 declarado por RH (alta manual); no equivale al derecho anual ni al acumulado devengado.'
from tmp_alta_empleados_2026 t
join vacaciones.organizaciones o
  on o.codigo = 'ICSI'
 and o.eliminado_en is null
join vacaciones.tipos_ausencia ta
  on ta.organizacion_id = o.id
 and ta.codigo = 'VACACIONES'
 and ta.eliminado_en is null
join vacaciones.empleados e
  on e.organizacion_id = o.id
 and e.eliminado_en is null
 and translate(upper(e.nombre_completo), 'ÁÉÍÓÚÑÜ', 'AEIOUNU')
   = translate(upper(t.nombre_completo), 'ÁÉÍÓÚÑÜ', 'AEIOUNU')
where t.dias_pendientes_2026 is not null
on conflict (empleado_id, tipo_ausencia_id, anio_asignacion) do update
set dias_disponibles = excluded.dias_disponibles,
    fecha_corte_saldo = excluded.fecha_corte_saldo,
    notas = excluded.notas;

commit;

-- ---------------------------------------------------------------------------
-- Pendiente: completar alta de IMSS
-- ---------------------------------------------------------------------------
-- Cuando RH tenga la fecha de ingreso real de estos dos empleados, complétala
-- así y vuelve a correr el bloque 3 de este script para generarles su saldo
-- 2026 (si ya cumplen un anio de antiguedad):
--
-- update vacaciones.empleados
-- set fecha_ingreso = date 'AAAA-MM-DD'
-- where organizacion_id = (select id from vacaciones.organizaciones where codigo = 'ICSI')
--   and nombre_completo = 'RICARDO MOLINA VILLAGRAN';
--
-- update vacaciones.empleados
-- set fecha_ingreso = date 'AAAA-MM-DD'
-- where organizacion_id = (select id from vacaciones.organizaciones where codigo = 'ICSI')
--   and nombre_completo = 'ANGEL HERNANDEZ ESCAMILLA';

-- ---------------------------------------------------------------------------
-- Verificacion rapida despues de correr el script
-- ---------------------------------------------------------------------------
--
-- select numero_empleado, nombre_completo, fecha_ingreso, origen
-- from vacaciones.empleados
-- where organizacion_id = (select id from vacaciones.organizaciones where codigo = 'ICSI')
--   and eliminado_en is null
-- order by nombre_completo;
--
-- select e.nombre_completo, a.anio_asignacion, a.dias_disponibles
-- from vacaciones.asignaciones_ausencia a
-- join vacaciones.empleados e on e.id = a.empleado_id
-- where a.anio_asignacion = 2026
--   and a.eliminado_en is null
-- order by e.nombre_completo;
