-- ICSI OIL & GAS - Sistema de vacaciones
-- Avisos de WhatsApp (Green API) por cambios en solicitudes de vacaciones.
-- Guia: GUIA_WHATSAPP_GREENAPI_SUPABASE.md. Aditivo y seguro de re-ejecutar.
--
-- Flujo: trigger en solicitudes_ausencia -> INSERT en notificaciones ->
-- trigger -> pg_net -> Edge Function "notificar" -> Green API (grupo).
--
-- IMPORTANTE: NO escribas el secreto real en este archivo. Tras ejecutarlo,
-- actualiza la fila de configuracion desde el SQL Editor (ver el final).

begin;

create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- 0) Telefono de WhatsApp del empleado (10 digitos, MX) para taguear a jefes
-- ---------------------------------------------------------------------------
alter table vacaciones.empleados add column if not exists telefono_whatsapp varchar(10);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'empleados_telefono_whatsapp_chk') then
    alter table vacaciones.empleados
      add constraint empleados_telefono_whatsapp_chk
      check (telefono_whatsapp is null or telefono_whatsapp ~ '^[0-9]{10}$');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Bitacora de notificaciones
-- ---------------------------------------------------------------------------
create table if not exists vacaciones.notificaciones (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  titulo text not null,
  mensaje text,                     -- campos separados por ' | '
  solicitud_ausencia_id uuid references vacaciones.solicitudes_ausencia(id) on delete set null,
  creado_en timestamptz not null default now()
);

alter table vacaciones.notificaciones enable row level security;
revoke all on vacaciones.notificaciones from public;
grant select, insert on vacaciones.notificaciones to service_role;

-- ---------------------------------------------------------------------------
-- 2) Configuracion del webhook (fila unica, invisible para anon/authenticated)
-- ---------------------------------------------------------------------------
create table if not exists vacaciones.notificaciones_push_config (
  id boolean primary key default true check (id),
  habilitado boolean not null default true,
  edge_function_url text not null,
  webhook_secret text not null,
  actualizado_en timestamptz not null default now()
);

alter table vacaciones.notificaciones_push_config enable row level security;
revoke all on vacaciones.notificaciones_push_config from public;
grant all on vacaciones.notificaciones_push_config to service_role;

insert into vacaciones.notificaciones_push_config (id, habilitado, edge_function_url, webhook_secret)
values (
  true, false,
  'https://REEMPLAZAR_PROJECT_REF.supabase.co/functions/v1/notificar',
  'REEMPLAZAR_SECRETO'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3) Reenvio de cada notificacion a la Edge Function
-- ---------------------------------------------------------------------------
create or replace function vacaciones.enviar_notificacion_externa()
returns trigger
language plpgsql
security definer
set search_path = vacaciones, public
as $$
declare
  v_cfg vacaciones.notificaciones_push_config%rowtype;
begin
  select * into v_cfg from vacaciones.notificaciones_push_config where habilitado limit 1;
  if not found then
    return new;
  end if;

  perform net.http_post(
    url := v_cfg.edge_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_cfg.webhook_secret
    ),
    body := jsonb_build_object(
      'id', new.id,
      'tipo', new.tipo,
      'titulo', new.titulo,
      'mensaje', new.mensaje,
      'referencia_id', new.solicitud_ausencia_id,
      'created_at', new.creado_en
    )
  );
  return new;
exception when others then
  return new;  -- un fallo del aviso nunca debe romper la operacion original
end;
$$;

drop trigger if exists trg_enviar_notificacion_externa on vacaciones.notificaciones;
create trigger trg_enviar_notificacion_externa
after insert on vacaciones.notificaciones
for each row execute function vacaciones.enviar_notificacion_externa();

-- ---------------------------------------------------------------------------
-- 4) Emisor: cambios en solicitudes_ausencia
-- ---------------------------------------------------------------------------
create or replace function vacaciones.notificar_cambio_solicitud()
returns trigger
language plpgsql
security definer
set search_path = vacaciones, public
as $$
declare
  v_tipo text;
  v_titulo text;
  v_empleado text;
  v_ausencia text;
  v_jefe text;
  v_jefe_tel text;
  v_mensaje text;
