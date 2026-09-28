-- ICSI OIL & GAS - RRHH puede dar de alta y modificar Personal y Catalogos
-- PostgreSQL / Supabase
--
-- Hasta ahora solo el administrador podia escribir en empleados, saldos y
-- catalogos (policy acceso_total_administrador de 001). RRHH solo leia.
--
-- Por ahora RRHH recibe permisos muy parecidos a los del administrador sobre:
--   * Personal:  empleados y sus saldos (asignaciones_ausencia).
--   * Catalogos: sedes, proyectos, categorias_empleado y dias_festivos.
--
-- Alcance deliberado:
--   * Solo INSERT y UPDATE. No hay policy de DELETE para RRHH: eliminar
--     (borrado logico) sigue siendo exclusivo del administrador, igual que
--     vacaciones.eliminar_registro / restaurar_registro.
--   * El WITH CHECK del UPDATE exige eliminado_en is null, asi RRHH no puede
--     "borrar" una fila con un UPDATE directo a eliminado_en.
--   * Gestion de accesos (perfiles_usuario, roles, contrasenas) y el resto de
--     tablas siguen siendo solo del administrador.
--
-- En una proxima actualizacion la distincion entre RRHH y administrador sera
-- mas marcada; al ser policies independientes, bastara con quitar o acotar
-- las de este archivo.
--
-- El script es seguro de volver a correr.

begin;

-- security definer por la misma razon que es_administrador() y
-- tiene_perfil_activo(): consultar perfiles_usuario desde una policy de otra
-- tabla no debe reactivar RLS sobre perfiles_usuario.
create or replace function vacaciones.es_rrhh()
returns boolean
language sql
stable
security definer
set search_path = vacaciones, auth, public
as $$
  select exists (
    select 1
    from vacaciones.perfiles_usuario p
    where p.usuario_id = auth.uid()
      and p.rol = 'rrhh'
      and p.activo
      and p.eliminado_en is null
  );
$$;

do $$
declare
  nombre_tabla text;
begin
  foreach nombre_tabla in array array[
    'empleados',
    'asignaciones_ausencia',
    'sedes',
    'proyectos',
    'categorias_empleado',
    'dias_festivos'
  ]
  loop
    execute format(
      'drop policy if exists rrhh_alta on vacaciones.%I',
      nombre_tabla
    );
    execute format(
      'create policy rrhh_alta on vacaciones.%I '
      'for insert to authenticated '
      'with check (vacaciones.es_rrhh())',
      nombre_tabla
    );

    execute format(
      'drop policy if exists rrhh_modificacion on vacaciones.%I',
      nombre_tabla
    );
    execute format(
      'create policy rrhh_modificacion on vacaciones.%I '
      'for update to authenticated '
      'using (vacaciones.es_rrhh() and eliminado_en is null) '
      'with check (vacaciones.es_rrhh() and eliminado_en is null)',
      nombre_tabla
    );
  end loop;
end;
$$;

commit;
