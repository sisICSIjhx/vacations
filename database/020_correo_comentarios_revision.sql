-- 020_correo_comentarios_revision.sql
-- El correo al empleado incluye los mismos comentarios que llegan al grupo de
-- WhatsApp (008/015):
--   solicitud_creada  los comentarios que escribio al registrar la solicitud
--   aprobada/rechazada  quien reviso en cada etapa (RRHH, Jefe inmediato,
--                       Mesa Directiva) y su comentario
--
-- El empleado solo recibe correo con el acuse y con la resolucion final, asi
-- que en la resolucion van los comentarios de TODAS las etapas del ciclo
-- actual (despues del ultimo rechazo anterior, por si la solicitud se reabrio).
--
-- Agrega al payload de vacaciones.enviar_correo_empleado() los campos
-- "comentarios" y "revisiones"; "revision" se conserva igual.
-- Requiere volver a desplegar la Edge Function "notificar-empleado".
-- Ejecutar despues de 019. Seguro de re-ejecutar.

begin;

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
    ), '[]'::jsonb) end
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

commit;
