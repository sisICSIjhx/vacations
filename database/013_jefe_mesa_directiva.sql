-- 013_jefe_mesa_directiva.sql
-- Si el jefe inmediato de un empleado esta vinculado a un usuario con rol
-- mesa_directiva, la etapa de jefe inmediato se omite: al aprobar RRHH la
-- solicitud pasa directo a Mesa Directiva (una sola aprobacion), igual que
-- cuando el empleado no tiene jefe (007). Sin esto, la solicitud quedaba en
-- "Jefe inmediato", donde un usuario de Mesa Directiva no ve los botones.
-- Solo cambia vacaciones.revisar_solicitud respecto de 012. Ejecutar despues
-- de 012. Seguro de re-ejecutar.

begin;

create or replace function vacaciones.es_jefe_mesa_directiva(p_empleado_id uuid)
returns boolean
language sql
stable
security definer
set search_path = vacaciones, public
as $$
  select exists (
    select 1 from vacaciones.perfiles_usuario p
    where p.empleado_id = p_empleado_id
      and p.rol = 'mesa_directiva'
      and p.activo
      and p.eliminado_en is null
  );
$$;

grant execute on function vacaciones.es_jefe_mesa_directiva(uuid)
  to authenticated, service_role;

create or replace function vacaciones.revisar_solicitud(
  p_solicitud_id uuid,
  p_etapa text,
  p_decision text,
  p_comentario text default null
)
returns vacaciones.solicitudes_ausencia
language plpgsql
security definer
set search_path = vacaciones, auth, public
as $$
declare
  solicitud vacaciones.solicitudes_ausencia%rowtype;
  perfil vacaciones.perfiles_usuario%rowtype;
  es_admin boolean;
  autorizado boolean := false;
  etapa_siguiente text;
  estado_resultante text;
  resultado vacaciones.solicitudes_ausencia%rowtype;
  uso record;
