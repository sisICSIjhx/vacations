-- 017_solicitudes_edicion.sql
-- Flujo para corregir una solicitud de vacaciones ya registrada:
--
--   1) El empleado (o el administrador en su nombre) registra una SOLICITUD
--      DE EDICION: el periodo que quiere y el motivo. Se avisa al grupo de
--      WhatsApp.
--   2) El administrador la atiende:
--        * la APLICA: puede ajustar las fechas propuestas (por si el empleado
--          tambien se equivoco) y debe escribir el motivo de la edicion. Se
--          avisa por WhatsApp y por correo al empleado;
--        * o la RECHAZA con un motivo (WhatsApp y correo).
--   3) Nadie edita una solicitud de otra forma: guardar_solicitud_vacaciones
--      ya solo crea.
--
-- vacaciones.solicitudes_edicion es a la vez la solicitud y la bitacora: quien
-- la pidio y por que, quien la resolvio y por que, y el periodo antes/despues.
--
-- Si la solicitud ya estaba APROBADA y descuenta saldo, al aplicar se
-- devuelven los dias del periodo anterior y se descuentan los del nuevo; si no
-- alcanza, no se guarda nada. La solicitud conserva su etapa.
--
-- Requiere volver a desplegar las Edge Functions "notificar" y
-- "notificar-empleado". Ejecutar despues de 016. Seguro de re-ejecutar.

begin;

-- ---------------------------------------------------------------------------
-- 1) Tabla: solicitudes de edicion + bitacora
-- ---------------------------------------------------------------------------
create table if not exists vacaciones.solicitudes_edicion (
  id uuid primary key default gen_random_uuid(),
  solicitud_ausencia_id uuid not null
    references vacaciones.solicitudes_ausencia(id) on delete cascade,
  empleado_id uuid not null
    references vacaciones.empleados(id) on delete cascade,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'aplicada', 'rechazada')),
  -- Lo que pide el empleado
  motivo text not null check (btrim(motivo) <> ''),
  fecha_inicio_propuesta date not null,
  fecha_fin_propuesta date not null,
  fecha_reintegro_propuesta date,
  solicitado_por uuid,
  solicitado_por_nombre text,
  solicitado_en timestamptz not null default now(),
  -- Resolucion del administrador
  respuesta text,
  resuelto_por uuid,
  resuelto_por_nombre text,
  resuelto_en timestamptz,
  -- Periodo antes y despues de aplicar: {fecha_inicio, fecha_fin, fecha_reintegro, dias}
  valores_anteriores jsonb,
  valores_nuevos jsonb,
  check (fecha_fin_propuesta >= fecha_inicio_propuesta)
);

comment on table vacaciones.solicitudes_edicion is
  'Solicitudes de edicion de una solicitud de vacaciones y su bitacora (quien, por que, antes/despues). Se escriben solo por RPC.';

-- Una sola solicitud de edicion abierta por solicitud de vacaciones.
create unique index if not exists solicitudes_edicion_pendiente_unica_idx
  on vacaciones.solicitudes_edicion (solicitud_ausencia_id)
  where estado = 'pendiente';

create index if not exists solicitudes_edicion_solicitud_idx
  on vacaciones.solicitudes_edicion (solicitud_ausencia_id, solicitado_en desc);

alter table vacaciones.solicitudes_edicion enable row level security;
revoke all on vacaciones.solicitudes_edicion from public, anon, authenticated;
grant select on vacaciones.solicitudes_edicion to authenticated;
grant all on vacaciones.solicitudes_edicion to service_role;

-- Quien puede ver la solicitud de vacaciones (RLS de solicitudes_ausencia)
-- puede ver sus solicitudes de edicion.
drop policy if exists lectura_solicitudes_edicion on vacaciones.solicitudes_edicion;
create policy lectura_solicitudes_edicion
  on vacaciones.solicitudes_edicion
  for select to authenticated
  using (exists (
    select 1 from vacaciones.solicitudes_ausencia s
    where s.id = solicitudes_edicion.solicitud_ausencia_id
  ));

