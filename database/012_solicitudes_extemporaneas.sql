-- 012_solicitudes_extemporaneas.sql
-- Permite al administrador capturar solicitudes con fechas pasadas (o sin la
-- anticipacion minima de 15 dias), eligiendo en cada una:
--   * si ya fue autorizada (se registra aprobada, sin etapas ni avisos) o si
--     debe pasar por el flujo RRHH -> Jefe inmediato -> Mesa Directiva;
--   * si sus dias se descuentan del saldo disponible o no (por ejemplo,
--     cuando el saldo cargado ya los considera).
-- Ejecutar despues de 011. Seguro de re-ejecutar.

begin;

-- ---------------------------------------------------------------------------
-- 1) Columnas nuevas
-- ---------------------------------------------------------------------------
-- descuenta_saldo: false = la solicitud no toca asignaciones_ausencia al
-- aprobarse, cancelarse, borrarse ni restaurarse.
-- registro_extemporaneo: capturada por un administrador fuera de plazo; RRHH
-- puede aprobarla aunque no cumpla la anticipacion minima.
alter table vacaciones.solicitudes_ausencia
  add column if not exists descuenta_saldo boolean not null default true,
  add column if not exists registro_extemporaneo boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2) guardar_solicitud_vacaciones (004): el chequeo de saldo respeta
--    descuenta_saldo al editar.
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
  -- "security definer": esta funcion corre con los permisos de su dueno, no
  -- con los del usuario que la llama, asi que RLS no protege por si sola
  -- quien puede crear o editar la solicitud de quien. El chequeo se hace aqui
  -- explicitamente, replicando lo que antes garantizaban crear_solicitud_propia
  -- / editar_solicitud_propia cuando el frontend escribia la tabla directo.
  v_es_admin := vacaciones.es_administrador();
  if not (v_es_admin or p_empleado_id = vacaciones.empleado_actual_id()) then
    raise exception 'No tiene autorizacion para crear o editar una solicitud de este empleado.';
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

  if p_solicitud_id is null then
    insert into vacaciones.solicitudes_ausencia (
      organizacion_id, empleado_id, tipo_ausencia_id, estado, etapa_aprobacion,
      fecha_inicio, fecha_fin, fecha_reintegro, comentarios, origen, solicitado_en
    ) values (
      v_organizacion_id, p_empleado_id, p_tipo_ausencia_id, 'pendiente', 'rrhh',
      p_fecha_inicio, p_fecha_fin, p_fecha_reintegro, p_comentarios, v_origen, now()
    )
    returning * into resultado;
  else
    update vacaciones.solicitudes_ausencia
    set fecha_inicio = p_fecha_inicio,
        fecha_fin = p_fecha_fin,
        fecha_reintegro = p_fecha_reintegro,
        comentarios = p_comentarios,
        tipo_ausencia_id = p_tipo_ausencia_id
    where id = p_solicitud_id
      and empleado_id = p_empleado_id
      and etapa_aprobacion = 'rrhh'
      and estado in ('planeada', 'pendiente')
      and eliminado_en is null
    returning * into resultado;

    if not found then
      raise exception 'La solicitud no existe o ya no puede editarse (ya inicio su revision).';
    end if;
  end if;

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
-- 3) revisar_solicitud (011): exenta de anticipacion a las extemporaneas y no
--    toca el saldo si descuenta_saldo = false.
-- ---------------------------------------------------------------------------
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
    -- Sin jefe inmediato no hay quien revise esa etapa: pasa directo a Mesa
    -- Directiva en lugar de quedar atascada.
    if exists (
      select 1 from vacaciones.empleados e
      where e.id = solicitud.empleado_id
        and e.jefe_inmediato_id is not null
        and e.eliminado_en is null
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

-- ---------------------------------------------------------------------------
-- 4) cambiar_estado_solicitud (004): idem para los cambios forzados.
-- ---------------------------------------------------------------------------
create or replace function vacaciones.cambiar_estado_solicitud(
  p_solicitud_id uuid,
  p_estado_nuevo text,
  p_comentarios text default null
)
returns vacaciones.solicitudes_ausencia
language plpgsql
security invoker
set search_path = vacaciones, auth, public
as $$
declare
  solicitud_actual vacaciones.solicitudes_ausencia%rowtype;
  uso record;
  resultado vacaciones.solicitudes_ausencia%rowtype;
  v_etapa_aprobacion_nueva text;
  v_etapa_rechazo_nueva text;
