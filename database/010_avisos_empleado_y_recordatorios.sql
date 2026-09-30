-- ICSI OIL & GAS - Sistema de vacaciones
-- Avisos al empleado (sistema y correo) y recordatorios de aprobacion.
-- Ejecutar despues de 008_notificaciones_whatsapp.sql. Aditivo y seguro de
-- re-ejecutar.
--
-- 008 ya avisa al grupo de WhatsApp al crear, avanzar, aprobar y rechazar
-- (bitacora vacaciones.notificaciones -> Edge Function "notificar"). Este
-- script NO toca ese flujo; agrega:
--
--   1) vacaciones.avisos_empleado: avisos dentro del sistema para el empleado
--      que solicito (creada, avance de etapa, aprobada, rechazada).
--   2) Correo al empleado via la Edge Function "notificar-empleado"
--      (Microsoft Graph): al crear (acuse), al aprobar y al rechazar (con el
--      motivo y la invitacion a reagendar). Reusa el webhook_secret de
--      notificaciones_push_config; la URL va en la columna nueva
--      correo_function_url.
--   3) Recordatorios: una solicitud con mas de 2 dias naturales en la misma
--      etapa genera una fila tipo 'recordatorio' en vacaciones.notificaciones,
--      que el trigger de 008 reenvia al grupo. Maximo uno al dia, de lunes a
--      viernes a las 9:00 (centro de Mexico), via pg_cron.
--   4) Motivo obligatorio al rechazar (se envia al empleado por correo).
--
-- Los avisos de decision se disparan desde revisiones_solicitud y no desde
-- solicitudes_ausencia: revisar_solicitud actualiza la solicitud ANTES de
-- insertar la revision, y solo en la revision esta el motivo del rechazo.
--
-- IMPORTANTE: NO escribas secretos en este archivo (ver el final).

create extension if not exists pg_net;
create extension if not exists pg_cron;

begin;

-- ---------------------------------------------------------------------------
-- 1) URL de la Edge Function de correo, junto a la configuracion de 008
-- ---------------------------------------------------------------------------
alter table vacaciones.notificaciones_push_config
  add column if not exists correo_function_url text;

comment on column vacaciones.notificaciones_push_config.correo_function_url is
  'URL de la Edge Function notificar-empleado (correo al empleado). Null = no se envian correos.';

-- ---------------------------------------------------------------------------
-- 2) Avisos dentro del sistema para el empleado
-- ---------------------------------------------------------------------------
create table if not exists vacaciones.avisos_empleado (
  id uuid primary key default gen_random_uuid(),
  empleado_id uuid not null
    references vacaciones.empleados(id) on delete cascade,
  solicitud_ausencia_id uuid
    references vacaciones.solicitudes_ausencia(id) on delete cascade,
  tipo text not null
    check (tipo in ('solicitud_creada', 'avance_etapa', 'aprobada', 'rechazada')),
  titulo text not null,
  mensaje text,
  leido_en timestamptz,
  creado_en timestamptz not null default now()
);

comment on table vacaciones.avisos_empleado is
  'Avisos dentro del sistema para el empleado que solicito. Los escriben los disparadores del flujo; el empleado solo puede marcarlos como leidos.';

create index if not exists avisos_empleado_empleado_idx
  on vacaciones.avisos_empleado (empleado_id, creado_en desc);

alter table vacaciones.avisos_empleado enable row level security;
revoke all on vacaciones.avisos_empleado from public, anon, authenticated;
grant select on vacaciones.avisos_empleado to authenticated;
grant update (leido_en) on vacaciones.avisos_empleado to authenticated;
grant all on vacaciones.avisos_empleado to service_role;

drop policy if exists lectura_avisos_propios on vacaciones.avisos_empleado;
create policy lectura_avisos_propios
  on vacaciones.avisos_empleado
  for select to authenticated
  using (empleado_id = vacaciones.empleado_actual_id() or vacaciones.es_administrador());

drop policy if exists marcar_avisos_propios on vacaciones.avisos_empleado;
create policy marcar_avisos_propios
  on vacaciones.avisos_empleado
  for update to authenticated
  using (empleado_id = vacaciones.empleado_actual_id())
  with check (empleado_id = vacaciones.empleado_actual_id());

-- ---------------------------------------------------------------------------
-- 3) Motivo obligatorio al rechazar
-- ---------------------------------------------------------------------------
create or replace function vacaciones.exigir_motivo_rechazo()
returns trigger
language plpgsql
as $$
begin
  if new.decision = 'rechazado' and coalesce(btrim(new.comentario), '') = '' then
    raise exception 'Para rechazar una solicitud es obligatorio indicar el motivo.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_exigir_motivo_rechazo on vacaciones.revisiones_solicitud;