-- ---------------------------------------------------------------------------
-- 2) Utilidades
-- ---------------------------------------------------------------------------
-- ' | ' separa campos en la bitacora de WhatsApp: se escapa y se aplanan los
-- saltos de linea (mismo criterio que 015).
create or replace function vacaciones.texto_bitacora(p_texto text)
returns text
language sql
immutable
as $$
  select regexp_replace(replace(btrim(coalesce(p_texto, '')), ' | ', ' / '), '\s*\n\s*', ' ', 'g');
$$;

create or replace function vacaciones.nombre_usuario_actual()
returns text
language sql
stable
security definer
set search_path = vacaciones, auth, public
as $$
  select nullif(btrim(p.nombre_visible), '')
  from vacaciones.perfiles_usuario p
  where p.usuario_id = auth.uid();
$$;

-- Periodo actual de la solicitud con sus dias, para la bitacora.
create or replace function vacaciones.periodo_solicitud(p_solicitud_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = vacaciones, public
as $$
  select jsonb_build_object(
    'fecha_inicio', s.fecha_inicio,
    'fecha_fin', s.fecha_fin,
    'fecha_reintegro', s.fecha_reintegro,
    'dias', (
      select coalesce(sum(d.dias_descontados), 0)
      from vacaciones.v_dias_solicitud_calendario d
      where d.solicitud_ausencia_id = s.id
    )
  )
  from vacaciones.solicitudes_ausencia s
  where s.id = p_solicitud_id;
$$;

-- ---------------------------------------------------------------------------
-- 3) Avisos: WhatsApp (bitacora de 008) y correo al empleado (010)
-- ---------------------------------------------------------------------------
create or replace function vacaciones.notificar_edicion(p_edicion_id uuid)
returns void
language plpgsql
security definer
set search_path = vacaciones, public
as $$
declare
  ed vacaciones.solicitudes_edicion%rowtype;
  v_empleado text;
  v_ausencia text;
  v_actual jsonb;
  v_mensaje text;
  v_tipo text;
  v_titulo text;
  fecha text := 'DD/MM/YYYY';
begin
  select * into ed from vacaciones.solicitudes_edicion where id = p_edicion_id;
  if not found then
    return;
  end if;

  select e.nombre_completo, t.nombre
    into v_empleado, v_ausencia
  from vacaciones.solicitudes_ausencia s
  join vacaciones.empleados e on e.id = s.empleado_id
  left join vacaciones.tipos_ausencia t on t.id = s.tipo_ausencia_id
  where s.id = ed.solicitud_ausencia_id;

  v_actual := vacaciones.periodo_solicitud(ed.solicitud_ausencia_id);

  v_mensaje := 'Empleado: ' || coalesce(v_empleado, 'N/D')
    || ' | Tipo: ' || coalesce(v_ausencia, 'N/D')
    || ' | Del: ' || to_char((v_actual ->> 'fecha_inicio')::date, fecha)
    || ' | Al: ' || to_char((v_actual ->> 'fecha_fin')::date, fecha)
    || ' | Días: ' || trim_scale((v_actual ->> 'dias')::numeric)::text;

  case ed.estado
    when 'pendiente' then
      v_tipo := 'edicion_solicitada';
      v_titulo := '✏️ Solicitud de edición';
      v_mensaje := v_mensaje
        || ' | Nuevo del: ' || to_char(ed.fecha_inicio_propuesta, fecha)
        || ' | Nuevo al: ' || to_char(ed.fecha_fin_propuesta, fecha)
        || ' | Motivo: ' || vacaciones.texto_bitacora(ed.motivo)
        || coalesce(' | Registró: ' || ed.solicitado_por_nombre, '');
    when 'aplicada' then
      v_tipo := 'edicion_aplicada';
      v_titulo := '✏️ Edición aplicada';
      v_mensaje := v_mensaje
        || ' | Antes del: ' || to_char((ed.valores_anteriores ->> 'fecha_inicio')::date, fecha)
        || ' | Antes al: ' || to_char((ed.valores_anteriores ->> 'fecha_fin')::date, fecha)
        || ' | Días antes: ' || trim_scale((ed.valores_anteriores ->> 'dias')::numeric)::text
        || ' | Motivo: ' || vacaciones.texto_bitacora(ed.motivo)
        || coalesce(' | Editó: ' || ed.resuelto_por_nombre, '')
        || ' | Nota: ' || vacaciones.texto_bitacora(ed.respuesta);
    else
      v_tipo := 'edicion_rechazada';
      v_titulo := '✏️ Edición rechazada';
      v_mensaje := v_mensaje
        || ' | Nuevo del: ' || to_char(ed.fecha_inicio_propuesta, fecha)
        || ' | Nuevo al: ' || to_char(ed.fecha_fin_propuesta, fecha)
        || ' | Motivo: ' || vacaciones.texto_bitacora(ed.motivo)
        || coalesce(' | Revisó: ' || ed.resuelto_por_nombre, '')
        || ' | Nota: ' || vacaciones.texto_bitacora(ed.respuesta);
  end case;

  insert into vacaciones.notificaciones (tipo, titulo, mensaje, solicitud_ausencia_id)
  values (v_tipo, v_titulo, v_mensaje, ed.solicitud_ausencia_id);
