-- ICSI OIL & GAS - Importacion manual de solicitudes de vacaciones 2026
-- PostgreSQL / Supabase
--
-- Origen: Planificación_de_Vacaciones_2022026-08-12_13_47_39.csv (formulario
-- de planificacion de vacaciones, 8 personas, algunas con mas de un periodo).
-- Requiere haber corrido antes 002_alta_empleados_2026.sql: los empleados de
-- este archivo deben existir ya en vacaciones.empleados.
--
-- Este script SOLO registra las solicitudes (periodos pedidos). A proposito
-- NO toca vacaciones.asignaciones_ausencia.dias_disponibles: el "dias
-- disponibles actualmente" que cada persona declaro en el formulario no
-- coincide en 3 de los 8 casos con lo que RH entrego en la tabla de alta
-- (ver aviso mas abajo). Para no pisar el saldo oficial con un numero que
-- puede estar desactualizado, ese dato se guarda solo como evidencia en
-- vacaciones.instantaneas_saldo_ausencia, tal como esta pensada esa tabla.
--
-- AVISO - revisar antes de correr:
--   * Victor Adrian Sosa Castillo: RH declaro 9 dias disponibles, el CSV
--     declara 8.
--   * Abdiel Dagoberto Rivera Amaro: RH declaro 15, el CSV declara 16.
--   * Luis Alberto Santiago Toledo: RH declaro 14, el CSV declara 5 (la
--     diferencia es grande; vale la pena confirmar con la persona/RH).
--   * Antonio Dominguez Vazquez: el periodo declara "Reintegro: 19-10-2026"
--     para vacaciones que terminan el 17-09-2026 (un mes despues). Podria
--     ser un error de captura del formulario (¿19-09-2026?); se importa tal
--     cual lo declaro, revisar con la persona antes de aprobar la solicitud.
--
-- El script es seguro de volver a correr: usa una clave de origen estable
-- por persona/periodo (on conflict do nothing). Ademas registra el lote con
-- el hash SHA-256 real del archivo, para que si mas adelante suben este
-- mismo CSV por la pantalla "Importar vacaciones" de la app, el importador
-- lo detecte como ya importado y no duplique nada.

begin;

create temporary table tmp_solicitudes_2026 (
  nombre_completo text not null,
  dias_disponibles_declarados numeric not null,
  dias_planeados_declarados numeric not null,
  indice_periodo int not null,
  fecha_inicio date not null,
  fecha_fin date not null,
  fecha_reintegro date,
  comentarios text,
  fecha_envio date not null
) on commit drop;

insert into tmp_solicitudes_2026
  (nombre_completo, dias_disponibles_declarados, dias_planeados_declarados,
   indice_periodo, fecha_inicio, fecha_fin, fecha_reintegro, comentarios, fecha_envio)
values
  ('JHONNY EDUARDO HERNANDEZ ESTRADA', 12, 3, 1,
   date '2026-12-30', date '2027-01-02', date '2027-01-04',
   'Solo deseo usar 3 días, para dejar 9 días acumulados para el siguiente año',
   date '2026-08-12'),

  ('ANTONIO DOMINGUEZ VAZQUEZ', 12, 6, 1,
   date '2026-09-11', date '2026-09-17', date '2026-10-19',
   'Solo planeo tomar 6 días y dejar 6 días para acumular el siguiente año',
   date '2026-08-12'),

  ('NATHANAEL VITELIO GUTIERREZ ALVARADO', 16, 16, 1,
   date '2026-12-28', date '2027-01-15', date '2027-01-16',
   'Se agrega 1 dia extra por el festivo del 01 de enero',
   date '2026-08-12'),

  ('BRANDON YAIR REBOLLEDO IZQUIERDO', 12, 12, 1,
   date '2026-12-26', date '2027-01-09', date '2027-01-10',
   'Es para pasar las fiestas con mi familia',
   date '2026-08-10'),

  ('VICTOR ADRIAN SOSA CASTILLO', 8, 5, 1,
   date '2026-06-16', date '2026-06-21', date '2026-06-22',
   null,
   date '2026-06-03'),

  ('ABDIEL DAGOBERTO RIVERA AMARO', 16, 16, 1,
   date '2026-12-26', date '2026-12-31', date '2027-01-02',
   'Los últimos 7 días los guardaria para casos de emergencia personales, salud o eventos extraordinarios. Las de septiembre aún las estoy viendo porque podrían ser en la primera semana o la segunda. O en dado caso en la última semana de agosto.',
   date '2026-04-22'),
  ('ABDIEL DAGOBERTO RIVERA AMARO', 16, 16, 2,
   date '2026-09-01', date '2026-09-05', date '2026-09-07',
   'Los últimos 7 días los guardaria para casos de emergencia personales, salud o eventos extraordinarios. Las de septiembre aún las estoy viendo porque podrían ser en la primera semana o la segunda. O en dado caso en la última semana de agosto.',
   date '2026-04-22'),

  ('LUIS ALBERTO SANTIAGO TOLEDO', 5, 5, 1,
   date '2026-05-25', date '2026-05-29', date '2026-05-30',
   null,
   date '2026-04-11'),

  ('ANGEL GABRIEL ORTIZ ALVARADO', 14, 14, 1,
   date '2026-10-12', date '2026-10-19', null,
   null,
   date '2026-04-08'),
  ('ANGEL GABRIEL ORTIZ ALVARADO', 14, 14, 2,
   date '2026-09-10', date '2026-09-18', null,
   null,
   date '2026-04-08');

-- Corta el script si algun nombre no coincide con un empleado activo: es
-- preferible fallar aqui a insertar solicitudes huerfanas o silenciarlas.
do $$
declare
  faltantes text;
