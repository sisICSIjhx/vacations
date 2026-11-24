-- 032_eliminar_solicitud_no_aprobada.sql
-- Spec: openspec/changes/eliminar-solicitud-no-aprobada
--
-- El trabajador puede eliminar su propia solicitud de vacaciones mientras no
-- haya sido aprobada ('planeada' o 'pendiente', en cualquier etapa de
-- revision). Hasta ahora solo el administrador podia eliminar (DELETE directo
-- con borrado logico); el empleado no tiene policy de DELETE y asi se queda:
-- esta RPC "security definer" es su unico camino y valida ella misma permiso y
-- estado.
--
--   * Borrado logico (eliminado_en / eliminado_por / motivo_eliminacion), igual
--     que el DELETE del administrador: la solicitud deja de verse y de contar
--     como dias planeados o pendientes.
--   * No toca saldos: una solicitud sin aprobar nunca desconto dias. Las
--     aprobadas siguen la regla de 022 (eliminar conserva los dias; para
--     reintegrarlos, "Cancelar dias") y esta RPC las rechaza.
--   * Los disparadores existentes hacen el resto: 025 cierra la edicion
--     pendiente y 026 registra la eliminacion con su autor.
--   * Aviso al grupo de WhatsApp (bitacora de 008) para que quien tenia la
--     solicitud en revision sepa que se retiro. La Edge Function "notificar"
--     ya presenta tipos nuevos con su titulo y campos: no requiere despliegue.
--
-- Ejecutar despues de 031. Seguro de re-ejecutar.

begin;

create or replace function vacaciones.eliminar_solicitud_no_aprobada(
  p_solicitud_id uuid
)
returns vacaciones.solicitudes_ausencia
language plpgsql
security definer
set search_path = vacaciones, auth, public
as $$
declare
  solicitud vacaciones.solicitudes_ausencia%rowtype;
  resultado vacaciones.solicitudes_ausencia%rowtype;
  v_propia boolean;
  v_empleado text;
  v_dias numeric;
begin
  select * into solicitud
  from vacaciones.solicitudes_ausencia
  where id = p_solicitud_id and eliminado_en is null
  for update;

  if not found then
    raise exception 'La solicitud no existe o ya fue eliminada.';
  end if;

  -- "security definer": la autorizacion se valida aqui explicitamente.
  v_propia := coalesce(solicitud.empleado_id = vacaciones.empleado_actual_id(), false);
  if not (v_propia or vacaciones.es_administrador()) then
    raise exception 'Solo puedes eliminar tus propias solicitudes.';
  end if;

  if solicitud.estado not in ('planeada', 'pendiente') then
    raise exception
      'Solo se pueden eliminar solicitudes que aun no han sido aprobadas; esta se encuentra %.',
      solicitud.estado;
  end if;

  -- Antes del borrado: la vista de dias ya no muestra solicitudes eliminadas.
  begin
    select e.nombre_completo into v_empleado
    from vacaciones.empleados e
    where e.id = solicitud.empleado_id;

    select coalesce(sum(d.dias_descontados), 0) into v_dias
    from vacaciones.v_dias_solicitud_calendario d
    where d.solicitud_ausencia_id = solicitud.id;
  exception when others then
    raise warning 'eliminar_solicitud_no_aprobada(%): %', p_solicitud_id, sqlerrm;
  end;

  update vacaciones.solicitudes_ausencia
  set eliminado_en = now(),
      eliminado_por = auth.uid(),
      motivo_eliminacion = case
        when v_propia then 'Eliminada por el empleado antes de su aprobacion.'
        else 'Eliminada por el administrador antes de su aprobacion.'
      end
  where id = solicitud.id
  returning * into resultado;

  -- El aviso nunca bloquea la eliminacion.
  begin
    insert into vacaciones.notificaciones (tipo, titulo, mensaje, solicitud_ausencia_id)
    values (
      'solicitud_eliminada',
      '🗑️ Solicitud eliminada antes de su aprobación',
      'Empleado: ' || coalesce(v_empleado, 'N/D')
        || ' | Del: ' || to_char(solicitud.fecha_inicio, 'DD/MM/YYYY')
        || ' | Al: ' || to_char(solicitud.fecha_fin, 'DD/MM/YYYY')
        || coalesce(' | Días: ' || trim_scale(v_dias)::text, '')
        || ' | Estado: ' || solicitud.estado
        || coalesce(' | Eliminó: ' || vacaciones.nombre_usuario_actual(), ''),
      solicitud.id
    );
  exception when others then
    raise warning 'eliminar_solicitud_no_aprobada(%): %', p_solicitud_id, sqlerrm;
  end;

  return resultado;
end;
$$;

comment on function vacaciones.eliminar_solicitud_no_aprobada(uuid) is
  'Borrado logico de una solicitud planeada o pendiente por su propio empleado (o el administrador). No ajusta saldos: nunca se descontaron.';

revoke execute on function vacaciones.eliminar_solicitud_no_aprobada(uuid) from public, anon;
grant execute on function vacaciones.eliminar_solicitud_no_aprobada(uuid)
  to authenticated, service_role;

commit;

-- Comprobacion: solicitudes eliminadas por esta via.
-- select s.id, e.nombre_completo, s.fecha_inicio, s.fecha_fin, s.estado,
--        s.eliminado_en, s.motivo_eliminacion
-- from vacaciones.solicitudes_ausencia s
-- join vacaciones.empleados e on e.id = s.empleado_id
-- where s.motivo_eliminacion like 'Eliminada por el % antes de su aprobacion.'
-- order by s.eliminado_en desc;