exception when others then
  raise warning 'notificar_edicion(%): %', p_edicion_id, sqlerrm;  -- el aviso nunca bloquea
end;
$$;

-- Mismo payload que enviar_correo_empleado (010) mas el bloque "edicion".
create or replace function vacaciones.enviar_correo_edicion(p_edicion_id uuid)
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
    'evento', 'edicion_' || ed.estado,
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
    'revision', null,
    'edicion', jsonb_build_object(
      'motivo', ed.motivo,
      'respuesta', ed.respuesta,
      'resuelto_por', ed.resuelto_por_nombre,
      'anterior', ed.valores_anteriores,
      'propuesta', jsonb_build_object(
        'fecha_inicio', ed.fecha_inicio_propuesta,
        'fecha_fin', ed.fecha_fin_propuesta,
        'fecha_reintegro', ed.fecha_reintegro_propuesta
      )
    )
  )
  into v_payload
  from vacaciones.solicitudes_edicion ed
  join vacaciones.solicitudes_ausencia s on s.id = ed.solicitud_ausencia_id
  join vacaciones.empleados e on e.id = s.empleado_id
  left join vacaciones.tipos_ausencia t on t.id = s.tipo_ausencia_id
  where ed.id = p_edicion_id
    and ed.estado in ('aplicada', 'rechazada');

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
  raise warning 'enviar_correo_edicion(%): %', p_edicion_id, sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) guardar_solicitud_vacaciones: ya solo crea
-- ---------------------------------------------------------------------------
create or replace function vacaciones.guardar_solicitud_vacaciones(
  p_empleado_id uuid,
  p_tipo_ausencia_id uuid,
  p_fecha_inicio date,
  p_fecha_fin date,
  p_fecha_reintegro date default null,
  p_comentarios text default null,
  p_solicitud_id uuid default null
)
returns vacaciones.solicitudes_ausencia
language plpgsql
security definer
set search_path = vacaciones, auth, public
as $$
declare
  v_organizacion_id uuid;
  v_origen text;
  v_es_admin boolean;
  resultado vacaciones.solicitudes_ausencia%rowtype;
  uso record;