create trigger trg_exigir_motivo_rechazo
  before insert on vacaciones.revisiones_solicitud
  for each row execute function vacaciones.exigir_motivo_rechazo();

-- ---------------------------------------------------------------------------
-- 4) Correo al empleado (Edge Function notificar-empleado)
-- ---------------------------------------------------------------------------

-- Arma el payload con todos los datos y lo envia. Nunca lanza error: una falla
-- del correo no debe impedir crear o revisar una solicitud. pg_net es
-- transaccional: si la operacion original se revierte, el envio tambien.
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
    'revision', case when r.id is null then null else jsonb_build_object(
      'etapa', r.etapa,
      'decision', r.decision,
      'comentario', r.comentario
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

-- ---------------------------------------------------------------------------
-- 5) Disparador: solicitud creada -> aviso en sistema + correo de acuse
-- ---------------------------------------------------------------------------
create or replace function vacaciones.avisar_solicitud_creada()
returns trigger
language plpgsql
security definer
set search_path = vacaciones, public
as $$
begin
  -- Mismo criterio que 008: las importaciones CSV/integraciones no avisan.
  if new.estado <> 'pendiente'
     or new.eliminado_en is not null
     or new.origen not in ('empleado', 'administrador', 'formulario') then
    return new;
  end if;

  insert into vacaciones.avisos_empleado (empleado_id, solicitud_ausencia_id, tipo, titulo, mensaje)
  values (
    new.empleado_id, new.id, 'solicitud_creada',
    'Tu solicitud de vacaciones fue registrada',
    format('Del %s al %s. Está en revisión por RRHH; después pasará a tu jefe inmediato y a Mesa Directiva.',
      to_char(new.fecha_inicio, 'DD/MM/YYYY'), to_char(new.fecha_fin, 'DD/MM/YYYY'))
  );

  perform vacaciones.enviar_correo_empleado('solicitud_creada', new.id);
  return new;
exception when others then
  raise warning 'avisar_solicitud_creada(%): %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_avisar_solicitud_creada on vacaciones.solicitudes_ausencia;
create trigger trg_avisar_solicitud_creada
  after insert on vacaciones.solicitudes_ausencia
  for each row execute function vacaciones.avisar_solicitud_creada();

-- ---------------------------------------------------------------------------
-- 6) Disparador: decision de una etapa -> aviso en sistema (+ correo al final)
-- ---------------------------------------------------------------------------
create or replace function vacaciones.avisar_revision()
returns trigger
language plpgsql
security definer
set search_path = vacaciones, public
as $$
declare
  v_empleado_id uuid;
  v_evento text;
  v_titulo text;
  v_mensaje text;
  v_quien text;
begin
  select empleado_id into v_empleado_id
  from vacaciones.solicitudes_ausencia
  where id = new.solicitud_ausencia_id;

  v_quien := case new.etapa
    when 'rrhh' then 'RRHH'
    when 'jefe_inmediato' then 'tu jefe inmediato'
    else 'Mesa Directiva'
  end;

  -- revisar_solicitud guarda en estado_resultante la etapa siguiente
  -- (jefe_inmediato, mesa_directiva, aprobada o rechazada).
  if new.estado_resultante = 'rechazada' then
    v_evento := 'rechazada';
    v_titulo := 'Tu solicitud de vacaciones no fue aprobada';
    v_mensaje := format('Fue rechazada por %s. Motivo: %s. Te invitamos a reagendar tus vacaciones.',
      v_quien, new.comentario);
  elsif new.estado_resultante = 'aprobada' then
    v_evento := 'aprobada';
    v_titulo := 'Tu solicitud de vacaciones fue aprobada';
    v_mensaje := 'Mesa Directiva dio la aprobación final. ¡Disfruta tus vacaciones!';
  else
    v_evento := 'avance_etapa';
    v_titulo := format('Tu solicitud avanzó: aprobada por %s', v_quien);
    v_mensaje := format('Ahora está en revisión por %s.',
      case new.estado_resultante when 'jefe_inmediato' then 'tu jefe inmediato' else 'Mesa Directiva' end);
  end if;

  insert into vacaciones.avisos_empleado (empleado_id, solicitud_ausencia_id, tipo, titulo, mensaje)
  values (v_empleado_id, new.solicitud_ausencia_id, v_evento, v_titulo, v_mensaje);

  -- Correo solo con la resolucion final; los avances quedan en el sistema.
  if v_evento in ('aprobada', 'rechazada') then
    perform vacaciones.enviar_correo_empleado(v_evento, new.solicitud_ausencia_id, new.id);
  end if;

  return new;
exception when others then
  raise warning 'avisar_revision(%): %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_avisar_revision on vacaciones.revisiones_solicitud;
create trigger trg_avisar_revision
  after insert on vacaciones.revisiones_solicitud
  for each row execute function vacaciones.avisar_revision();

