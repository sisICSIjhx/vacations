-- Ejecutar después de 026 y publicar el frontend que utiliza esta RPC.
begin;

-- Las funciones SECURITY DEFINER de solicitudes, aniversario y arrastre
-- conservan su acceso. El navegador no puede eludir la RPC con un upsert.
revoke insert, update, delete on vacaciones.asignaciones_ausencia from public, anon, authenticated;

-- 012 dejó esta operación como SECURITY INVOKER. Su cuerpo comprueba
-- es_administrador(); necesita acceso privilegiado para conservar los
-- descuentos/reintegros por estado tras cerrar la escritura directa.
alter function vacaciones.cambiar_estado_solicitud(uuid,text,text) security definer;
alter function vacaciones.cambiar_estado_solicitud(uuid,text,text) set search_path = pg_catalog, vacaciones, auth;
revoke all on function vacaciones.cambiar_estado_solicitud(uuid,text,text) from public, anon;
grant execute on function vacaciones.cambiar_estado_solicitud(uuid,text,text) to authenticated;

create or replace function vacaciones.guardar_saldo_vacaciones(
  p_empleado_id uuid,
  p_anio integer,
  p_dias_por_derecho numeric,
  p_dias_acumulados numeric,
  p_dias_disponibles numeric,
  p_anteriores jsonb,
  p_motivo text
)
returns void language plpgsql security definer
set search_path = pg_catalog, vacaciones, auth
as $$
declare
  v_rol text;
  v_tipo uuid;
  v_saldo vacaciones.asignaciones_ausencia%rowtype;
  v_actual jsonb;
  v_nuevo jsonb;
  v_motivo text := regexp_replace(coalesce(p_motivo, ''), '^\s+|\s+$', '', 'g');
  v_evento bigint;
begin
  select rol into v_rol from vacaciones.perfiles_usuario
  where usuario_id = auth.uid() and activo and eliminado_en is null;
  if v_rol is null or v_rol not in ('administrador','rrhh','mesa_directiva') then
    raise exception 'Solo Administración, RRHH y Mesa Directiva pueden ajustar saldos.';
  end if;
  if p_anio is null or p_anio not between 2000 and 2200
    or p_dias_por_derecho is null or p_dias_por_derecho not between 0 and 999999.99
    or p_dias_acumulados is null or p_dias_acumulados not between 0 and 999999.99
    or p_dias_disponibles is null or p_dias_disponibles not between 0 and 999999.99
    or p_dias_por_derecho <> round(p_dias_por_derecho, 2)
    or p_dias_acumulados <> round(p_dias_acumulados, 2)
    or p_dias_disponibles <> round(p_dias_disponibles, 2) then
    raise exception 'Los días deben ser cantidades válidas no negativas con máximo dos decimales.';
  end if;
  -- Serializa altas manuales del mismo empleado y comprueba que no esté eliminado.
  perform 1 from vacaciones.empleados where id = p_empleado_id and eliminado_en is null for update;
  if not found then raise exception 'Empleado no disponible.'; end if;
  select t.id into v_tipo from vacaciones.tipos_ausencia t
  join vacaciones.empleados e on e.organizacion_id = t.organizacion_id
  where e.id = p_empleado_id and t.codigo = 'VACACIONES' and t.eliminado_en is null;
  if v_tipo is null then raise exception 'No se encontró el tipo VACACIONES.'; end if;

  select * into v_saldo from vacaciones.asignaciones_ausencia
  where empleado_id = p_empleado_id and tipo_ausencia_id = v_tipo and anio_asignacion = p_anio
  for update;
  v_nuevo := jsonb_build_object('diasPorDerecho',p_dias_por_derecho,'diasAcumulados',p_dias_acumulados,'diasDisponibles',p_dias_disponibles);
  if not found then
    if p_anteriores is not null then raise exception 'El saldo cambió. Recarga Personal antes de volver a ajustar.'; end if;
    if v_rol = 'mesa_directiva' then raise exception 'Solo Administración y RRHH pueden crear el saldo inicial.'; end if;
    insert into vacaciones.asignaciones_ausencia(empleado_id,tipo_ausencia_id,anio_asignacion,dias_por_derecho,dias_acumulados_a_fecha,dias_disponibles,fecha_corte_saldo,derecho_otorgado_en)
    values(p_empleado_id,v_tipo,p_anio,p_dias_por_derecho,p_dias_acumulados,p_dias_disponibles,current_date,case when p_dias_por_derecho > 0 then current_date end);
    return;
  end if;
  if v_saldo.eliminado_en is not null then raise exception 'El saldo está eliminado; no se puede ajustar.'; end if;
  v_actual := jsonb_build_object('diasPorDerecho',v_saldo.dias_por_derecho,'diasAcumulados',v_saldo.dias_acumulados_a_fecha,'diasDisponibles',v_saldo.dias_disponibles);
  if p_anteriores is distinct from v_actual then
    raise exception 'El saldo cambió. Recarga Personal antes de volver a ajustar.';
  end if;
  if v_actual = v_nuevo then return; end if;
  if v_motivo = '' then raise exception 'Es obligatorio indicar el motivo del ajuste de saldo.'; end if;
  if length(v_motivo) > 2000 then raise exception 'El motivo no puede superar 2000 caracteres.'; end if;

  select coalesce(max(id),0) into v_evento from vacaciones.historial_actividad;
  update vacaciones.asignaciones_ausencia set
    dias_por_derecho = p_dias_por_derecho,
    dias_acumulados_a_fecha = p_dias_acumulados,
    dias_disponibles = p_dias_disponibles,
    fecha_corte_saldo = current_date
  where id = v_saldo.id;
  -- Completa exclusivamente el evento generado por 026 para esta fila y llamada.
  -- Los cambios derivados de arrastre conservan su propia auditoría automática.
  update vacaciones.historial_actividad set motivo = v_motivo,
    nuevos = nuevos || jsonb_build_object('anio_asignacion',p_anio)
  where id > v_evento and transaccion = txid_current()
    and entidad = 'asignaciones_ausencia' and registro_id = v_saldo.id::text
    and accion = 'actualizacion';
  if not found then raise exception 'No se pudo registrar la evidencia del ajuste.'; end if;
end;
$$;
revoke all on function vacaciones.guardar_saldo_vacaciones(uuid,integer,numeric,numeric,numeric,jsonb,text) from public, anon;
grant execute on function vacaciones.guardar_saldo_vacaciones(uuid,integer,numeric,numeric,numeric,jsonb,text) to authenticated;

-- Mesa consulta saldos y solicitudes; no recibe acceso al resto del historial.
create or replace function vacaciones.puede_leer_actividad(p_modulo text, p_empleado uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, vacaciones, auth
as $$
  select exists (
    select 1 from vacaciones.perfiles_usuario p
    where p.usuario_id = auth.uid() and p.activo and p.eliminado_en is null
      and (
        p.rol = 'administrador'
        or (p.rol = 'rrhh' and p_modulo <> 'accesos')
        or (p.rol = 'mesa_directiva' and p_modulo = 'saldos')
        or (p_modulo = 'solicitudes' and (
          p.rol = 'mesa_directiva' or p.empleado_id = p_empleado
          or exists (select 1 from vacaciones.empleados e
            where e.id = p_empleado and e.jefe_inmediato_id = p.empleado_id and e.eliminado_en is null)
        ))
      )
  );
$$;

commit;
