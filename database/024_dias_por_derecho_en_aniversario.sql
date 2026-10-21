-- 024_dias_por_derecho_en_aniversario.sql
-- Spec: openspec/changes/saldos-anuales-por-antiguedad
--
-- Los dias por derecho se otorgan en el aniversario de ingreso (art. 76 LFT),
-- no el 1 de enero como en 023:
--
-- 1) generar_saldos_anio(anio) crea el saldo del anio solo con los dias no
--    usados del anio anterior: dias_por_derecho = 0 y
--    dias_disponibles = dias_acumulados_a_fecha.
--
-- 2) otorgar_dias_aniversario(hasta): a cada saldo cuyo aniversario ya llego
--    y que aun no recibio sus dias (derecho_otorgado_en nulo) le asigna
--    dias_por_derecho segun la LFT y los suma a dias_disponibles. El
--    aniversario del 29 de febrero cae el 28 en anios no bisiestos.
--    generar_saldos_anio la llama al terminar, por lo que el pg_cron diario
--    de 023 crea el anio el 1 de enero y otorga cada aniversario el mismo dia.
--
-- 3) Saldos existentes: se marcan como otorgados (RH ya incluyo sus dias),
--    salvo los generados por 023 cuyo aniversario aun no llega, que vuelven
--    a 0 dias por derecho para recibirlos en su aniversario.
--
-- Ejecutar despues de 023. Seguro de re-ejecutar.

begin;

alter table vacaciones.asignaciones_ausencia
  add column if not exists derecho_otorgado_en date;

comment on column vacaciones.asignaciones_ausencia.derecho_otorgado_en is
  'Fecha en que se sumaron los dias por derecho del anio (aniversario). Nulo: pendientes de otorgar.';

-- Aniversario de ingreso dentro de un anio (29-feb -> 28-feb si no es bisiesto).
create or replace function vacaciones.aniversario_ingreso(p_fecha_ingreso date, p_anio integer)
returns date
language sql
immutable
set search_path = vacaciones, public
as $$
  select (p_fecha_ingreso
    + make_interval(years => p_anio - extract(year from p_fecha_ingreso)::integer))::date;
$$;

-- ---------------------------------------------------------------------------
-- 3) Saldos existentes
-- ---------------------------------------------------------------------------
with saldos as (
  select
    a.id,
    vacaciones.aniversario_ingreso(e.fecha_ingreso, a.anio_asignacion) as aniversario,
    a.arrastre_automatico
      and a.dias_por_derecho > 0
      and a.dias_disponibles >= a.dias_por_derecho
      and vacaciones.aniversario_ingreso(e.fecha_ingreso, a.anio_asignacion)
        > (now() at time zone 'America/Mexico_City')::date as adelantado
  from vacaciones.asignaciones_ausencia a
  join vacaciones.empleados e
    on e.id = a.empleado_id
  where a.derecho_otorgado_en is null
)
update vacaciones.asignaciones_ausencia a
set dias_disponibles = a.dias_disponibles - a.dias_por_derecho,
    dias_por_derecho = 0,
    fecha_corte_saldo = current_date
from saldos s
where a.id = s.id
  and s.adelantado;

with saldos as (
  select
    a.id,
    vacaciones.aniversario_ingreso(e.fecha_ingreso, a.anio_asignacion) as aniversario
  from vacaciones.asignaciones_ausencia a
  join vacaciones.empleados e
    on e.id = a.empleado_id
  where a.derecho_otorgado_en is null
    and not (a.arrastre_automatico and a.dias_por_derecho = 0)
)
update vacaciones.asignaciones_ausencia a
set derecho_otorgado_en = least(s.aniversario, a.fecha_corte_saldo, current_date)
from saldos s
where a.id = s.id;

-- ---------------------------------------------------------------------------
-- 2) Otorgar dias por derecho en el aniversario
-- ---------------------------------------------------------------------------
create or replace function vacaciones.otorgar_dias_aniversario(p_hasta date)
returns integer
language plpgsql
security definer
set search_path = vacaciones, public
as $$
declare
  v_otorgados integer;
begin
  -- Cada fila actualizada dispara arrastrar_saldo_anio_siguiente (023): si el
  -- anio siguiente ya existe, los dias nuevos tambien se arrastran.
  with pendientes as (
    select
      a.id,
      vacaciones.dias_vacaciones_lft(
        a.anio_asignacion - extract(year from e.fecha_ingreso)::integer
      ) as derecho,
      vacaciones.aniversario_ingreso(e.fecha_ingreso, a.anio_asignacion) as aniversario
    from vacaciones.asignaciones_ausencia a
    join vacaciones.empleados e
      on e.id = a.empleado_id
    join vacaciones.tipos_ausencia ta
      on ta.id = a.tipo_ausencia_id
     and ta.codigo = 'VACACIONES'
    where a.eliminado_en is null
      and a.derecho_otorgado_en is null
      and e.eliminado_en is null
      and e.estado = 'activo'
      and e.fecha_ingreso is not null
      and a.anio_asignacion > extract(year from e.fecha_ingreso)::integer
  )
  update vacaciones.asignaciones_ausencia a
  set dias_por_derecho = p.derecho,
      dias_disponibles = a.dias_disponibles + p.derecho,
      derecho_otorgado_en = p.aniversario,
      fecha_corte_saldo = current_date
  from pendientes p
  where a.id = p.id
    and p.aniversario <= p_hasta
    and p.derecho > 0;

  get diagnostics v_otorgados = row_count;
  return v_otorgados;
