-- 028_saldo_anio_siguiente_y_uso_de_derecho.sql
-- Spec: openspec/changes/saldo-anio-siguiente-y-uso-de-derecho
--
-- 1) generar_saldos_vigentes(): genera el saldo del anio en curso y el del
--    siguiente. El del siguiente arrastra los dias no usados (023), asi que
--    una solicitud del 28 de diciembre al 15 de enero ya puede validarse.
--    pg_cron la ejecuta a diario en lugar de generar_saldos_anio(anio).
--
-- 2) otorgar_dias_aniversario(hasta): si RRHH ya capturo los dias por
--    derecho del saldo, solo registra la fecha de otorgamiento sin volver a
--    sumarlos.
--
-- 3) Los dias por derecho de un anio solo se usan desde el aniversario de
--    ingreso de ese anio (cuando cumple el anio de servicio). Un disparador
--    diferido valida cada solicitud al final de la transaccion, ya con su
--    estado y descuento definitivos, sin importar que funcion la cambio.
--
-- Ejecutar despues de 027. Seguro de re-ejecutar.

begin;

-- ---------------------------------------------------------------------------
-- 1) Saldo del anio siguiente por adelantado
-- ---------------------------------------------------------------------------
create or replace function vacaciones.generar_saldos_vigentes()
returns integer
language plpgsql
security definer
set search_path = vacaciones, public
as $$
declare
  v_anio integer := extract(year from (now() at time zone 'America/Mexico_City'))::integer;
  v_creados integer;
begin
  -- Primero el anio en curso: el siguiente toma sus disponibles como acumulados.
  v_creados := vacaciones.generar_saldos_anio(v_anio);
  v_creados := v_creados + vacaciones.generar_saldos_anio(v_anio + 1);
  return v_creados;
end;
$$;

revoke execute on function vacaciones.generar_saldos_vigentes() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Otorgamiento sin duplicar dias capturados a mano (redefine 024)
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
  set dias_por_derecho = case when a.dias_por_derecho > 0 then a.dias_por_derecho else p.derecho end,
      dias_disponibles = a.dias_disponibles + case when a.dias_por_derecho > 0 then 0 else p.derecho end,
      derecho_otorgado_en = p.aniversario,
      fecha_corte_saldo = case when a.dias_por_derecho > 0 then a.fecha_corte_saldo else current_date end
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
-- 3) Dias por derecho solo desde el aniversario
-- ---------------------------------------------------------------------------
-- Para cada anio con dias de la solicitud antes del aniversario se exige:
--   antes <= disponibles + (dias propios ya descontados, si esta aprobada)
--            + aprobados del anio desde el aniversario - dias por derecho
-- Es decir, los dias anteriores al aniversario no consumen dias por derecho.
create or replace function vacaciones.validar_uso_dias_por_derecho()
returns trigger
language plpgsql
security definer
set search_path = vacaciones, public
as $$
declare
  v_solicitud vacaciones.solicitudes_ausencia%rowtype;
  v_fecha_ingreso date;
  v_anio record;
  v_disponibles_antes numeric(8,2);