-- ---------------------------------------------------------------------------
-- 7) Recordatorios al grupo (via la bitacora de 008)
-- ---------------------------------------------------------------------------

-- Momento en que la solicitud entro a su etapa actual: la ultima decision
-- registrada o, si sigue en RRHH, cuando se solicito.
create or replace function vacaciones.en_etapa_desde(p_solicitud_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = vacaciones, public
as $$
  select coalesce(
    (select max(r.creado_en) from vacaciones.revisiones_solicitud r
      where r.solicitud_ausencia_id = s.id),
    s.solicitado_en,
    s.creado_en
  )
  from vacaciones.solicitudes_ausencia s
  where s.id = p_solicitud_id;
$$;

-- Devuelve cuantos recordatorios genero. El mensaje usa el formato
-- "Clave: valor | Clave: valor" que entiende la Edge Function "notificar".
create or replace function vacaciones.enviar_recordatorios_pendientes()
returns integer
language plpgsql
security definer
set search_path = vacaciones, public
as $$
declare
  r record;
  v_enviados integer := 0;
  v_pendiente_de text;
begin
  for r in
    select
      s.id,
      s.etapa_aprobacion,
      s.fecha_inicio,
      s.fecha_fin,
      e.nombre_completo as empleado,
      j.nombre_completo as jefe,
      t.nombre as tipo_ausencia,
      floor(extract(epoch from now() - vacaciones.en_etapa_desde(s.id)) / 86400)::integer as dias_espera
    from vacaciones.solicitudes_ausencia s
    join vacaciones.empleados e on e.id = s.empleado_id
    left join vacaciones.empleados j on j.id = e.jefe_inmediato_id
    left join vacaciones.tipos_ausencia t on t.id = s.tipo_ausencia_id
    where s.estado = 'pendiente'
      and s.etapa_aprobacion in ('rrhh', 'jefe_inmediato', 'mesa_directiva')
      and s.eliminado_en is null
      and vacaciones.en_etapa_desde(s.id) < now() - interval '2 days'
      and not exists (
        select 1 from vacaciones.notificaciones n
        where n.solicitud_ausencia_id = s.id
          and n.tipo = 'recordatorio'
          and n.creado_en > now() - interval '20 hours'
      )
  loop
    v_pendiente_de := case r.etapa_aprobacion
      when 'rrhh' then 'RRHH'
      when 'jefe_inmediato' then coalesce(r.jefe || ' (jefe inmediato)', 'el jefe inmediato')
      else 'la mesa directiva'
    end;

    insert into vacaciones.notificaciones (tipo, titulo, mensaje, solicitud_ausencia_id)
    values (
      'recordatorio',
      '⏰ Recordatorio de aprobación',
      'Empleado: ' || coalesce(r.empleado, 'N/D')
        || ' | Tipo: ' || coalesce(r.tipo_ausencia, 'N/D')
        || ' | Del: ' || to_char(r.fecha_inicio, 'DD/MM/YYYY')
        || ' | Al: ' || to_char(r.fecha_fin, 'DD/MM/YYYY')
        || case when r.jefe is not null and r.etapa_aprobacion <> 'jefe_inmediato'
             then ' | Jefe inmediato: ' || r.jefe else '' end
        || ' | Pendiente de: ' || v_pendiente_de
        || ' | Días en espera: ' || r.dias_espera,
      r.id
    );
    v_enviados := v_enviados + 1;
  end loop;

  return v_enviados;
end;
$$;

-- Ninguna de estas funciones debe poder llamarse via la Data API.
revoke execute on function vacaciones.enviar_correo_empleado(text, uuid, uuid) from public, anon, authenticated;
revoke execute on function vacaciones.enviar_recordatorios_pendientes() from public, anon, authenticated;
revoke execute on function vacaciones.en_etapa_desde(uuid) from public, anon, authenticated;

commit;

-- Lunes a viernes a las 9:00 hora del centro de Mexico (15:00 UTC).
select cron.unschedule('recordatorios-vacaciones')
where exists (select 1 from cron.job where jobname = 'recordatorios-vacaciones');

select cron.schedule(
  'recordatorios-vacaciones',
  '0 15 * * 1-5',
  $$select vacaciones.enviar_recordatorios_pendientes()$$
);

-- ---------------------------------------------------------------------------
-- DESPUES de ejecutar esto (en el SQL Editor), activar el correo:
--   update vacaciones.notificaciones_push_config
--   set correo_function_url = 'https://<PROJECT_REF>.supabase.co/functions/v1/notificar-empleado';
--
-- Probar los recordatorios sin esperar al cron:
--   select vacaciones.enviar_recordatorios_pendientes();
--
-- Ver las ultimas llamadas a las Edge Functions y su respuesta:
--   select id, status_code, content, created from net._http_response order by created desc limit 20;