begin
  -- "security definer": la autorizacion se valida aqui explicitamente.
  v_es_admin := vacaciones.es_administrador();
  if not (v_es_admin or p_empleado_id = vacaciones.empleado_actual_id()) then
    raise exception 'No tiene autorizacion para crear una solicitud de este empleado.';
  end if;

  -- Las correcciones pasan por solicitar_edicion_solicitud (017).
  if p_solicitud_id is not null then
    raise exception 'Para modificar una solicitud registra una solicitud de edicion; el administrador la revisa y la aplica.';
  end if;

  if p_fecha_fin < p_fecha_inicio then
    raise exception 'La fecha final no puede ser anterior a la fecha de inicio.';
  end if;

  select organizacion_id into v_organizacion_id
  from vacaciones.empleados
  where id = p_empleado_id and eliminado_en is null;

  if v_organizacion_id is null then
    raise exception 'Empleado no encontrado.';
  end if;

  v_origen := case when v_es_admin then 'administrador' else 'empleado' end;

  insert into vacaciones.solicitudes_ausencia (
    organizacion_id, empleado_id, tipo_ausencia_id, estado, etapa_aprobacion,
    fecha_inicio, fecha_fin, fecha_reintegro, comentarios, origen, solicitado_en
  ) values (
    v_organizacion_id, p_empleado_id, p_tipo_ausencia_id, 'pendiente', 'rrhh',
    p_fecha_inicio, p_fecha_fin, p_fecha_reintegro, p_comentarios, v_origen, now()
  )
  returning * into resultado;

  for uso in
    select
      extract(year from fecha_calendario)::integer as anio,
      sum(dias_descontados)::numeric(8,2) as dias
    from vacaciones.v_dias_solicitud_calendario
    where solicitud_ausencia_id = resultado.id
    group by extract(year from fecha_calendario)::integer
  loop
    if resultado.descuenta_saldo and uso.dias > 0 and not exists (
      select 1 from vacaciones.asignaciones_ausencia a
      where a.empleado_id = resultado.empleado_id
        and a.tipo_ausencia_id = resultado.tipo_ausencia_id
        and a.anio_asignacion = uso.anio
        and a.eliminado_en is null
        and a.dias_disponibles >= uso.dias
    ) then
      raise exception
        'Saldo insuficiente para el ano %: la solicitud requiere % dia(s) disponibles.',
        uso.anio, uso.dias;
    end if;
  end loop;

  return resultado;
end;
$$;

grant execute on function vacaciones.guardar_solicitud_vacaciones(
  uuid, uuid, date, date, date, text, uuid
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) RPC: el empleado (o el administrador en su nombre) pide la edicion
-- ---------------------------------------------------------------------------
create or replace function vacaciones.solicitar_edicion_solicitud(
  p_solicitud_id uuid,
  p_motivo text,
  p_fecha_inicio date,
  p_fecha_fin date,
  p_fecha_reintegro date default null
)
returns vacaciones.solicitudes_edicion
language plpgsql
security definer
set search_path = vacaciones, auth, public
as $$
declare
  solicitud vacaciones.solicitudes_ausencia%rowtype;
  resultado vacaciones.solicitudes_edicion%rowtype;
begin
  select * into solicitud
  from vacaciones.solicitudes_ausencia
  where id = p_solicitud_id and eliminado_en is null
  for update;

  if not found then
    raise exception 'La solicitud no existe.';
  end if;

  if not (vacaciones.es_administrador() or solicitud.empleado_id = vacaciones.empleado_actual_id()) then
    raise exception 'Solo puedes pedir la edicion de tus propias solicitudes.';
  end if;

  if solicitud.estado not in ('planeada', 'pendiente', 'aprobada') then
    raise exception 'Una solicitud % no puede editarse.', solicitud.estado;
  end if;

  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Indica el motivo de la edicion.';
  end if;

  if p_fecha_inicio is null or p_fecha_fin is null or p_fecha_fin < p_fecha_inicio then
    raise exception 'Revisa las fechas: la fecha final no puede ser anterior a la de inicio.';
  end if;

  if p_fecha_reintegro is not null and p_fecha_reintegro < p_fecha_fin then
    raise exception 'La fecha de reintegro no puede ser anterior a la fecha final.';
  end if;

  if exists (
    select 1 from vacaciones.solicitudes_edicion
    where solicitud_ausencia_id = p_solicitud_id and estado = 'pendiente'
  ) then
    raise exception 'Esta solicitud ya tiene una edicion pendiente de revisar por el administrador.';
  end if;

  insert into vacaciones.solicitudes_edicion (
    solicitud_ausencia_id, empleado_id, motivo,
    fecha_inicio_propuesta, fecha_fin_propuesta, fecha_reintegro_propuesta,
    solicitado_por, solicitado_por_nombre
  ) values (
    p_solicitud_id, solicitud.empleado_id, btrim(p_motivo),
    p_fecha_inicio, p_fecha_fin, p_fecha_reintegro,
    auth.uid(), vacaciones.nombre_usuario_actual()
  )
  returning * into resultado;

  perform vacaciones.notificar_edicion(resultado.id);
  return resultado;
