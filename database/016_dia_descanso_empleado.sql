-- 016_dia_descanso_empleado.sql
-- Cada empleado tiene su propio dia de descanso semanal (viernes, sabado o
-- domingo, segun el caso). Ese dia no se cuenta como dia de vacaciones: si
-- Mayra descansa el domingo y pide del lunes 05/10 al martes 13/10, son 8 dias
-- y no 9.
--
--   * empleados.dia_descanso: 0=domingo ... 6=sabado (como extract(dow)).
--     Nulo = sin configurar: se cuentan todos los dias, como hasta ahora.
--   * solicitudes_ausencia.dia_descanso: copia del dia de descanso con la que
--     se calcula la solicitud. Se toma del empleado al crearla y se actualiza
--     mientras siga pendiente; las ya aprobadas conservan el valor con el que
--     se desconto el saldo, para que cancelarlas devuelva lo mismo.
--   * v_dias_solicitud_calendario: el dia de descanso descuenta 0.
--   * El aviso de WhatsApp manda los dias reales ("Días: 8"). Requiere volver
--     a desplegar la Edge Function "notificar".
-- Ejecutar despues de 014 y 015. Seguro de re-ejecutar.

begin;

alter table vacaciones.empleados
  add column if not exists dia_descanso smallint
    check (dia_descanso between 0 and 6);
comment on column vacaciones.empleados.dia_descanso is
  'Dia de descanso semanal (0=domingo ... 6=sabado). No cuenta como dia de vacaciones.';

alter table vacaciones.solicitudes_ausencia
  add column if not exists dia_descanso smallint
    check (dia_descanso between 0 and 6);

-- Toma el dia de descanso del empleado al crear la solicitud o al editarla
-- mientras siga en revision.
create or replace function vacaciones.copiar_dia_descanso_solicitud()
returns trigger
language plpgsql
security definer
set search_path = vacaciones, public
as $$
begin
  if tg_op = 'INSERT' or new.estado in ('planeada', 'pendiente') then
    select e.dia_descanso into new.dia_descanso
    from vacaciones.empleados e
    where e.id = new.empleado_id;
  end if;
  return new;
end;
$$;

drop trigger if exists copiar_dia_descanso_solicitud on vacaciones.solicitudes_ausencia;
create trigger copiar_dia_descanso_solicitud
before insert or update of empleado_id, fecha_inicio, fecha_fin
on vacaciones.solicitudes_ausencia
for each row execute function vacaciones.copiar_dia_descanso_solicitud();

-- Si RRHH cambia el dia de descanso, las solicitudes aun en revision se
-- recalculan; las aprobadas no (su saldo ya se desconto).
create or replace function vacaciones.propagar_dia_descanso_empleado()
returns trigger
language plpgsql
security definer
set search_path = vacaciones, public
as $$
begin
  update vacaciones.solicitudes_ausencia s
  set dia_descanso = new.dia_descanso
  where s.empleado_id = new.id
    and s.estado in ('planeada', 'pendiente')
    and s.eliminado_en is null
    and s.dia_descanso is distinct from new.dia_descanso;
  return new;
end;
$$;

drop trigger if exists propagar_dia_descanso_empleado on vacaciones.empleados;
create trigger propagar_dia_descanso_empleado
after update of dia_descanso on vacaciones.empleados
for each row
when (old.dia_descanso is distinct from new.dia_descanso)
execute function vacaciones.propagar_dia_descanso_empleado();

-- Igual que 014, mas la regla del dia de descanso en dias_descontados.
create or replace view vacaciones.v_dias_solicitud_calendario
with (security_invoker = true)
as
select
  s.id as solicitud_ausencia_id,
  s.organizacion_id,
  s.empleado_id,
  e.numero_empleado,
  e.nombre_completo,
  e.color_calendario,
  e.sede_id,
  se.nombre as nombre_sede,
  e.proyecto_id,
  p.nombre as nombre_proyecto,
  e.categoria_id,
  c.nombre as nombre_categoria,
  s.tipo_ausencia_id,
  ta.codigo as codigo_tipo_ausencia,
  ta.nombre as nombre_tipo_ausencia,
  ta.color as color_tipo_ausencia,
  ta.descuenta_saldo,
  s.estado,
  s.fecha_inicio,
  s.fecha_fin,
  s.fecha_reintegro,
  calendario.fecha_calendario,
  coalesce(
    dhl.fraccion_laboral,
    case
      when extract(dow from calendario.fecha_calendario)::smallint in (0, 6)
        then 0
      else 1
    end
  ) as fraccion_laboral_programada,
  (festivo.es_festivo is not null) as es_festivo,
  case
    when not ta.descuenta_saldo then 0::numeric
    -- El dia de descanso semanal del empleado nunca consume vacaciones.
    when s.dia_descanso is not null
     and extract(dow from calendario.fecha_calendario)::smallint = s.dia_descanso
      then 0::numeric
    when ta.excluir_dias_festivos and festivo.es_festivo is not null
      then 0::numeric
    when ta.metodo_conteo = 'dias_naturales' then
      case
        when calendario.fecha_calendario = s.fecha_inicio
          then s.fraccion_primer_dia
        when calendario.fecha_calendario = s.fecha_fin
          then s.fraccion_ultimo_dia
        else 1::numeric
      end
    else
      (
        case
          when calendario.fecha_calendario = s.fecha_inicio
            then s.fraccion_primer_dia
          when calendario.fecha_calendario = s.fecha_fin
            then s.fraccion_ultimo_dia
          else 1::numeric
        end
      ) * coalesce(
        dhl.fraccion_laboral,
        case
          when extract(dow from calendario.fecha_calendario)::smallint in (0, 6)
            then 0
          else 1
        end
      )
  end::numeric(8,2) as dias_descontados,
  s.comentarios,
  s.origen,
  s.lote_importacion_id,
  s.creado_en,
  s.actualizado_en,
  s.solicitado_en,
  s.resuelto_en,
  s.resuelto_por,
  s.etapa_aprobacion,
  s.etapa_rechazo,
  s.registro_extemporaneo,
  s.descuenta_saldo as solicitud_descuenta_saldo
