-- 022_conservar_dias_y_cancelar_con_motivo.sql
-- Spec: openspec/changes/conservar-dias-y-cancelar-con-motivo
--
-- 1) Eliminar una solicitud APROBADA ya no reintegra sus dias: eso indicaria
--    que el empleado no los tomo. Los dias de cada anio se guardan en
--    vacaciones.dias_conservados_solicitud y v_saldo_vacaciones_empleado los
--    sigue contando en dias_tomados_anio aunque la solicitud ya no se vea.
--    Restaurarla borra esos dias conservados sin volver a descontar; una
--    eliminada antes de esta migracion (sin conservados) se restaura como antes.
--
-- 2) Cancelar los dias de una solicitud aprobada sin eliminarla:
--    vacaciones.cancelar_dias_solicitud(id, motivo) la deja 'cancelada' en el
--    historial, reintegra los dias (cambiar_estado_solicitud, 012), guarda el
--    motivo y quien cancelo, avisa al empleado en el sistema y le envia el
--    correo 'dias_reintegrados'.
--
-- Requiere volver a desplegar la Edge Function "notificar-empleado".
-- Ejecutar despues de 021. Seguro de re-ejecutar.

begin;

-- ---------------------------------------------------------------------------
-- 1) Dias conservados de solicitudes aprobadas eliminadas
-- ---------------------------------------------------------------------------
create table if not exists vacaciones.dias_conservados_solicitud (
  solicitud_ausencia_id uuid not null
    references vacaciones.solicitudes_ausencia(id) on delete cascade,
  empleado_id uuid not null
    references vacaciones.empleados(id) on delete cascade,
  tipo_ausencia_id uuid not null
    references vacaciones.tipos_ausencia(id) on delete cascade,
  anio integer not null check (anio between 2000 and 2200),
  dias numeric(8,2) not null check (dias >= 0),
  creado_en timestamptz not null default now(),
  primary key (solicitud_ausencia_id, anio)
);

comment on table vacaciones.dias_conservados_solicitud is
  'Dias de una solicitud aprobada que se elimino: siguen contando como tomados en v_saldo_vacaciones_empleado. Los escriben los disparadores de borrado/restauracion.';

create index if not exists dias_conservados_saldo_idx
  on vacaciones.dias_conservados_solicitud (empleado_id, tipo_ausencia_id, anio);

alter table vacaciones.dias_conservados_solicitud enable row level security;
revoke all on vacaciones.dias_conservados_solicitud from public, anon, authenticated;
grant select on vacaciones.dias_conservados_solicitud to authenticated;
grant all on vacaciones.dias_conservados_solicitud to service_role;

-- Misma visibilidad que el saldo: quien puede leer la asignacion del anio
-- (propia, RRHH/Mesa, jefe inmediato, administrador) lee sus conservados.
drop policy if exists lectura_como_asignacion on vacaciones.dias_conservados_solicitud;
create policy lectura_como_asignacion
  on vacaciones.dias_conservados_solicitud
  for select to authenticated
  using (
    exists (
      select 1
      from vacaciones.asignaciones_ausencia a
      where a.empleado_id = dias_conservados_solicitud.empleado_id
        and a.tipo_ausencia_id = dias_conservados_solicitud.tipo_ausencia_id
        and a.anio_asignacion = dias_conservados_solicitud.anio
    )
  );

-- Antes de marcar eliminado_en (la solicitud aun aparece en la vista de dias):
-- se guardan los dias en lugar de reintegrarlos.
create or replace function vacaciones.ajustar_saldo_borrado_solicitud()
returns trigger
language plpgsql
security definer
set search_path = vacaciones, public
as $$
begin
  if old.eliminado_en is null
     and new.eliminado_en is not null
     and old.estado = 'aprobada'
     and old.descuenta_saldo then
    insert into vacaciones.dias_conservados_solicitud (
      solicitud_ausencia_id, empleado_id, tipo_ausencia_id, anio, dias
    )
    select
      old.id,
      old.empleado_id,
      old.tipo_ausencia_id,
      extract(year from fecha_calendario)::integer,
      sum(dias_descontados)::numeric(8,2)
    from vacaciones.v_dias_solicitud_calendario
    where solicitud_ausencia_id = old.id
    group by extract(year from fecha_calendario)::integer
    on conflict (solicitud_ausencia_id, anio) do update
      set dias = excluded.dias,
          creado_en = now();
  end if;

  return new;
end;
$$;

create or replace function vacaciones.ajustar_saldo_restauracion_solicitud()
returns trigger
language plpgsql
security definer
set search_path = vacaciones, public
as $$
declare
  uso record;