end;
$$;

revoke execute on function vacaciones.otorgar_dias_aniversario(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1) Generacion del saldo anual (redefine 023)
-- ---------------------------------------------------------------------------
create or replace function vacaciones.generar_saldos_anio(p_anio integer)
returns integer
language plpgsql
security definer
set search_path = vacaciones, public
as $$
declare
  v_hoy date := (now() at time zone 'America/Mexico_City')::date;
  v_anio_actual integer := extract(year from v_hoy)::integer;
  v_creados integer;
begin
  -- "security definer": la autorizacion se valida aqui explicitamente. Sin
  -- auth.uid() la llamada viene de pg_cron o del SQL Editor.
  if auth.uid() is not null
     and not (vacaciones.es_administrador() or vacaciones.es_rrhh()) then
    raise exception 'Solo administracion o RRHH pueden generar saldos.';
  end if;

  if p_anio is null or p_anio < 2000 or p_anio > v_anio_actual + 1 then
    raise exception 'Anio no valido para generar saldos: %.', p_anio;
  end if;

  insert into vacaciones.asignaciones_ausencia (
    empleado_id,
    tipo_ausencia_id,
    anio_asignacion,
    dias_por_derecho,
    dias_acumulados_a_fecha,
    dias_disponibles,
    fecha_corte_saldo,
    arrastre_automatico,
    notas
  )
  select
    e.id,
    ta.id,
    p_anio,
    0,
    coalesce(anterior.dias_disponibles, 0),
    coalesce(anterior.dias_disponibles, 0),
    current_date,
    true,
    case
      when extract(year from e.fecha_ingreso)::integer = p_anio then
        'Generado automaticamente: ingreso en el anio, sin dias por derecho hasta su primer aniversario.'
      else format(
        'Generado automaticamente: dias no usados de %s; los dias por derecho (LFT art. 76) se suman el %s.',
        p_anio - 1,
        to_char(vacaciones.aniversario_ingreso(e.fecha_ingreso, p_anio), 'DD/MM/YYYY')
      )
    end
  from vacaciones.empleados e
  join vacaciones.organizaciones o
    on o.id = e.organizacion_id
   and o.eliminado_en is null
  join vacaciones.tipos_ausencia ta
    on ta.organizacion_id = e.organizacion_id
   and ta.codigo = 'VACACIONES'
   and ta.eliminado_en is null
  left join vacaciones.asignaciones_ausencia anterior
    on anterior.empleado_id = e.id
   and anterior.tipo_ausencia_id = ta.id
   and anterior.anio_asignacion = p_anio - 1
   and anterior.eliminado_en is null
  where e.eliminado_en is null
    and e.estado = 'activo'
    and e.fecha_ingreso is not null
    and extract(year from e.fecha_ingreso)::integer <= p_anio
  on conflict (empleado_id, tipo_ausencia_id, anio_asignacion) do nothing;

  get diagnostics v_creados = row_count;

  perform vacaciones.otorgar_dias_aniversario(least(v_hoy, make_date(p_anio, 12, 31)));

  return v_creados;
end;
$$;

-- Otorga los aniversarios ya cumplidos de este anio.
select vacaciones.generar_saldos_anio(
  extract(year from (now() at time zone 'America/Mexico_City'))::integer
);

commit;

-- El pg_cron de 023 sigue igual: diario a las 00:10 del centro de Mexico
-- (06:10 UTC). El 1 de enero crea el anio y cada dia otorga los aniversarios.
select cron.unschedule('saldos-anuales-vacaciones')
where exists (select 1 from cron.job where jobname = 'saldos-anuales-vacaciones');

select cron.schedule(
  'saldos-anuales-vacaciones',
  '10 6 * * *',
  $$select vacaciones.generar_saldos_anio(extract(year from (now() at time zone 'America/Mexico_City'))::integer)$$
);

-- ---------------------------------------------------------------------------
-- Verificacion
-- ---------------------------------------------------------------------------
-- select e.nombre_completo, e.fecha_ingreso, a.anio_asignacion,
--        vacaciones.aniversario_ingreso(e.fecha_ingreso, a.anio_asignacion) as aniversario,
--        a.dias_por_derecho, a.dias_acumulados_a_fecha, a.dias_disponibles,
--        a.derecho_otorgado_en
-- from vacaciones.asignaciones_ausencia a
-- join vacaciones.empleados e on e.id = a.empleado_id
-- where a.eliminado_en is null
-- order by e.nombre_completo, a.anio_asignacion;