from vacaciones.solicitudes_ausencia s
join vacaciones.organizaciones o
  on o.id = s.organizacion_id
 and o.eliminado_en is null
join vacaciones.empleados e
  on e.id = s.empleado_id
join vacaciones.tipos_ausencia ta
  on ta.id = s.tipo_ausencia_id
left join vacaciones.sedes se
  on se.id = e.sede_id
 and se.eliminado_en is null
left join vacaciones.proyectos p
  on p.id = e.proyecto_id
 and p.eliminado_en is null
left join vacaciones.categorias_empleado c
  on c.id = e.categoria_id
 and c.eliminado_en is null
cross join lateral (
  select (s.fecha_inicio + serie.desplazamiento_dias)::date as fecha_calendario
  from generate_series(0, s.fecha_fin - s.fecha_inicio)
    as serie(desplazamiento_dias)
) calendario
left join vacaciones.horarios_laborales hl
  on hl.id = e.horario_laboral_id
 and hl.eliminado_en is null
left join vacaciones.dias_horario_laboral dhl
  on dhl.horario_laboral_id = hl.id
 and dhl.dia_semana = extract(dow from calendario.fecha_calendario)::smallint
 and dhl.eliminado_en is null
left join lateral (
  select true as es_festivo
  from vacaciones.dias_festivos df
  where df.organizacion_id = s.organizacion_id
    and df.fecha = calendario.fecha_calendario
    and (df.sede_id is null or df.sede_id = e.sede_id)
    and df.eliminado_en is null
  limit 1
) festivo on true
where s.eliminado_en is null
  and e.eliminado_en is null
  and ta.eliminado_en is null;

-- Igual que 015, mas el campo "Días" con los dias que realmente descuenta.
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
  v_rev_etapa text;
  v_rev_comentario text;
  v_rev_nombre text;
  v_dias numeric;
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

  -- Dias que descuenta la solicitud (sin el dia de descanso del empleado); la
  -- Edge Function los muestra en lugar de contar dias naturales.
  select sum(d.dias_descontados) into v_dias
  from vacaciones.v_dias_solicitud_calendario d
  where d.solicitud_ausencia_id = new.id;
  if v_dias is not null then
    v_mensaje := v_mensaje || ' | Días: ' || trim_scale(v_dias)::text;
  end if;

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

  -- Decision de una etapa: el trigger es diferido (corre al confirmar la
  -- transaccion), asi que la revision que inserto revisar_solicitud despues de
  -- actualizar la solicitud ya existe. creado_en = now() la acota a esta misma
  -- transaccion: un cambio forzado por el administrador no tiene revision.
  if tg_op = 'UPDATE' then
    select r.etapa, r.comentario, p.nombre_visible
      into v_rev_etapa, v_rev_comentario, v_rev_nombre
    from vacaciones.revisiones_solicitud r
    left join vacaciones.perfiles_usuario p on p.usuario_id = r.usuario_id
    where r.solicitud_ausencia_id = new.id
      and r.creado_en = now()
    order by r.creado_en desc
    limit 1;

    if v_rev_etapa is not null then
      v_mensaje := v_mensaje || ' | Revisó: '
        || case v_rev_etapa
             when 'rrhh' then 'RRHH'
             when 'jefe_inmediato' then 'Jefe inmediato'
             else 'Mesa Directiva'
           end
        || coalesce(' · ' || nullif(btrim(v_rev_nombre), ''), '');
      if nullif(btrim(v_rev_comentario), '') is not null then
        -- ' | ' separa campos en la bitacora; los saltos de linea se aplanan.
        v_mensaje := v_mensaje || ' | Comentario revisión: '
          || regexp_replace(replace(btrim(v_rev_comentario), ' | ', ' / '), '\s*\n\s*', ' ', 'g');
      end if;
    end if;
  end if;

  insert into vacaciones.notificaciones (tipo, titulo, mensaje, solicitud_ausencia_id)
  values (v_tipo, v_titulo, v_mensaje, new.id);

  return new;
exception when others then
  return new;  -- el aviso nunca debe bloquear la solicitud
end;
$$;

-- Mayra descansa el domingo; su solicitud pendiente del 05/10 al 13/10 queda
-- en 8 dias por propagar_dia_descanso_empleado. Los demas se capturan desde la
-- app: Empleados > Editar > Día de descanso.
update vacaciones.empleados
set dia_descanso = 0
where nombre_completo = 'MAYRA BERENICE MARIANO GONZALEZ'
  and eliminado_en is null
  and dia_descanso is distinct from 0;

commit;

-- Verificacion:
-- select nombre_completo, fecha_inicio, fecha_fin, estado, sum(dias_descontados) as dias
-- from vacaciones.v_dias_solicitud_calendario
-- where nombre_completo like 'MAYRA%'
-- group by 1, 2, 3, 4 order by 2;