begin
  if tg_op = 'INSERT' then
    -- Las importaciones CSV/integraciones no deben inundar el grupo.
    if new.estado <> 'pendiente' or new.origen not in ('empleado', 'administrador', 'formulario') then
      return new;
    end if;
    v_tipo := 'solicitud_nueva';
    v_titulo := '🏖️ Nueva solicitud de vacaciones';
  else
    if new.etapa_aprobacion is not distinct from old.etapa_aprobacion then
      return new;
    end if;
    case new.etapa_aprobacion
      when 'jefe_inmediato' then
        v_tipo := 'solicitud_jefe';
        v_titulo := '✅ RRHH aprobó · pasa a Jefe inmediato';
      when 'mesa_directiva' then
        v_tipo := 'solicitud_mesa';
        v_titulo := '✅ Jefe aprobó · pasa a Mesa directiva';
      when 'aprobada' then
        v_tipo := 'solicitud_aprobada';
        v_titulo := '🎉 Solicitud APROBADA';
      when 'rechazada' then
        v_tipo := 'solicitud_rechazada';
        v_titulo := '❌ Solicitud RECHAZADA';
      else
        return new;  -- p. ej. reapertura por administrador
    end case;
  end if;

  select e.nombre_completo, j.nombre_completo, j.telefono_whatsapp
    into v_empleado, v_jefe, v_jefe_tel
  from vacaciones.empleados e
  left join vacaciones.empleados j on j.id = e.jefe_inmediato_id
  where e.id = new.empleado_id;

  select nombre into v_ausencia from vacaciones.tipos_ausencia where id = new.tipo_ausencia_id;

  v_mensaje := 'Empleado: ' || coalesce(v_empleado, 'N/D')
    || ' | Tipo: ' || coalesce(v_ausencia, 'N/D')
    || ' | Del: ' || to_char(new.fecha_inicio, 'DD/MM/YYYY')
    || ' | Al: ' || to_char(new.fecha_fin, 'DD/MM/YYYY');

  if v_jefe is not null then
    v_mensaje := v_mensaje || ' | Jefe inmediato: ' || v_jefe;
  end if;
  -- Solo se usa para taguear al jefe en su etapa; la Edge Function no lo muestra
  if new.etapa_aprobacion = 'jefe_inmediato' and v_jefe_tel is not null then
    v_mensaje := v_mensaje || ' | Tel jefe: ' || v_jefe_tel;
  end if;
  if new.etapa_aprobacion = 'rechazada' and new.etapa_rechazo is not null then
    v_mensaje := v_mensaje || ' | Rechazó: ' || replace(new.etapa_rechazo, '_', ' ');
  end if;
  if tg_op = 'INSERT' and new.comentarios is not null and btrim(new.comentarios) <> '' then
    v_mensaje := v_mensaje || ' | Comentarios: ' || new.comentarios;
  end if;

  insert into vacaciones.notificaciones (tipo, titulo, mensaje, solicitud_ausencia_id)
  values (v_tipo, v_titulo, v_mensaje, new.id);

  return new;
exception when others then
  return new;  -- el aviso nunca debe bloquear la solicitud
end;
$$;

drop trigger if exists trg_notificar_cambio_solicitud on vacaciones.solicitudes_ausencia;
create trigger trg_notificar_cambio_solicitud
after insert or update of etapa_aprobacion on vacaciones.solicitudes_ausencia
for each row execute function vacaciones.notificar_cambio_solicitud();

commit;

-- ---------------------------------------------------------------------------
-- 5) DESPUES de ejecutar esto (en el SQL Editor, NO en git):
--   update vacaciones.notificaciones_push_config
--   set edge_function_url = 'https://<PROJECT_REF>.supabase.co/functions/v1/notificar',
--       webhook_secret = '<SECRETO_LARGO_ALEATORIO>',
--       habilitado = true;
-- Interruptor de emergencia:
--   update vacaciones.notificaciones_push_config set habilitado = false;
