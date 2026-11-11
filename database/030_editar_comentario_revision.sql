-- Corrección del comentario de una revisión (RRHH, Jefe inmediato o Mesa
-- Directiva), solo para administradores activos. Ejecutar después de 029
-- (requiere el historial de 026).
--
-- revisiones_solicitud sigue sin permisos de escritura para "authenticated":
-- el único camino es esta función. Cambia solo el comentario; la decisión, la
-- etapa y el estado de la solicitud no se tocan, y no se reenvían avisos.
-- El disparador de 026 registra el antes y el después; aquí se reetiqueta ese
-- evento como «edicion_comentario» con el motivo del administrador, para que no
-- aparezca como una aprobación o un rechazo nuevos.
begin;

create or replace function vacaciones.editar_comentario_revision(
  p_revision_id uuid,
  p_comentario text,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, vacaciones, auth
as $$
declare
  v_revision vacaciones.revisiones_solicitud%rowtype;
  v_comentario text := nullif(btrim(coalesce(p_comentario, '')), '');
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if not vacaciones.es_administrador() then
    raise exception 'Solo un administrador puede editar comentarios de revisión.'
      using errcode = '42501';
  end if;
  if v_motivo is null then
    raise exception 'Indica el motivo del cambio.' using errcode = '22023';
  end if;

  select * into v_revision
  from vacaciones.revisiones_solicitud
  where id = p_revision_id
  for update;
  if not found then
    raise exception 'La revisión no existe.' using errcode = 'P0002';
  end if;
  if v_revision.decision = 'rechazado' and v_comentario is null then
    raise exception 'Un rechazo debe conservar su motivo: corrige el texto en lugar de quitarlo.'
      using errcode = '22023';
  end if;
  if v_revision.comentario is not distinct from v_comentario then
    raise exception 'El comentario no cambió.' using errcode = '22023';
  end if;

  update vacaciones.revisiones_solicitud
  set comentario = v_comentario
  where id = p_revision_id;

  update vacaciones.historial_actividad
  set accion = 'edicion_comentario', motivo = v_motivo,
      nuevos = nuevos || jsonb_build_object('etapa', v_revision.etapa)
  where entidad = 'revisiones_solicitud'
    and registro_id = p_revision_id::text
    and transaccion = txid_current();
end;
$$;

revoke all on function vacaciones.editar_comentario_revision(uuid, text, text) from public, anon;
grant execute on function vacaciones.editar_comentario_revision(uuid, text, text) to authenticated;

commit;