end;
$$;

grant execute on function vacaciones.solicitar_edicion_solicitud(uuid, text, date, date, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) RPC: el administrador aplica la edicion (con los valores que el decida)
-- ---------------------------------------------------------------------------
create or replace function vacaciones.aplicar_edicion_solicitud(
  p_edicion_id uuid,
  p_fecha_inicio date,
  p_fecha_fin date,
  p_fecha_reintegro date,
  p_comentarios text,
  p_motivo text
)
returns vacaciones.solicitudes_edicion
language plpgsql
security definer
set search_path = vacaciones, auth, public
as $$
declare
  ed vacaciones.solicitudes_edicion%rowtype;
  anterior vacaciones.solicitudes_ausencia%rowtype;
  actual vacaciones.solicitudes_ausencia%rowtype;
  v_antes jsonb;
  v_ajusta_saldo boolean;
  uso record;
begin
  if not vacaciones.es_administrador() then
    raise exception 'Solo el administrador puede aplicar ediciones.';
  end if;

  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Indica el motivo de la edicion; se envia al empleado.';
  end if;

  if p_fecha_inicio is null or p_fecha_fin is null or p_fecha_fin < p_fecha_inicio then
    raise exception 'La fecha final no puede ser anterior a la fecha de inicio.';
  end if;

  if p_fecha_reintegro is not null and p_fecha_reintegro < p_fecha_fin then
    raise exception 'La fecha de reintegro no puede ser anterior a la fecha final.';
  end if;

  select * into ed
  from vacaciones.solicitudes_edicion
  where id = p_edicion_id
  for update;

  if not found or ed.estado <> 'pendiente' then
    raise exception 'La solicitud de edicion no existe o ya fue atendida.';
  end if;

  select * into anterior
  from vacaciones.solicitudes_ausencia
  where id = ed.solicitud_ausencia_id and eliminado_en is null
  for update;

  if not found then
    raise exception 'La solicitud de vacaciones ya no existe.';
  end if;

  v_antes := vacaciones.periodo_solicitud(anterior.id);

  -- Aprobada: su saldo ya se desconto. Se devuelve el periodo anterior y,
  -- tras actualizar, se descuenta el nuevo.
  v_ajusta_saldo := anterior.estado = 'aprobada' and anterior.descuenta_saldo;
  if v_ajusta_saldo then
    for uso in
      select
        extract(year from fecha_calendario)::integer as anio,
        sum(dias_descontados)::numeric(8,2) as dias
      from vacaciones.v_dias_solicitud_calendario
      where solicitud_ausencia_id = anterior.id
      group by extract(year from fecha_calendario)::integer
    loop
      update vacaciones.asignaciones_ausencia
      set dias_disponibles = dias_disponibles + uso.dias,
          fecha_corte_saldo = current_date
      where empleado_id = anterior.empleado_id
        and tipo_ausencia_id = anterior.tipo_ausencia_id
        and anio_asignacion = uso.anio
        and eliminado_en is null;

      if not found then
        raise exception 'Asignacion inexistente para el ano %.', uso.anio;
      end if;
    end loop;
  end if;

  update vacaciones.solicitudes_ausencia
  set fecha_inicio = p_fecha_inicio,
      fecha_fin = p_fecha_fin,
      fecha_reintegro = p_fecha_reintegro,
      comentarios = p_comentarios
  where id = anterior.id
  returning * into actual;

  for uso in
    select
      extract(year from fecha_calendario)::integer as anio,
      sum(dias_descontados)::numeric(8,2) as dias
    from vacaciones.v_dias_solicitud_calendario
    where solicitud_ausencia_id = actual.id
    group by extract(year from fecha_calendario)::integer
  loop
    if v_ajusta_saldo then
      update vacaciones.asignaciones_ausencia
      set dias_disponibles = dias_disponibles - uso.dias,
          fecha_corte_saldo = current_date
      where empleado_id = actual.empleado_id
        and tipo_ausencia_id = actual.tipo_ausencia_id
        and anio_asignacion = uso.anio
        and eliminado_en is null
        and dias_disponibles >= uso.dias;

      if not found then
        raise exception
          'Saldo insuficiente para el ano %: el nuevo periodo requiere % dia(s) disponibles.',
          uso.anio, uso.dias;
      end if;
    elsif actual.descuenta_saldo
      and actual.estado in ('planeada', 'pendiente')
      and uso.dias > 0
      and not exists (
        select 1 from vacaciones.asignaciones_ausencia a
        where a.empleado_id = actual.empleado_id
          and a.tipo_ausencia_id = actual.tipo_ausencia_id
          and a.anio_asignacion = uso.anio
          and a.eliminado_en is null
          and a.dias_disponibles >= uso.dias
      ) then
      raise exception
        'Saldo insuficiente para el ano %: el nuevo periodo requiere % dia(s) disponibles.',
        uso.anio, uso.dias;
    end if;
  end loop;

  update vacaciones.solicitudes_edicion
  set estado = 'aplicada',
      respuesta = btrim(p_motivo),
      resuelto_por = auth.uid(),
      resuelto_por_nombre = vacaciones.nombre_usuario_actual(),
      resuelto_en = now(),
      valores_anteriores = v_antes,
      valores_nuevos = vacaciones.periodo_solicitud(actual.id)
  where id = ed.id
  returning * into ed;

  perform vacaciones.notificar_edicion(ed.id);
  perform vacaciones.enviar_correo_edicion(ed.id);
  return ed;