begin
  if p_etapa not in ('rrhh', 'jefe_inmediato', 'mesa_directiva') then
    raise exception 'Etapa no valida: %', p_etapa;
  end if;
  if p_decision not in ('aprobado', 'rechazado') then
    raise exception 'Decision no valida: %', p_decision;
  end if;

  select * into solicitud
  from vacaciones.solicitudes_ausencia
  where id = p_solicitud_id and eliminado_en is null
  for update;

  if not found then
    raise exception 'Solicitud no encontrada.';
  end if;

  if solicitud.etapa_aprobacion <> p_etapa then
    raise exception
      'La solicitud esta en la etapa % y no puede revisarse en %. No se pueden saltar etapas.',
      solicitud.etapa_aprobacion, p_etapa;
  end if;

  -- "planeada" es un balde distinto (historico/CSV, sin revision activa): una
  -- solicitud solo es accionable mientras esta realmente en curso ('pendiente').
  if solicitud.estado <> 'pendiente' then
    raise exception
      'La solicitud no esta en revision activa (estado %).', solicitud.estado;
  end if;

  es_admin := vacaciones.es_administrador();

  if es_admin then
    autorizado := true;
  else
    select * into perfil
    from vacaciones.perfiles_usuario
    where usuario_id = auth.uid()
      and activo
      and eliminado_en is null;

    if found then
      if p_etapa = 'rrhh' and perfil.rol = 'rrhh' then
        autorizado := true;
      elsif p_etapa = 'mesa_directiva' and perfil.rol = 'mesa_directiva' then
        autorizado := true;
      elsif p_etapa = 'jefe_inmediato' and perfil.empleado_id is not null then
        autorizado := exists (
          select 1 from vacaciones.empleados e
          where e.id = solicitud.empleado_id
            and e.jefe_inmediato_id = perfil.empleado_id
            and e.eliminado_en is null
        );
      end if;
    end if;
  end if;

  if not autorizado then
    raise exception 'No tiene autorizacion para revisar esta etapa de la solicitud.';
  end if;

  if p_etapa = 'rrhh' and p_decision = 'aprobado' then
    -- Las urgentes se crean justamente por no poder esperar los 15 dias.
    if solicitud.fecha_inicio - current_date < 15
       and coalesce(solicitud.comentarios, '') not like '[URGENTE]%'
       and not solicitud.registro_extemporaneo then
      raise exception
        'La solicitud no cumple la anticipacion minima de 15 dias (faltan % dia(s) de anticipacion).',
        15 - (solicitud.fecha_inicio - current_date);
    end if;

    for uso in
      select
        extract(year from fecha_calendario)::integer as anio,
        sum(dias_descontados)::numeric(8,2) as dias
      from vacaciones.v_dias_solicitud_calendario
      where solicitud_ausencia_id = p_solicitud_id
      group by extract(year from fecha_calendario)::integer
    loop
      if solicitud.descuenta_saldo and uso.dias > 0 and not exists (
        select 1 from vacaciones.asignaciones_ausencia a
        where a.empleado_id = solicitud.empleado_id
          and a.tipo_ausencia_id = solicitud.tipo_ausencia_id
          and a.anio_asignacion = uso.anio
          and a.eliminado_en is null
          and a.dias_disponibles >= uso.dias
      ) then
        raise exception
          'Saldo insuficiente para el ano %: la solicitud requiere % dia(s) disponibles.',
          uso.anio, uso.dias;
      end if;
    end loop;
  end if;

  if p_decision = 'rechazado' then
    etapa_siguiente := 'rechazada';
    estado_resultante := 'rechazada';
  elsif p_etapa = 'mesa_directiva' then
    etapa_siguiente := 'aprobada';
    estado_resultante := 'aprobada';
  elsif p_etapa = 'rrhh' then
    -- Sin jefe inmediato no hay quien revise esa etapa, y si el jefe es Mesa
    -- Directiva aprobaria dos veces: en ambos casos pasa directo a Mesa
    -- Directiva en lugar de quedar atascada.
    if exists (
      select 1 from vacaciones.empleados e
      where e.id = solicitud.empleado_id
        and e.jefe_inmediato_id is not null
        and e.eliminado_en is null
        and not vacaciones.es_jefe_mesa_directiva(e.jefe_inmediato_id)
    ) then
      etapa_siguiente := 'jefe_inmediato';
    else
      etapa_siguiente := 'mesa_directiva';
    end if;
    estado_resultante := 'pendiente';
  else
    etapa_siguiente := 'mesa_directiva';
    estado_resultante := 'pendiente';
  end if;

  if estado_resultante = 'aprobada' and solicitud.descuenta_saldo then
    for uso in
      select
        extract(year from fecha_calendario)::integer as anio,
        sum(dias_descontados)::numeric(8,2) as dias
      from vacaciones.v_dias_solicitud_calendario
      where solicitud_ausencia_id = p_solicitud_id
      group by extract(year from fecha_calendario)::integer
    loop
      update vacaciones.asignaciones_ausencia
      set dias_disponibles = dias_disponibles - uso.dias,
          fecha_corte_saldo = current_date
      where empleado_id = solicitud.empleado_id
        and tipo_ausencia_id = solicitud.tipo_ausencia_id
        and anio_asignacion = uso.anio
        and eliminado_en is null
        and dias_disponibles >= uso.dias;

      if not found then
        raise exception 'Saldo insuficiente o asignacion inexistente para el ano %.', uso.anio;
      end if;
    end loop;
  end if;

  update vacaciones.solicitudes_ausencia
  set etapa_aprobacion = etapa_siguiente,
      etapa_rechazo = case when p_decision = 'rechazado' then p_etapa else etapa_rechazo end,
      estado = estado_resultante,
      resuelto_en = case when etapa_siguiente in ('aprobada', 'rechazada') then now() else resuelto_en end,
      resuelto_por = case when etapa_siguiente in ('aprobada', 'rechazada') then auth.uid()::text else resuelto_por end
  where id = p_solicitud_id
  returning * into resultado;

  insert into vacaciones.revisiones_solicitud (
    solicitud_ausencia_id, etapa, decision, estado_resultante, usuario_id, comentario
  ) values (
    p_solicitud_id, p_etapa, p_decision, etapa_siguiente, auth.uid(), p_comentario
  );

  return resultado;
end;
$$;

grant execute on function vacaciones.revisar_solicitud(uuid, text, text, text)
  to authenticated, service_role;

-- Solicitudes que ya estan esperando al jefe inmediato y cuyo jefe es Mesa
-- Directiva quedarian atascadas: se mueven a la etapa de Mesa Directiva.
update vacaciones.solicitudes_ausencia s
set etapa_aprobacion = 'mesa_directiva'
where s.etapa_aprobacion = 'jefe_inmediato'
  and s.estado = 'pendiente'
  and s.eliminado_en is null
  and exists (
    select 1 from vacaciones.empleados e
    where e.id = s.empleado_id
      and vacaciones.es_jefe_mesa_directiva(e.jefe_inmediato_id)
  );

commit;