begin
  -- Disparador diferido: se relee la fila con el estado final de la transaccion.
  select * into v_solicitud
  from vacaciones.solicitudes_ausencia
  where id = new.id;

  if not found
     or v_solicitud.eliminado_en is not null
     or not v_solicitud.descuenta_saldo
     or v_solicitud.estado not in ('planeada', 'pendiente', 'aprobada') then
    return null;
  end if;

  select fecha_ingreso into v_fecha_ingreso
  from vacaciones.empleados
  where id = v_solicitud.empleado_id;

  if v_fecha_ingreso is null then
    return null;
  end if;

  for v_anio in
    with dias as (
      select
        extract(year from d.fecha_calendario)::integer as anio,
        d.fecha_calendario,
        d.dias_descontados
      from vacaciones.v_dias_solicitud_calendario d
      where d.solicitud_ausencia_id = v_solicitud.id
        and d.descuenta_saldo
        and d.dias_descontados > 0
    ),
    por_anio as (
      select
        dias.anio,
        vacaciones.aniversario_ingreso(v_fecha_ingreso, dias.anio) as aniversario,
        sum(dias.dias_descontados) as total,
        coalesce(sum(dias.dias_descontados) filter (
          where dias.fecha_calendario < vacaciones.aniversario_ingreso(v_fecha_ingreso, dias.anio)
        ), 0) as antes
      from dias
      group by dias.anio
    )
    select
      p.anio,
      p.aniversario,
      p.total,
      p.antes,
      a.dias_por_derecho,
      a.dias_disponibles,
      coalesce((
        select sum(o.dias_descontados)
        from vacaciones.v_dias_solicitud_calendario o
        where o.empleado_id = v_solicitud.empleado_id
          and o.tipo_ausencia_id = v_solicitud.tipo_ausencia_id
          and o.solicitud_ausencia_id <> v_solicitud.id
          and o.estado = 'aprobada'
          and o.descuenta_saldo
          and o.solicitud_descuenta_saldo
          and o.fecha_calendario >= p.aniversario
          and o.fecha_calendario <= make_date(p.anio, 12, 31)
      ), 0) as aprobados_desde_aniversario
    from por_anio p
    join vacaciones.asignaciones_ausencia a
      on a.empleado_id = v_solicitud.empleado_id
     and a.tipo_ausencia_id = v_solicitud.tipo_ausencia_id
     and a.anio_asignacion = p.anio
     and a.eliminado_en is null
    where p.antes > 0
      and a.dias_por_derecho > 0
  loop
    v_disponibles_antes := v_anio.dias_disponibles
      + case when v_solicitud.estado = 'aprobada' then v_anio.total else 0 end
      + v_anio.aprobados_desde_aniversario
      - v_anio.dias_por_derecho;

    if v_anio.antes > v_disponibles_antes then
      raise exception using
        errcode = 'check_violation',
        message = format(
          'Los %s día(s) por derecho de %s se pueden usar a partir del %s, cuando cumple su año de servicio. Antes de esa fecha hay %s día(s) disponibles y la solicitud usa %s.',
          trim_scale(v_anio.dias_por_derecho),
          v_anio.anio,
          to_char(v_anio.aniversario, 'DD/MM/YYYY'),
          trim_scale(greatest(v_disponibles_antes, 0)),
          trim_scale(v_anio.antes)
        );
    end if;
  end loop;

  return null;
end;
$$;

revoke execute on function vacaciones.validar_uso_dias_por_derecho() from public, anon, authenticated;

drop trigger if exists validar_uso_dias_por_derecho on vacaciones.solicitudes_ausencia;
create constraint trigger validar_uso_dias_por_derecho
  after insert or update of fecha_inicio, fecha_fin, estado, descuenta_saldo, empleado_id, tipo_ausencia_id, eliminado_en
  on vacaciones.solicitudes_ausencia
  deferrable initially deferred
  for each row
  execute function vacaciones.validar_uso_dias_por_derecho();

-- Crea ya el saldo del anio siguiente.
select vacaciones.generar_saldos_vigentes();

commit;

-- pg_cron: diario a las 00:10 del centro de Mexico (06:10 UTC), ahora con el
-- anio siguiente incluido.
select cron.unschedule('saldos-anuales-vacaciones')
where exists (select 1 from cron.job where jobname = 'saldos-anuales-vacaciones');

select cron.schedule(
  'saldos-anuales-vacaciones',
  '10 6 * * *',
  $$select vacaciones.generar_saldos_vigentes()$$
);

-- ---------------------------------------------------------------------------
-- Verificacion
-- ---------------------------------------------------------------------------
-- Saldos con dias por derecho capturados antes de su aniversario:
-- select e.nombre_completo, e.fecha_ingreso, a.anio_asignacion,
--        vacaciones.aniversario_ingreso(e.fecha_ingreso, a.anio_asignacion) as aniversario,
--        a.dias_por_derecho, a.dias_acumulados_a_fecha, a.dias_disponibles,
--        a.derecho_otorgado_en, a.arrastre_automatico
-- from vacaciones.asignaciones_ausencia a
-- join vacaciones.empleados e on e.id = a.empleado_id
-- where a.eliminado_en is null
-- order by e.nombre_completo, a.anio_asignacion;
