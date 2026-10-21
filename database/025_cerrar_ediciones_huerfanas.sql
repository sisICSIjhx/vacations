-- 025_cerrar_ediciones_huerfanas.sql
--
-- Una solicitud de edicion (017) quedaba 'pendiente' para siempre si su
-- solicitud de vacaciones se eliminaba (borrado logico) o dejaba de ser
-- editable (rechazada/cancelada). El administrador la seguia viendo en
-- "ediciones por atender" sin poder atenderla: aplicar_edicion_solicitud
-- responde "La solicitud de vacaciones ya no existe".
--
-- 1) Disparador: al eliminar la solicitud o pasarla a un estado no editable,
--    sus ediciones pendientes se cierran como 'rechazada' con una respuesta
--    automatica. No se notifica: la eliminacion o el cambio de estado ya
--    tienen su propio aviso.
-- 2) Limpieza de las ediciones pendientes que ya estaban en esa situacion.
--
-- Ejecutar despues de 017. Seguro de re-ejecutar.

begin;

create or replace function vacaciones.cerrar_ediciones_no_atendibles()
returns trigger
language plpgsql
security definer
set search_path = vacaciones, public
as $$
begin
  if new.eliminado_en is not null
     or new.estado not in ('planeada', 'pendiente', 'aprobada') then
    update vacaciones.solicitudes_edicion
    set estado = 'rechazada',
        respuesta = case
          when new.eliminado_en is not null
            then 'Cerrada automaticamente: la solicitud de vacaciones fue eliminada.'
          else format('Cerrada automaticamente: la solicitud de vacaciones quedo %s.', new.estado)
        end,
        resuelto_por = auth.uid(),
        resuelto_por_nombre = coalesce(vacaciones.nombre_usuario_actual(), 'Sistema'),
        resuelto_en = now()
    where solicitud_ausencia_id = new.id
      and estado = 'pendiente';
  end if;
  return null;
end;
$$;

revoke execute on function vacaciones.cerrar_ediciones_no_atendibles() from public;

drop trigger if exists cerrar_ediciones_no_atendibles on vacaciones.solicitudes_ausencia;
create trigger cerrar_ediciones_no_atendibles
after update of eliminado_en, estado on vacaciones.solicitudes_ausencia
for each row execute function vacaciones.cerrar_ediciones_no_atendibles();

-- Ediciones que ya quedaron sin poder atenderse.
update vacaciones.solicitudes_edicion ed
set estado = 'rechazada',
    respuesta = case
      when s.eliminado_en is not null
        then 'Cerrada automaticamente: la solicitud de vacaciones fue eliminada.'
      else format('Cerrada automaticamente: la solicitud de vacaciones quedo %s.', s.estado)
    end,
    resuelto_por_nombre = 'Sistema',
    resuelto_en = now()
from vacaciones.solicitudes_ausencia s
where s.id = ed.solicitud_ausencia_id
  and ed.estado = 'pendiente'
  and (s.eliminado_en is not null
       or s.estado not in ('planeada', 'pendiente', 'aprobada'));

commit;

-- Comprobacion: no debe devolver filas.
-- select ed.id, s.estado, s.eliminado_en
-- from vacaciones.solicitudes_edicion ed
-- join vacaciones.solicitudes_ausencia s on s.id = ed.solicitud_ausencia_id
-- where ed.estado = 'pendiente'
--   and (s.eliminado_en is not null or s.estado not in ('planeada', 'pendiente', 'aprobada'));