begin
  if old.eliminado_en is not null
     and new.eliminado_en is null
     and new.estado = 'aprobada'
     and new.descuenta_saldo then
    -- Eliminada con la regla de 022: los dias nunca se reintegraron.
    delete from vacaciones.dias_conservados_solicitud
    where solicitud_ausencia_id = new.id;
    if found then
      return new;
    end if;

    -- Eliminada antes de 022: se reintegro al borrar, se vuelve a descontar.
    for uso in
      select
        extract(year from fecha_calendario)::integer as anio,
        sum(dias_descontados)::numeric(8,2) as dias
      from vacaciones.v_dias_solicitud_calendario
      where solicitud_ausencia_id = new.id
      group by extract(year from fecha_calendario)::integer
    loop
      update vacaciones.asignaciones_ausencia
      set dias_disponibles = dias_disponibles - uso.dias,
          fecha_corte_saldo = current_date
      where empleado_id = new.empleado_id
        and tipo_ausencia_id = new.tipo_ausencia_id
        and anio_asignacion = uso.anio
        and eliminado_en is null
        and dias_disponibles >= uso.dias;

      if not found then
        raise exception
          'Saldo insuficiente o asignacion activa inexistente para el anio %.',
          uso.anio;
      end if;
    end loop;
  end if;

  return new;
end;
$$;

revoke execute on function vacaciones.ajustar_saldo_borrado_solicitud() from public;
revoke execute on function vacaciones.ajustar_saldo_restauracion_solicitud() from public;

-- Igual que 001, pero dias_aprobados (dias_tomados_anio) incluye los
-- conservados de solicitudes aprobadas eliminadas.
create or replace view vacaciones.v_saldo_vacaciones_empleado
with (security_invoker = true)
as
with uso_por_anio as (
  select
    empleado_id,
    tipo_ausencia_id,
    anio_asignacion,
    -- bigint como en 001: create or replace view no admite cambiar el tipo.
    sum(cantidad_solicitudes)::bigint as cantidad_solicitudes,
    sum(dias_planeados) as dias_planeados,
    sum(dias_pendientes) as dias_pendientes,
    sum(dias_aprobados) as dias_aprobados
  from (
    select
      empleado_id,
      tipo_ausencia_id,
      extract(year from fecha_calendario)::integer as anio_asignacion,
      count(distinct solicitud_ausencia_id) filter (
        where estado in ('planeada', 'pendiente', 'aprobada')
      ) as cantidad_solicitudes,
      coalesce(sum(dias_descontados) filter (where estado = 'planeada'), 0)
        as dias_planeados,
      coalesce(sum(dias_descontados) filter (where estado = 'pendiente'), 0)
        as dias_pendientes,
      coalesce(sum(dias_descontados) filter (where estado = 'aprobada'), 0)
        as dias_aprobados
    from vacaciones.v_dias_solicitud_calendario
    where descuenta_saldo
    group by
      empleado_id,
      tipo_ausencia_id,
      extract(year from fecha_calendario)::integer
    union all
    select
      empleado_id,
      tipo_ausencia_id,
      anio,
      count(*),
      0,
      0,
      sum(dias)
    from vacaciones.dias_conservados_solicitud
    group by empleado_id, tipo_ausencia_id, anio
  ) uso
  group by empleado_id, tipo_ausencia_id, anio_asignacion
)
select
  a.id as asignacion_ausencia_id,
  e.organizacion_id,
  a.empleado_id,
  e.numero_empleado,
  e.nombre_completo,
  e.color_calendario,
  e.sede_id,
  se.nombre as nombre_sede,
  e.proyecto_id,
  p.nombre as nombre_proyecto,
  e.categoria_id,
  c.nombre as nombre_categoria,
  a.tipo_ausencia_id,
  ta.codigo as codigo_tipo_ausencia,
  ta.nombre as nombre_tipo_ausencia,
  a.anio_asignacion,
  a.dias_por_derecho,
  a.dias_acumulados_a_fecha,
  a.dias_disponibles,
  a.fecha_corte_saldo,
  a.dias_transferidos,
  a.ajuste_dias,
  a.dias_utilizados_antes_sistema,
  (a.dias_por_derecho + a.dias_transferidos + a.ajuste_dias)::numeric(8,2)
    as total_dias_por_derecho,
  coalesce(u.cantidad_solicitudes, 0) as cantidad_solicitudes,
  (coalesce(u.cantidad_solicitudes, 0) > 0) as solicito_vacaciones,
  coalesce(u.dias_planeados, 0)::numeric(8,2) as dias_planeados,
  coalesce(u.dias_pendientes, 0)::numeric(8,2) as dias_pendientes,
  coalesce(u.dias_aprobados, 0)::numeric(8,2) as dias_tomados_anio,
  a.dias_disponibles::numeric(8,2) as dias_restantes_despues_aprobadas,
  (
    a.dias_disponibles
    - coalesce(u.dias_pendientes, 0)
    - coalesce(u.dias_planeados, 0)
  )::numeric(8,2) as dias_restantes_despues_compromisos