begin
  if not vacaciones.es_administrador() then
    raise exception 'Solo un administrador puede resolver solicitudes.';
  end if;

  if p_estado_nuevo not in ('planeada', 'pendiente', 'aprobada', 'rechazada', 'cancelada') then
    raise exception 'Estado de solicitud no valido: %', p_estado_nuevo;
  end if;

  select *
  into solicitud_actual
  from vacaciones.solicitudes_ausencia
  where id = p_solicitud_id
    and eliminado_en is null
  for update;

  if not found then
    raise exception 'Solicitud no encontrada.';
  end if;

  if solicitud_actual.estado = p_estado_nuevo then
    return solicitud_actual;
  end if;

  if solicitud_actual.estado <> 'aprobada' and p_estado_nuevo = 'aprobada'
     and solicitud_actual.descuenta_saldo then
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
      where empleado_id = solicitud_actual.empleado_id
        and tipo_ausencia_id = solicitud_actual.tipo_ausencia_id
        and anio_asignacion = uso.anio
        and eliminado_en is null
        and dias_disponibles >= uso.dias;

      if not found then
        raise exception
          'Saldo insuficiente o asignacion inexistente para el anio %.',
          uso.anio;
      end if;
    end loop;
  elsif solicitud_actual.estado = 'aprobada' and p_estado_nuevo <> 'aprobada'
     and solicitud_actual.descuenta_saldo then
    for uso in
      select
        extract(year from fecha_calendario)::integer as anio,
        sum(dias_descontados)::numeric(8,2) as dias
      from vacaciones.v_dias_solicitud_calendario
      where solicitud_ausencia_id = p_solicitud_id
      group by extract(year from fecha_calendario)::integer
    loop
      update vacaciones.asignaciones_ausencia
      set dias_disponibles = dias_disponibles + uso.dias,
          fecha_corte_saldo = current_date
      where empleado_id = solicitud_actual.empleado_id
        and tipo_ausencia_id = solicitud_actual.tipo_ausencia_id
        and anio_asignacion = uso.anio
        and eliminado_en is null;

      if not found then
        raise exception 'Asignacion inexistente para el anio %.', uso.anio;
      end if;
    end loop;
  end if;

  -- Mantiene etapa_aprobacion/etapa_rechazo consistentes con el estado grueso
  -- que el administrador acaba de forzar (ver la nota de la seccion 9).
  if p_estado_nuevo = 'aprobada' then
    v_etapa_aprobacion_nueva := 'aprobada';
    v_etapa_rechazo_nueva := solicitud_actual.etapa_rechazo;
  elsif p_estado_nuevo = 'rechazada' then
    v_etapa_aprobacion_nueva := 'rechazada';
    v_etapa_rechazo_nueva := null; -- rechazo administrativo: no se atribuye a una etapa especifica
  elsif p_estado_nuevo in ('planeada', 'pendiente') then
    v_etapa_aprobacion_nueva := 'rrhh';
    v_etapa_rechazo_nueva := null;
  else
    v_etapa_aprobacion_nueva := solicitud_actual.etapa_aprobacion;
    v_etapa_rechazo_nueva := solicitud_actual.etapa_rechazo;
  end if;

  update vacaciones.solicitudes_ausencia
  set estado = p_estado_nuevo,
      etapa_aprobacion = v_etapa_aprobacion_nueva,
      etapa_rechazo = v_etapa_rechazo_nueva,
      comentarios = coalesce(p_comentarios, comentarios),
      resuelto_en = case
        when p_estado_nuevo in ('aprobada', 'rechazada', 'cancelada') then now()
        else null
      end,
      resuelto_por = auth.uid()::text
  where id = p_solicitud_id
  returning * into resultado;

  return resultado;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Borrado / restauracion (001): idem.
-- ---------------------------------------------------------------------------
create or replace function vacaciones.ajustar_saldo_borrado_solicitud()
returns trigger
language plpgsql
set search_path = vacaciones, public
as $$
declare
  uso record;
begin
  if old.eliminado_en is null
     and new.eliminado_en is not null
     and old.estado = 'aprobada'
     and old.descuenta_saldo then
    for uso in
      select
        extract(year from fecha_calendario)::integer as anio,
        sum(dias_descontados)::numeric(8,2) as dias
      from vacaciones.v_dias_solicitud_calendario
      where solicitud_ausencia_id = old.id
      group by extract(year from fecha_calendario)::integer
    loop
      update vacaciones.asignaciones_ausencia
      set dias_disponibles = dias_disponibles + uso.dias,
          fecha_corte_saldo = current_date
      where empleado_id = old.empleado_id
        and tipo_ausencia_id = old.tipo_ausencia_id
        and anio_asignacion = uso.anio
        and eliminado_en is null;

      if not found then
        raise exception 'Asignacion activa inexistente para el anio %.', uso.anio;
      end if;
    end loop;
  end if;

  return new;
end;
$$;

create or replace function vacaciones.ajustar_saldo_restauracion_solicitud()
returns trigger
language plpgsql
set search_path = vacaciones, public
as $$
declare
  uso record;