end;
$$;

grant execute on function vacaciones.aplicar_edicion_solicitud(uuid, date, date, date, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) RPC: el administrador rechaza la edicion
-- ---------------------------------------------------------------------------
create or replace function vacaciones.rechazar_edicion_solicitud(
  p_edicion_id uuid,
  p_motivo text
)
returns vacaciones.solicitudes_edicion
language plpgsql
security definer
set search_path = vacaciones, auth, public
as $$
declare
  ed vacaciones.solicitudes_edicion%rowtype;
begin
  if not vacaciones.es_administrador() then
    raise exception 'Solo el administrador puede rechazar ediciones.';
  end if;

  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Indica el motivo del rechazo; se envia al empleado.';
  end if;

  update vacaciones.solicitudes_edicion
  set estado = 'rechazada',
      respuesta = btrim(p_motivo),
      resuelto_por = auth.uid(),
      resuelto_por_nombre = vacaciones.nombre_usuario_actual(),
      resuelto_en = now(),
      valores_anteriores = vacaciones.periodo_solicitud(solicitud_ausencia_id)
  where id = p_edicion_id and estado = 'pendiente'
  returning * into ed;

  if not found then
    raise exception 'La solicitud de edicion no existe o ya fue atendida.';
  end if;

  perform vacaciones.notificar_edicion(ed.id);
  perform vacaciones.enviar_correo_edicion(ed.id);
  return ed;
end;
$$;

grant execute on function vacaciones.rechazar_edicion_solicitud(uuid, text)
  to authenticated, service_role;

revoke execute on function vacaciones.notificar_edicion(uuid) from public;
revoke execute on function vacaciones.enviar_correo_edicion(uuid) from public;

commit;

-- Bitacora de ediciones:
-- select e.nombre_completo, ed.estado, ed.motivo, ed.solicitado_por_nombre,
--        ed.respuesta, ed.resuelto_por_nombre, ed.valores_anteriores, ed.valores_nuevos
-- from vacaciones.solicitudes_edicion ed
-- join vacaciones.empleados e on e.id = ed.empleado_id
-- order by ed.solicitado_en desc;
