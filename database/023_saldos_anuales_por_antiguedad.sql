-- 023_saldos_anuales_por_antiguedad.sql
-- Spec: openspec/changes/saldos-anuales-por-antiguedad
--
-- 1) vacaciones.dias_vacaciones_lft(anios): dias por derecho segun el art. 76
--    de la LFT (1: 12, 2: 14, 3: 16, 4: 18, 5: 20; desde el sexto anio, dos
--    dias mas por cada cinco anios de servicio: 6-10: 22, 11-15: 24, ...).
--
-- 2) vacaciones.generar_saldos_anio(anio): crea el saldo de vacaciones del
--    anio para cada empleado activo con fecha de ingreso que todavia no lo
--    tenga. La antiguedad es la que cumple en ese anio (anio - anio de
--    ingreso), como en la carga inicial de 2026 (002):
--      dias_por_derecho        = dias_vacaciones_lft(antiguedad)
--      dias_acumulados_a_fecha = dias_disponibles del anio anterior (o 0)
--      dias_disponibles        = derecho + acumulados
--    Nunca modifica un saldo existente. pg_cron la ejecuta a diario para el
--    anio en curso; administracion y RRHH pueden llamarla por RPC (por
--    ejemplo, para generar el anio siguiente en diciembre).
--
-- 3) Arrastre sincronizado: si cambian los dias_disponibles de un anio y el
--    siguiente fue generado automaticamente (arrastre_automatico), la misma
--    diferencia se aplica a sus acumulados y disponibles. Asi una solicitud
--    tardia del anio anterior no cuenta dos veces el remanente.
--
-- 4) Completa dias_por_derecho del anio en curso que quedo en 0 en la carga
--    inicial. Es informativo: no cambia dias_disponibles.
--
-- Ejecutar despues de 022. Seguro de re-ejecutar.

begin;

-- ---------------------------------------------------------------------------
-- 1) Dias por derecho segun la LFT
-- ---------------------------------------------------------------------------
create or replace function vacaciones.dias_vacaciones_lft(p_anios integer)
returns numeric(8,2)
language sql
immutable
set search_path = vacaciones, public
as $$
  select (case
    when p_anios is null or p_anios < 1 then 0
    when p_anios <= 5 then 10 + 2 * p_anios
    else 22 + 2 * ((p_anios - 6) / 5)
  end)::numeric(8,2);
$$;

comment on function vacaciones.dias_vacaciones_lft(integer) is
  'Dias de vacaciones por anios de servicio cumplidos (art. 76 LFT). Menos de un anio: 0.';

-- ---------------------------------------------------------------------------
-- 2) Generacion del saldo anual
-- ---------------------------------------------------------------------------
alter table vacaciones.asignaciones_ausencia
  add column if not exists arrastre_automatico boolean not null default false;

comment on column vacaciones.asignaciones_ausencia.arrastre_automatico is
  'Saldo generado por generar_saldos_anio: sus acumulados siguen los cambios de dias_disponibles del anio anterior.';

create or replace function vacaciones.generar_saldos_anio(p_anio integer)
returns integer
language plpgsql
security definer
set search_path = vacaciones, public
as $$
declare
  v_anio_actual integer :=
    extract(year from (now() at time zone 'America/Mexico_City'))::integer;
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
    d.derecho,
    d.acumulados,
    d.derecho + d.acumulados,
    current_date,
    true,
    format(
      'Generado automaticamente: %s anio(s) de antiguedad en %s (LFT art. 76) mas dias no usados de %s.',
      p_anio - extract(year from e.fecha_ingreso)::integer, p_anio, p_anio - 1
    )
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
  cross join lateral (
    select
      vacaciones.dias_vacaciones_lft(
        p_anio - extract(year from e.fecha_ingreso)::integer
      ) as derecho,
      coalesce(anterior.dias_disponibles, 0)::numeric(8,2) as acumulados
  ) d
  where e.eliminado_en is null
    and e.estado = 'activo'
    and e.fecha_ingreso is not null
    and extract(year from e.fecha_ingreso)::integer <= p_anio
  on conflict (empleado_id, tipo_ausencia_id, anio_asignacion) do nothing;

  get diagnostics v_creados = row_count;
  return v_creados;
end;
$$;