from vacaciones.asignaciones_ausencia a
join vacaciones.empleados e
  on e.id = a.empleado_id
join vacaciones.organizaciones o
  on o.id = e.organizacion_id
 and o.eliminado_en is null
join vacaciones.tipos_ausencia ta
  on ta.id = a.tipo_ausencia_id
left join vacaciones.sedes se
  on se.id = e.sede_id
 and se.eliminado_en is null
left join vacaciones.proyectos p
  on p.id = e.proyecto_id
 and p.eliminado_en is null
left join vacaciones.categorias_empleado c
  on c.id = e.categoria_id
 and c.eliminado_en is null
left join uso_por_anio u
  on u.empleado_id = a.empleado_id
 and u.tipo_ausencia_id = a.tipo_ausencia_id
 and u.anio_asignacion = a.anio_asignacion
where a.eliminado_en is null
  and e.eliminado_en is null
  and ta.eliminado_en is null;

-- ---------------------------------------------------------------------------
-- 2) Cancelar los dias de una solicitud aprobada, con motivo
-- ---------------------------------------------------------------------------
alter table vacaciones.solicitudes_ausencia
  add column if not exists motivo_cancelacion text,
  add column if not exists cancelado_en timestamptz,
  add column if not exists cancelado_por uuid,
  add column if not exists cancelado_por_nombre text;

comment on column vacaciones.solicitudes_ausencia.motivo_cancelacion is
  'Motivo por el que se cancelaron los dias de una solicitud aprobada (cancelar_dias_solicitud); se envia al empleado.';

-- Nuevo tipo de aviso dentro del sistema.
alter table vacaciones.avisos_empleado
  drop constraint if exists avisos_empleado_tipo_check;
alter table vacaciones.avisos_empleado
  add constraint avisos_empleado_tipo_check
  check (tipo in ('solicitud_creada', 'avance_etapa', 'aprobada', 'rechazada', 'dias_reintegrados'));

-- Igual que 020, con el bloque "cancelacion" (motivo y quien cancelo).
create or replace function vacaciones.enviar_correo_empleado(
  p_evento text,
  p_solicitud_id uuid,
  p_revision_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = vacaciones, public
as $$
declare
  v_cfg vacaciones.notificaciones_push_config%rowtype;
  v_payload jsonb;
begin
  select * into v_cfg from vacaciones.notificaciones_push_config where habilitado limit 1;
  if not found or v_cfg.correo_function_url is null then
    return;
  end if;

  select jsonb_build_object(
    'evento', p_evento,
    'solicitud_id', s.id,
    'empleado', jsonb_build_object('nombre', e.nombre_completo, 'correo', e.correo_electronico),
    'tipo_ausencia', t.nombre,
    'fecha_inicio', s.fecha_inicio,
    'fecha_fin', s.fecha_fin,
    'fecha_reintegro', s.fecha_reintegro,
    'dias', (
      select coalesce(sum(d.dias_descontados), 0)
      from vacaciones.v_dias_solicitud_calendario d
      where d.solicitud_ausencia_id = s.id
    ),
    'comentarios', nullif(btrim(s.comentarios), ''),
    'revision', case when r.id is null then null else jsonb_build_object(
      'etapa', r.etapa,
      'decision', r.decision,
      'comentario', r.comentario
    ) end,
    -- Solo con la resolucion: el historial de revisiones del ciclo actual
    'revisiones', case when r.id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
          'etapa', h.etapa,
          'decision', h.decision,
          'revisor', nullif(btrim(p.nombre_visible), ''),
          'comentario', nullif(btrim(h.comentario), '')
        ) order by h.creado_en, h.id)
      from vacaciones.revisiones_solicitud h
      left join vacaciones.perfiles_usuario p on p.usuario_id = h.usuario_id
      where h.solicitud_ausencia_id = s.id
        and h.creado_en <= r.creado_en
        and h.creado_en > coalesce((
          select max(x.creado_en)
          from vacaciones.revisiones_solicitud x
          where x.solicitud_ausencia_id = s.id
            and x.estado_resultante = 'rechazada'
            and x.id <> r.id
            and x.creado_en < r.creado_en
        ), '-infinity'::timestamptz)
    ), '[]'::jsonb) end,
    -- Solo con dias_reintegrados (022)
    'cancelacion', case when s.motivo_cancelacion is null then null else jsonb_build_object(
      'motivo', s.motivo_cancelacion,
      'cancelado_por', s.cancelado_por_nombre,
      'cancelado_en', s.cancelado_en
    ) end
  )
  into v_payload
  from vacaciones.solicitudes_ausencia s
  join vacaciones.empleados e on e.id = s.empleado_id
  left join vacaciones.tipos_ausencia t on t.id = s.tipo_ausencia_id
  left join vacaciones.revisiones_solicitud r on r.id = p_revision_id
  where s.id = p_solicitud_id;

  if v_payload is null then
    return;
  end if;

  perform net.http_post(
    url := v_cfg.correo_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_cfg.webhook_secret
    ),
    body := v_payload,
    timeout_milliseconds := 20000
  );