begin
  if old.eliminado_en is not null
     and new.eliminado_en is null
     and new.estado = 'aprobada'
     and new.descuenta_saldo then
    for uso in
      select
        extract(year from fecha_calendario)::integer as anio,
        sum(dias_descontados)::numeric(8,2) as dias
      from vacaciones.v_dias_solicitud_calendario
      where solicitud_ausencia_id = new.id
      group by extract(year from fecha_calendario)::integer
    loop
      update vacaciones.asignaciones_ausencia
      set dias_disponibles = dias_disponibles - uso.dias,
          fecha_corte_saldo = current_date
      where empleado_id = new.empleado_id
        and tipo_ausencia_id = new.tipo_ausencia_id
        and anio_asignacion = uso.anio
        and eliminado_en is null
        and dias_disponibles >= uso.dias;

      if not found then
        raise exception
          'Saldo insuficiente o asignacion activa inexistente para el anio %.',
          uso.anio;
      end if;
    end loop;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) RPC: registrar una solicitud extemporanea (solo administrador)
-- ---------------------------------------------------------------------------
-- Para capturar solicitudes cuya fecha ya paso o que no cumplen la
-- anticipacion minima. El administrador elige:
--   * p_ya_aprobada = true: se inserta directamente como APROBADA, sin pasar
--     por las etapas. Como no entra como 'pendiente', los disparadores de 008
--     y 010 no mandan WhatsApp ni correo, y no se registran revisiones.
--   * p_ya_aprobada = false: entra al flujo normal (RRHH -> Jefe -> Mesa) con
--     sus avisos; RRHH podra aprobarla aunque no cumpla la anticipacion.
--   * p_descontar_saldo: si los dias se restan del saldo disponible (ahora si
--     ya esta aprobada, o al final del flujo si no).
create or replace function vacaciones.registrar_solicitud_extemporanea(
  p_empleado_id uuid,
  p_tipo_ausencia_id uuid,
  p_fecha_inicio date,
  p_fecha_fin date,
  p_fecha_reintegro date default null,
  p_comentarios text default null,
  p_solicitado_en date default null,
  p_ya_aprobada boolean default true,
  p_descontar_saldo boolean default true
)
returns vacaciones.solicitudes_ausencia
language plpgsql
security definer
set search_path = vacaciones, auth, public
as $$
declare
  v_organizacion_id uuid;
  resultado vacaciones.solicitudes_ausencia%rowtype;
  uso record;
begin
  if not vacaciones.es_administrador() then
    raise exception 'Solo un administrador puede registrar solicitudes extemporaneas.';
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

  insert into vacaciones.solicitudes_ausencia (
    organizacion_id, empleado_id, tipo_ausencia_id, estado, etapa_aprobacion,
    fecha_inicio, fecha_fin, fecha_reintegro, comentarios, origen, solicitado_en,
    resuelto_en, resuelto_por, descuenta_saldo, registro_extemporaneo
  ) values (
    v_organizacion_id, p_empleado_id, p_tipo_ausencia_id,
    case when p_ya_aprobada then 'aprobada' else 'pendiente' end,
    case when p_ya_aprobada then 'aprobada' else 'rrhh' end,
    p_fecha_inicio, p_fecha_fin, p_fecha_reintegro, p_comentarios, 'administrador',
    coalesce(p_solicitado_en::timestamptz, now()),
    case when p_ya_aprobada then now() end,
    case when p_ya_aprobada then auth.uid()::text end,
    p_descontar_saldo, true
  )
  returning * into resultado;

  if p_descontar_saldo then
    for uso in
      select
        extract(year from fecha_calendario)::integer as anio,
        sum(dias_descontados)::numeric(8,2) as dias
      from vacaciones.v_dias_solicitud_calendario
      where solicitud_ausencia_id = resultado.id
      group by extract(year from fecha_calendario)::integer
    loop
      continue when uso.dias <= 0;

      if p_ya_aprobada then
        update vacaciones.asignaciones_ausencia
        set dias_disponibles = dias_disponibles - uso.dias,
            fecha_corte_saldo = current_date
        where empleado_id = resultado.empleado_id
          and tipo_ausencia_id = resultado.tipo_ausencia_id
          and anio_asignacion = uso.anio
          and eliminado_en is null
          and dias_disponibles >= uso.dias;

        if not found then
          raise exception
            'Saldo insuficiente para el ano %: la solicitud requiere % dia(s) disponibles.',
            uso.anio, uso.dias;
        end if;
      elsif not exists (
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
  end if;

  return resultado;
end;
$$;

grant execute on function vacaciones.registrar_solicitud_extemporanea(
  uuid, uuid, date, date, date, text, date, boolean, boolean
) to authenticated, service_role;

commit;
