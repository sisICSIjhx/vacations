-- 015_whatsapp_comentarios_revision.sql
-- Los avisos de WhatsApp de cada decision (RRHH, Jefe inmediato, Mesa
-- Directiva; aprobada o rechazada) incluyen quien reviso y su comentario.
--
-- revisar_solicitud actualiza la solicitud ANTES de insertar la revision con
-- el comentario, asi que el trigger de 008 no lo veia. Ahora es un trigger de
-- restriccion DIFERIDO: corre al confirmar la transaccion, cuando la revision
-- ya existe. Requiere volver a desplegar la Edge Function "notificar".
-- Ejecutar despues de 008. Seguro de re-ejecutar.

begin;

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

drop trigger if exists trg_notificar_cambio_solicitud on vacaciones.solicitudes_ausencia;
create constraint trigger trg_notificar_cambio_solicitud
after insert or update of etapa_aprobacion on vacaciones.solicitudes_ausencia
deferrable initially deferred
for each row execute function vacaciones.notificar_cambio_solicitud();

commit;