exception when others then
  raise warning 'enviar_correo_empleado(%, %): %', p_evento, p_solicitud_id, sqlerrm;
end;
$$;

revoke execute on function vacaciones.enviar_correo_empleado(text, uuid, uuid) from public, anon, authenticated;

create or replace function vacaciones.cancelar_dias_solicitud(
  p_solicitud_id uuid,
  p_motivo text
)
returns vacaciones.solicitudes_ausencia
language plpgsql
security definer
set search_path = vacaciones, auth, public
as $$
declare
  solicitud vacaciones.solicitudes_ausencia%rowtype;
  resultado vacaciones.solicitudes_ausencia%rowtype;
  v_dias numeric(8,2);
begin
  -- "security definer": la autorizacion se valida aqui explicitamente.
  if not vacaciones.es_administrador() then
    raise exception 'Solo el administrador puede cancelar los dias de una solicitud.';
  end if;

  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Indica el motivo de la cancelacion; se envia al empleado.';
  end if;

  select * into solicitud
  from vacaciones.solicitudes_ausencia
  where id = p_solicitud_id and eliminado_en is null
  for update;

  if not found then
    raise exception 'Solicitud no encontrada.';
  end if;

  if solicitud.estado <> 'aprobada' then
    raise exception 'Solo se pueden cancelar los dias de una solicitud aprobada.';
  end if;

  select coalesce(sum(dias_descontados), 0)::numeric(8,2) into v_dias
  from vacaciones.v_dias_solicitud_calendario
  where solicitud_ausencia_id = p_solicitud_id;

  -- Reintegra los dias y deja la auditoria de estado (012 / 001).
  perform vacaciones.cambiar_estado_solicitud(p_solicitud_id, 'cancelada');

  update vacaciones.solicitudes_ausencia
  set motivo_cancelacion = btrim(p_motivo),
      cancelado_en = now(),
      cancelado_por = auth.uid(),
      cancelado_por_nombre = vacaciones.nombre_usuario_actual()
  where id = p_solicitud_id
  returning * into resultado;

  update vacaciones.historial_estados_solicitud
  set comentarios = btrim(p_motivo)
  where id = (
    select max(id) from vacaciones.historial_estados_solicitud
    where solicitud_ausencia_id = p_solicitud_id and estado_nuevo = 'cancelada'
  );

  insert into vacaciones.avisos_empleado (empleado_id, solicitud_ausencia_id, tipo, titulo, mensaje)
  values (
    resultado.empleado_id, resultado.id, 'dias_reintegrados',
    'Se reintegraron días a tu saldo de vacaciones',
    format('Se cancelaron tus vacaciones del %s al %s y se reintegraron %s día(s) a tu saldo. Motivo: %s',
      to_char(resultado.fecha_inicio, 'DD/MM/YYYY'), to_char(resultado.fecha_fin, 'DD/MM/YYYY'),
      trim(trailing '.' from trim(trailing '0' from v_dias::text)), btrim(p_motivo))
  );

  perform vacaciones.enviar_correo_empleado('dias_reintegrados', p_solicitud_id);
  return resultado;
end;
$$;

revoke execute on function vacaciones.cancelar_dias_solicitud(uuid, text) from public, anon;
grant execute on function vacaciones.cancelar_dias_solicitud(uuid, text)
  to authenticated, service_role;

commit;

-- Consultas de revision:
-- select s.id, e.nombre_completo, s.fecha_inicio, s.fecha_fin, s.motivo_cancelacion,
--        s.cancelado_por_nombre, s.cancelado_en
-- from vacaciones.solicitudes_ausencia s
-- join vacaciones.empleados e on e.id = s.empleado_id
-- where s.motivo_cancelacion is not null
-- order by s.cancelado_en desc;
--
-- select * from vacaciones.dias_conservados_solicitud order by creado_en desc;
