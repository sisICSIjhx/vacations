-- 018_festivos_no_descuentan.sql
-- Los dias festivos ya no consumen vacaciones, igual que el dia de descanso
-- del empleado (016).
--
-- Hasta ahora el tipo VACACIONES tenia excluir_dias_festivos = false, asi que
-- v_dias_solicitud_calendario cobraba el festivo como un dia mas. Aqui:
--   * se activa excluir_dias_festivos en VACACIONES;
--   * se devuelven a asignaciones_ausencia.dias_disponibles los festivos que ya
--     se habian cobrado en solicitudes APROBADAS (las pendientes no tocan el
--     saldo guardado: se recalculan solas desde la vista);
--   * si un administrador agrega, cambia o borra un festivo en Catalogos, el
--     saldo de las solicitudes aprobadas que lo cruzan se ajusta solo.
--
-- El ajuste compara una foto de los dias aprobados antes del cambio contra los
-- de despues, por empleado / tipo / anio, y aplica la diferencia.

begin;

-- Foto de los dias que descuentan las solicitudes aprobadas, en una tabla
-- temporal que vive hasta el final de la transaccion.
create or replace function vacaciones.capturar_dias_aprobados()
returns void
language plpgsql
security definer
set search_path = vacaciones, public
as $$
begin
  create temp table if not exists dias_aprobados_previos (
    empleado_id uuid,
    tipo_ausencia_id uuid,
    anio integer,
    dias numeric
  ) on commit drop;
  delete from dias_aprobados_previos;

  insert into dias_aprobados_previos
  select empleado_id, tipo_ausencia_id, extract(year from fecha_calendario)::integer, sum(dias_descontados)
  from vacaciones.v_dias_solicitud_calendario
  where estado = 'aprobada'
    and solicitud_descuenta_saldo
  group by empleado_id, tipo_ausencia_id, extract(year from fecha_calendario)::integer;

  -- Marca que hay una foto pendiente de conciliar (ver conciliar_dias_aprobados).
  perform set_config('vacaciones.foto_dias_aprobados', 'pendiente', true);
end;
$$;

-- Devuelve (o vuelve a cobrar) la diferencia entre la foto y el calculo actual.
-- El DELETE de un festivo se convierte en un UPDATE (borrado_logico), que
-- dispara su propio par de triggers dentro del DELETE: el par interno concilia
-- y el externo ya no encuentra foto pendiente, asi no se cobra dos veces.
create or replace function vacaciones.conciliar_dias_aprobados()
returns void
language plpgsql
security definer
set search_path = vacaciones, public
as $$
declare
  v_faltante record;
begin
  if coalesce(current_setting('vacaciones.foto_dias_aprobados', true), '') <> 'pendiente' then
    return;
  end if;
  perform set_config('vacaciones.foto_dias_aprobados', '', true);

  create temp table diferencia_dias_aprobados on commit drop as
  with actuales as (
    select empleado_id, tipo_ausencia_id, extract(year from fecha_calendario)::integer as anio, sum(dias_descontados) as dias
    from vacaciones.v_dias_solicitud_calendario
    where estado = 'aprobada'
      and solicitud_descuenta_saldo
    group by empleado_id, tipo_ausencia_id, extract(year from fecha_calendario)::integer
  )
  select empleado_id, tipo_ausencia_id, anio,
         coalesce(p.dias, 0) - coalesce(a.dias, 0) as devolver
  from dias_aprobados_previos p
  full join actuales a using (empleado_id, tipo_ausencia_id, anio)
  where coalesce(p.dias, 0) <> coalesce(a.dias, 0);

  -- Quitar un festivo vuelve a cobrar ese dia; si el empleado ya no tiene
  -- saldo, se explica en lugar de fallar con el check de la tabla.
  select e.nombre_completo, d.anio, a.dias_disponibles, -d.devolver as dias
    into v_faltante
  from diferencia_dias_aprobados d
  join vacaciones.asignaciones_ausencia a
    on a.empleado_id = d.empleado_id
   and a.tipo_ausencia_id = d.tipo_ausencia_id
   and a.anio_asignacion = d.anio
   and a.eliminado_en is null
  join vacaciones.empleados e on e.id = d.empleado_id
  where a.dias_disponibles + d.devolver < 0
  limit 1;
  if found then
    raise exception
      'El cambio volveria a cobrar % dia(s) a % en %, pero solo tiene % disponible(s).',
      trim_scale(v_faltante.dias), v_faltante.nombre_completo, v_faltante.anio, trim_scale(v_faltante.dias_disponibles);
  end if;

  update vacaciones.asignaciones_ausencia a
  set dias_disponibles = a.dias_disponibles + d.devolver,
      fecha_corte_saldo = current_date
  from diferencia_dias_aprobados d
  where a.empleado_id = d.empleado_id
    and a.tipo_ausencia_id = d.tipo_ausencia_id
    and a.anio_asignacion = d.anio
    and a.eliminado_en is null;

  drop table diferencia_dias_aprobados;
  delete from dias_aprobados_previos;
end;
$$;

create or replace function vacaciones.antes_cambio_festivos()
returns trigger
language plpgsql
security definer
set search_path = vacaciones, public
as $$
begin
  perform vacaciones.capturar_dias_aprobados();
  return null;
end;
$$;

create or replace function vacaciones.despues_cambio_festivos()
returns trigger
language plpgsql
security definer
set search_path = vacaciones, public
as $$
begin
  perform vacaciones.conciliar_dias_aprobados();
  return null;
end;
$$;

drop trigger if exists antes_cambio_festivos on vacaciones.dias_festivos;
create trigger antes_cambio_festivos
before insert or update or delete on vacaciones.dias_festivos
for each statement execute function vacaciones.antes_cambio_festivos();

drop trigger if exists despues_cambio_festivos on vacaciones.dias_festivos;
create trigger despues_cambio_festivos
after insert or update or delete on vacaciones.dias_festivos
for each statement execute function vacaciones.despues_cambio_festivos();

-- Activar la regla y devolver lo que ya se habia cobrado.
select vacaciones.capturar_dias_aprobados();

update vacaciones.tipos_ausencia
set excluir_dias_festivos = true
where codigo = 'VACACIONES'
  and eliminado_en is null
  and not excluir_dias_festivos;

select vacaciones.conciliar_dias_aprobados();

commit;

-- Verificacion: los festivos ya descuentan 0.
-- select nombre_completo, fecha_calendario, dias_descontados
-- from vacaciones.v_dias_solicitud_calendario
-- where es_festivo
-- order by fecha_calendario, nombre_completo;