begin
  select string_agg(distinct t.nombre_completo, ', ')
  into faltantes
  from tmp_solicitudes_2026 t
  join vacaciones.organizaciones o
    on o.codigo = 'ICSI'
   and o.eliminado_en is null
  where not exists (
    select 1
    from vacaciones.empleados e
    where e.organizacion_id = o.id
      and e.eliminado_en is null
      and translate(upper(e.nombre_completo), 'ÁÉÍÓÚÑÜ', 'AEIOUNU')
        = translate(upper(t.nombre_completo), 'ÁÉÍÓÚÑÜ', 'AEIOUNU')
  );
  if faltantes is not null then
    raise exception
      'No se encontraron empleados activos para: %. Corre primero 002_alta_empleados_2026.sql.',
      faltantes;
  end if;
end;
$$;

-- 1) Lote de importacion, con el hash real del CSV para que la pantalla
--    "Importar vacaciones" de la app reconozca este archivo como ya
--    procesado si alguien lo vuelve a subir ahi.
insert into vacaciones.lotes_importacion (
  organizacion_id,
  nombre_archivo,
  hash_sha256,
  estado,
  total_filas,
  filas_importadas,
  filas_rechazadas,
  importado_en,
  notas
)
select
  o.id,
  'Planificación_de_Vacaciones_2022026-08-12_13_47_39.csv',
  'eda8ad80af1da72090957e3c08557c9803c1b82a57c29e8592dfb49d33da203c',
  'completado',
  8,
  8,
  0,
  now(),
  'Importado manualmente vía SQL (003_importar_solicitudes_vacaciones_2026.sql), no desde la pantalla de importación.'
from vacaciones.organizaciones o
where o.codigo = 'ICSI'
  and o.eliminado_en is null
  -- hash_sha256 solo tiene un indice normal (lotes_hash_busqueda_idx), no
  -- uno unico, asi que la idempotencia se resuelve con NOT EXISTS en vez de
  -- ON CONFLICT.
  and not exists (
    select 1
    from vacaciones.lotes_importacion l
    where l.organizacion_id = o.id
      and l.hash_sha256 = 'eda8ad80af1da72090957e3c08557c9803c1b82a57c29e8592dfb49d33da203c'
      and l.eliminado_en is null
  );

-- 2) Solicitudes de vacaciones (una fila por periodo).
insert into vacaciones.solicitudes_ausencia (
  organizacion_id,
  empleado_id,
  tipo_ausencia_id,
  estado,
  fecha_inicio,
  fecha_fin,
  fecha_reintegro,
  comentarios,
  solicitado_en,
  origen,
  lote_importacion_id,
  clave_registro_origen,
  datos_originales
)
select
  o.id,
  e.id,
  ta.id,
  'planeada',
  t.fecha_inicio,
  t.fecha_fin,
  t.fecha_reintegro,
  t.comentarios,
  t.fecha_envio::timestamptz,
  'csv',
  lote.id,
  'PLANIF-2026-08-12:' || t.nombre_completo || ':' || t.indice_periodo,
  jsonb_build_object(
    'nombre_completo', t.nombre_completo,
    'dias_disponibles_declarados', t.dias_disponibles_declarados,
    'dias_planeados_declarados', t.dias_planeados_declarados,
    'fecha_inicio', t.fecha_inicio,
    'fecha_fin', t.fecha_fin,
    'fecha_reintegro', t.fecha_reintegro,
    'comentarios', t.comentarios
  )
from tmp_solicitudes_2026 t
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
join vacaciones.lotes_importacion lote
  on lote.organizacion_id = o.id
 and lote.hash_sha256 = 'eda8ad80af1da72090957e3c08557c9803c1b82a57c29e8592dfb49d33da203c'
 and lote.eliminado_en is null
on conflict (organizacion_id, clave_registro_origen) do nothing;

-- 3) Evidencia del saldo que cada persona declaro en el formulario. No
--    reemplaza el saldo oficial (vacaciones.asignaciones_ausencia), que se
--    carga desde la tabla de RH en 002_alta_empleados_2026.sql.
insert into vacaciones.instantaneas_saldo_ausencia (
  empleado_id,
  tipo_ausencia_id,
  anio_saldo,
  fecha_captura,
  dias_disponibles_declarados,
  dias_planeados_declarados,
  lote_importacion_id,
  datos_originales
)
select
  e.id,
  ta.id,
  2026,
  t.fecha_envio,
  t.dias_disponibles_declarados,
  t.dias_planeados_declarados,
  lote.id,
  jsonb_build_object(
    'nombre_completo', t.nombre_completo,
    'dias_disponibles_declarados', t.dias_disponibles_declarados,
    'dias_planeados_declarados', t.dias_planeados_declarados
  )
from tmp_solicitudes_2026 t
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
join vacaciones.lotes_importacion lote
  on lote.organizacion_id = o.id
 and lote.hash_sha256 = 'eda8ad80af1da72090957e3c08557c9803c1b82a57c29e8592dfb49d33da203c'
 and lote.eliminado_en is null
where t.indice_periodo = 1
on conflict (empleado_id, tipo_ausencia_id, anio_saldo, fecha_captura, lote_importacion_id)
  where eliminado_en is null
  do nothing;

commit;

-- ---------------------------------------------------------------------------
-- Verificacion rapida despues de correr el script
-- ---------------------------------------------------------------------------
--
-- select e.nombre_completo, s.fecha_inicio, s.fecha_fin, s.fecha_reintegro,
--        s.estado, s.comentarios
-- from vacaciones.solicitudes_ausencia s
-- join vacaciones.empleados e on e.id = s.empleado_id
-- where s.origen = 'csv'
--   and s.eliminado_en is null
-- order by e.nombre_completo, s.fecha_inicio;