revoke execute on function vacaciones.generar_saldos_anio(integer) from public, anon;
grant execute on function vacaciones.generar_saldos_anio(integer)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Arrastre sincronizado al anio siguiente
-- ---------------------------------------------------------------------------
create or replace function vacaciones.arrastrar_saldo_anio_siguiente()
returns trigger
language plpgsql
security definer
set search_path = vacaciones, public
as $$
declare
  v_diferencia numeric(8,2);
  v_siguiente record;
begin
  if new.eliminado_en is not null then
    return new;
  end if;

  v_diferencia := new.dias_disponibles
    - case when tg_op = 'UPDATE' then old.dias_disponibles else 0 end;
  if v_diferencia = 0 then
    return new;
  end if;

  select id, dias_disponibles
  into v_siguiente
  from vacaciones.asignaciones_ausencia
  where empleado_id = new.empleado_id
    and tipo_ausencia_id = new.tipo_ausencia_id
    and anio_asignacion = new.anio_asignacion + 1
    and arrastre_automatico
    and eliminado_en is null
  for update;

  if not found then
    return new;
  end if;

  if v_siguiente.dias_disponibles + v_diferencia < 0 then
    raise exception
      'Los dias no usados de % ya se pasaron a % y se utilizaron: faltan % dia(s) en el saldo de %.',
      new.anio_asignacion, new.anio_asignacion + 1,
      trim_scale(-(v_siguiente.dias_disponibles + v_diferencia)),
      new.anio_asignacion + 1;
  end if;

  -- Actualizar dias_disponibles vuelve a disparar este trigger y propaga la
  -- diferencia a los anios siguientes generados automaticamente.
  update vacaciones.asignaciones_ausencia
  set dias_acumulados_a_fecha = greatest(dias_acumulados_a_fecha + v_diferencia, 0),
      dias_disponibles = dias_disponibles + v_diferencia,
      fecha_corte_saldo = current_date
  where id = v_siguiente.id;

  return new;
end;
$$;

revoke execute on function vacaciones.arrastrar_saldo_anio_siguiente() from public;

drop trigger if exists arrastrar_saldo_anio_siguiente on vacaciones.asignaciones_ausencia;
create trigger arrastrar_saldo_anio_siguiente
  after insert or update of dias_disponibles
  on vacaciones.asignaciones_ausencia
  for each row
  execute function vacaciones.arrastrar_saldo_anio_siguiente();

-- ---------------------------------------------------------------------------
-- 4) Dias por derecho del anio en curso que quedaron en 0
-- ---------------------------------------------------------------------------
update vacaciones.asignaciones_ausencia a
set dias_por_derecho = vacaciones.dias_vacaciones_lft(
      a.anio_asignacion - extract(year from e.fecha_ingreso)::integer
    )
from vacaciones.empleados e, vacaciones.tipos_ausencia ta
where e.id = a.empleado_id
  and ta.id = a.tipo_ausencia_id
  and ta.codigo = 'VACACIONES'
  and a.eliminado_en is null
  and a.dias_por_derecho = 0
  and e.fecha_ingreso is not null
  and a.anio_asignacion = extract(year from (now() at time zone 'America/Mexico_City'))::integer
  and vacaciones.dias_vacaciones_lft(
        a.anio_asignacion - extract(year from e.fecha_ingreso)::integer
      ) > 0;

-- Crea los saldos faltantes del anio en curso (altas sin saldo).
select vacaciones.generar_saldos_anio(
  extract(year from (now() at time zone 'America/Mexico_City'))::integer
);

commit;

-- Todos los dias a las 00:10 hora del centro de Mexico (06:10 UTC): el 1 de
-- enero crea el anio nuevo y el resto del anio capta altas o fechas de
-- ingreso completadas despues.
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
-- select vacaciones.dias_vacaciones_lft(n), n from generate_series(0, 32) n;
--
-- Generar por adelantado el anio siguiente (por ejemplo, en diciembre):
--   select vacaciones.generar_saldos_anio(2027);
--
-- select e.nombre_completo, e.fecha_ingreso, a.anio_asignacion,
--        a.dias_por_derecho, a.dias_acumulados_a_fecha, a.dias_disponibles,
--        a.arrastre_automatico
-- from vacaciones.asignaciones_ausencia a
-- join vacaciones.empleados e on e.id = a.empleado_id
-- where a.eliminado_en is null
-- order by e.nombre_completo, a.anio_asignacion;
