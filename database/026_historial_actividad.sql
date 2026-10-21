-- Historial operativo. Ejecutar después de 025. No reconstruye cambios sin evidencia.
begin;

create table if not exists vacaciones.historial_actividad (
  id bigint generated always as identity primary key,
  ocurrido_en timestamptz not null default clock_timestamp(),
  actor_id uuid,
  actor_nombre text not null,
  modulo text not null,
  entidad text not null,
  registro_id text not null,
  solicitud_id uuid,
  empleado_id uuid,
  sujeto text not null,
  accion text not null,
  motivo text,
  anteriores jsonb not null default '{}',
  nuevos jsonb not null default '{}',
  recuperado boolean not null default false,
  clave_origen text unique,
  transaccion bigint not null default txid_current()
);
-- Sin FK: eliminar datos operativos nunca debe borrar su evidencia.
create index if not exists historial_actividad_fecha_idx on vacaciones.historial_actividad (ocurrido_en desc, id desc);
create index if not exists historial_actividad_solicitud_idx on vacaciones.historial_actividad (solicitud_id, ocurrido_en desc, id desc);
create index if not exists historial_actividad_modulo_idx on vacaciones.historial_actividad (modulo, ocurrido_en desc, id desc);
create index if not exists historial_actividad_empleado_idx on vacaciones.historial_actividad (empleado_id);

alter table vacaciones.historial_actividad enable row level security;
revoke all on vacaciones.historial_actividad from public, anon, authenticated;
grant select on vacaciones.historial_actividad to authenticated;
grant all on vacaciones.historial_actividad to service_role;
grant usage, select on sequence vacaciones.historial_actividad_id_seq to service_role;

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
        or (p_modulo = 'solicitudes' and (
          p.rol = 'mesa_directiva' or p.empleado_id = p_empleado
          or exists (select 1 from vacaciones.empleados e
            where e.id = p_empleado and e.jefe_inmediato_id = p.empleado_id and e.eliminado_en is null)
        ))
      )
  );
$$;
revoke all on function vacaciones.puede_leer_actividad(text, uuid) from public, anon;
grant execute on function vacaciones.puede_leer_actividad(text, uuid) to authenticated;
drop policy if exists lectura_actividad on vacaciones.historial_actividad;
create policy lectura_actividad on vacaciones.historial_actividad for select to authenticated
using (vacaciones.puede_leer_actividad(modulo, empleado_id));

-- Lista positiva: nunca copia cargas CSV, secretos ni columnas nuevas por accidente.
create or replace function vacaciones.datos_auditables(p_tabla text, p_fila jsonb)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, vacaciones
as $$
declare campos text[]; resultado jsonb; campo text; etiqueta text;
begin
  campos := case p_tabla
    when 'solicitudes_ausencia' then array['estado','fecha_inicio','fecha_fin','fecha_reintegro','comentarios','etapa_aprobacion','etapa_rechazo','registro_extemporaneo','descontar_saldo','motivo_cancelacion','cancelado_en','cancelado_por_nombre','eliminado_en','motivo_eliminacion']
    when 'revisiones_solicitud' then array['etapa','decision','estado_resultante','comentario']
    when 'solicitudes_edicion' then array['estado','motivo','fecha_inicio_propuesta','fecha_fin_propuesta','fecha_reintegro_propuesta','respuesta','valores_anteriores','valores_nuevos']
    when 'empleados' then array['numero_empleado','nombre_completo','correo_electronico','telefono_whatsapp','color_calendario','sede_id','proyecto_id','categoria_id','horario_laboral_id','fecha_ingreso','fecha_baja','estado','jefe_inmediato_id','dia_descanso','eliminado_en','motivo_eliminacion']
    when 'perfiles_usuario' then array['nombre_visible','rol','activo','empleado_id','eliminado_en']
    when 'asignaciones_ausencia' then array['anio_asignacion','dias_por_derecho','dias_acumulados_a_fecha','dias_disponibles','dias_transferidos','ajuste_dias','dias_utilizados_antes_sistema','fecha_corte_saldo','fecha_vencimiento','notas','eliminado_en']
    when 'instantaneas_saldo_ausencia' then array['anio_saldo','fecha_captura','dias_disponibles_declarados','dias_planeados_declarados','eliminado_en']
    when 'dias_conservados_solicitud' then array['anio','dias','eliminado_en']
    when 'lotes_importacion' then array['nombre_archivo','estado','total_filas','filas_importadas','filas_rechazadas','eliminado_en']
    when 'incidencias_importacion' then array['numero_fila','codigo_incidencia','mensaje','gravedad','eliminado_en']
    else array['nombre','codigo','descripcion','color','activo','fecha','sede_id','fraccion_dia','repeticion','dia_semana','fraccion_laboral','horario_laboral_id','predeterminado','descuenta_saldo','requiere_aprobacion','metodo_conteo','excluir_dias_festivos','eliminado_en','motivo_eliminacion'] end;
  select coalesce(jsonb_object_agg(key, value), '{}') into resultado
  from jsonb_each(coalesce(p_fila, '{}')) where key = any(campos);
  -- Referencias legibles, conservadas en el momento del evento.
  foreach campo in array array['sede_id','proyecto_id','categoria_id','jefe_inmediato_id','empleado_id'] loop
    if resultado ->> campo is not null then
      etiqueta := null;
      case campo
        when 'sede_id' then select nombre into etiqueta from vacaciones.sedes where id = (resultado ->> campo)::uuid;
        when 'proyecto_id' then select nombre into etiqueta from vacaciones.proyectos where id = (resultado ->> campo)::uuid;
        when 'categoria_id' then select nombre into etiqueta from vacaciones.categorias_empleado where id = (resultado ->> campo)::uuid;
        else select nombre_completo into etiqueta from vacaciones.empleados where id = (resultado ->> campo)::uuid;
      end case;
      resultado := jsonb_set(resultado, array[campo], to_jsonb(coalesce(etiqueta, 'Registro no disponible')));
    end if;
  end loop;
  return resultado;
end;
$$;
revoke all on function vacaciones.datos_auditables(text, jsonb) from public, anon, authenticated;

create or replace function vacaciones.registrar_actividad()
returns trigger language plpgsql security definer
set search_path = pg_catalog, vacaciones, auth
as $$
declare
  fila jsonb; previa jsonb := '{}'; antes jsonb; despues jsonb;
  v_actor uuid := auth.uid(); v_nombre text; v_modulo text := tg_argv[0];
  v_empleado uuid; v_solicitud uuid; v_sujeto text; v_id text; v_accion text; v_motivo text;
  campos_cambiados text[]; campo_reservado text;
begin
  if tg_op = 'DELETE' then fila := to_jsonb(old); else fila := to_jsonb(new); end if;
  if tg_op <> 'INSERT' then previa := to_jsonb(old); end if;
  -- Solo la API que posee service_role puede suministrar esta identidad.
  if auth.role() = 'service_role' then
    v_actor := nullif(coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-vacaciones-actor-id', '')::uuid;
  end if;
  select nullif(btrim(nombre_visible), '') into v_nombre from vacaciones.perfiles_usuario where usuario_id = v_actor;
  v_nombre := coalesce(v_nombre, case when v_actor is null then 'Sistema / proceso automático' else 'Usuario sin nombre registrado' end);
  v_id := coalesce(fila ->> 'id', fila ->> 'usuario_id', (fila ->> 'solicitud_ausencia_id') || ':' || (fila ->> 'anio'), (fila ->> 'horario_laboral_id') || ':' || (fila ->> 'dia_semana'));
  v_empleado := nullif(fila ->> 'empleado_id', '')::uuid;
  if tg_table_name = 'empleados' then v_empleado := v_id::uuid; end if;
  v_solicitud := nullif(fila ->> 'solicitud_ausencia_id', '')::uuid;
  if tg_table_name = 'solicitudes_ausencia' then v_solicitud := v_id::uuid; end if;
  if v_solicitud is not null and v_empleado is null then
    select empleado_id into v_empleado from vacaciones.solicitudes_ausencia where id = v_solicitud;
  end if;
  select nombre_completo into v_sujeto from vacaciones.empleados where id = v_empleado;
  v_sujeto := coalesce(v_sujeto, fila ->> 'nombre_completo', fila ->> 'nombre_visible', fila ->> 'nombre', fila ->> 'nombre_archivo', 'Registro operativo');
  if v_solicitud is not null then
    select v_sujeto || ' · ' || to_char(fecha_inicio, 'DD/MM/YYYY') || ' al ' || to_char(fecha_fin, 'DD/MM/YYYY')
    into v_sujeto from vacaciones.solicitudes_ausencia where id = v_solicitud;
    v_sujeto := coalesce(v_sujeto, 'Solicitud eliminada');
  end if;
  antes := vacaciones.datos_auditables(tg_table_name, previa);
  despues := case when tg_op = 'DELETE' then '{}'::jsonb else vacaciones.datos_auditables(tg_table_name, fila) end;
  if tg_table_name = 'empleados' then
    foreach campo_reservado in array array['curp','nss'] loop
      if previa ->> campo_reservado is distinct from fila ->> campo_reservado then
        -- Se registra que cambió, sin duplicar identificadores personales.
        antes := antes || jsonb_build_object(campo_reservado, 'Valor reservado');
        despues := despues || jsonb_build_object(campo_reservado, 'Dato actualizado (valor reservado)');
      end if;
    end loop;
  end if;
  if tg_op = 'UPDATE' then
    select array_agg(k) into campos_cambiados from (
      select key k from jsonb_each(antes) union select key from jsonb_each(despues)
    ) campos where antes -> k is distinct from despues -> k;
    if campos_cambiados is null then return new; end if;
    select coalesce(jsonb_object_agg(key,value), '{}') into antes from jsonb_each(antes) where key = any(campos_cambiados);
    select coalesce(jsonb_object_agg(key,value), '{}') into despues from jsonb_each(despues) where key = any(campos_cambiados);
  end if;
  v_accion := case tg_op when 'INSERT' then 'creacion' when 'DELETE' then 'eliminacion' else 'actualizacion' end;
  if tg_op = 'UPDATE' and previa ->> 'eliminado_en' is null and fila ->> 'eliminado_en' is not null then v_accion := 'eliminacion'; end if;
  if tg_op = 'UPDATE' and previa ->> 'eliminado_en' is not null and fila ->> 'eliminado_en' is null then v_accion := 'restauracion'; end if;
  v_motivo := coalesce(fila ->> 'motivo_eliminacion', fila ->> 'respuesta', fila ->> 'motivo', fila ->> 'comentario');
  if tg_table_name = 'revisiones_solicitud' and tg_op <> 'DELETE' then
    v_accion := case when fila ->> 'decision' = 'aprobado' then 'aprobacion' else 'rechazo' end;
  elsif tg_table_name = 'solicitudes_edicion' and tg_op <> 'DELETE' then
    v_accion := case when tg_op = 'INSERT' then 'edicion_solicitada' when fila ->> 'estado' = 'aplicada' then 'edicion_aplicada' else 'edicion_rechazada' end;
  elsif tg_table_name = 'solicitudes_ausencia' and fila ->> 'estado' = 'cancelada' and v_accion <> 'eliminacion' then
    v_motivo := fila ->> 'motivo_cancelacion';
    if previa ->> 'estado' is distinct from 'cancelada' then
      v_accion := 'cancelacion';
    elsif tg_op = 'UPDATE' and campos_cambiados <@ array['motivo_cancelacion','cancelado_en','cancelado_por_nombre'] then
      -- 022 guarda el estado y luego el motivo, dentro de la misma transacción.
      update vacaciones.historial_actividad
      set motivo = v_motivo, nuevos = nuevos || despues
      where solicitud_id = v_solicitud and accion = 'cancelacion' and transaccion = txid_current();
      if found then return new; end if;
    end if;
  end if;
  insert into vacaciones.historial_actividad(actor_id,actor_nombre,modulo,entidad,registro_id,solicitud_id,empleado_id,sujeto,accion,motivo,anteriores,nuevos)
  values(v_actor,v_nombre,v_modulo,tg_table_name,v_id,v_solicitud,v_empleado,v_sujeto,v_accion,v_motivo,antes,despues);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function vacaciones.registrar_actividad() from public, anon, authenticated;

do $$
declare item record;
begin
  for item in select * from (values
    ('solicitudes_ausencia','solicitudes'),('revisiones_solicitud','solicitudes'),('solicitudes_edicion','solicitudes'),
    ('empleados','personal'),('perfiles_usuario','accesos'),('asignaciones_ausencia','saldos'),
    ('instantaneas_saldo_ausencia','saldos'),('dias_conservados_solicitud','saldos'),
    ('sedes','catalogos'),('proyectos','catalogos'),('categorias_empleado','catalogos'),('tipos_ausencia','catalogos'),
    ('organizaciones','catalogos'),('horarios_laborales','catalogos'),('dias_horario_laboral','catalogos'),
    ('dias_festivos','festivos'),('lotes_importacion','importaciones'),('incidencias_importacion','importaciones')
  ) as tablas(nombre,modulo) loop
    execute format('drop trigger if exists registrar_actividad on vacaciones.%I', item.nombre);
    execute format('create trigger registrar_actividad after insert or update or delete on vacaciones.%I for each row execute function vacaciones.registrar_actividad(%L)', item.nombre, item.modulo);
  end loop;
end;
$$;

-- Recuperación idempotente: únicamente fuentes anteriores a la instalación.
-- Una segunda ejecución no convierte eventos nuevos en evidencia histórica.
create table if not exists vacaciones.historial_actividad_config (
  id boolean primary key default true check (id), instalado_en timestamptz not null default clock_timestamp()
);
revoke all on vacaciones.historial_actividad_config from public, anon, authenticated;
insert into vacaciones.historial_actividad_config(id) values(true) on conflict do nothing;

insert into vacaciones.historial_actividad(ocurrido_en,actor_nombre,modulo,entidad,registro_id,solicitud_id,empleado_id,sujeto,accion,motivo,anteriores,nuevos,recuperado,clave_origen)
select h.cambiado_en,
  case when h.estado_nuevo = 'cancelada' then coalesce(case when h.cambiado_en = s.cancelado_en then s.cancelado_por_nombre end,'Autor no registrado') else coalesce(nullif(h.cambiado_por,''),'Autor no registrado') end,
  'solicitudes','solicitudes_ausencia',s.id::text,s.id,s.empleado_id,
  e.nombre_completo || ' · ' || to_char(s.fecha_inicio,'DD/MM/YYYY') || ' al ' || to_char(s.fecha_fin,'DD/MM/YYYY'),
  case when h.estado_anterior is null then 'creacion' when h.estado_nuevo = 'cancelada' then 'cancelacion' else 'actualizacion' end,
  case when h.estado_nuevo = 'cancelada' then coalesce(h.comentarios,case when h.cambiado_en = s.cancelado_en then s.motivo_cancelacion end) else h.comentarios end,
  case when h.estado_anterior is null then '{}'::jsonb else jsonb_build_object('estado',h.estado_anterior) end,
  jsonb_build_object('estado',h.estado_nuevo),true,'estado:' || h.id
from vacaciones.historial_estados_solicitud h
join vacaciones.solicitudes_ausencia s on s.id = h.solicitud_ausencia_id
join vacaciones.empleados e on e.id = s.empleado_id
where h.cambiado_en < (select instalado_en from vacaciones.historial_actividad_config)
on conflict(clave_origen) do nothing;

insert into vacaciones.historial_actividad(ocurrido_en,actor_id,actor_nombre,modulo,entidad,registro_id,solicitud_id,empleado_id,sujeto,accion,motivo,nuevos,recuperado,clave_origen)
select r.creado_en,r.usuario_id,coalesce(p.nombre_visible,'Autor no registrado'),
  'solicitudes','revisiones_solicitud',r.id::text,s.id,s.empleado_id,e.nombre_completo,
  case when r.decision = 'aprobado' then 'aprobacion' else 'rechazo' end,r.comentario,
  vacaciones.datos_auditables('revisiones_solicitud',to_jsonb(r)),true,'revision:' || r.id
from vacaciones.revisiones_solicitud r
join vacaciones.solicitudes_ausencia s on s.id = r.solicitud_ausencia_id
join vacaciones.empleados e on e.id = s.empleado_id
left join vacaciones.perfiles_usuario p on p.usuario_id = r.usuario_id
where r.creado_en < (select instalado_en from vacaciones.historial_actividad_config)
on conflict(clave_origen) do nothing;

insert into vacaciones.historial_actividad(ocurrido_en,actor_id,actor_nombre,modulo,entidad,registro_id,solicitud_id,empleado_id,sujeto,accion,motivo,anteriores,nuevos,recuperado,clave_origen)
select ev.fecha,ev.actor,coalesce(ev.nombre,'Autor no registrado'),'solicitudes','solicitudes_edicion',d.id::text,d.solicitud_ausencia_id,d.empleado_id,e.nombre_completo,
  ev.accion,ev.motivo,coalesce(ev.antes,'{}'),coalesce(ev.despues,'{}'),true,ev.clave || d.id
from vacaciones.solicitudes_edicion d join vacaciones.empleados e on e.id = d.empleado_id
cross join lateral (values
  (d.solicitado_en,d.solicitado_por,d.solicitado_por_nombre,'edicion_solicitada',d.motivo,'{}'::jsonb,jsonb_build_object('fecha_inicio_propuesta',d.fecha_inicio_propuesta,'fecha_fin_propuesta',d.fecha_fin_propuesta),'edicion-pedido:'),
  (d.resuelto_en,d.resuelto_por,d.resuelto_por_nombre,case when d.estado = 'aplicada' then 'edicion_aplicada' else 'edicion_rechazada' end,d.respuesta,d.valores_anteriores,d.valores_nuevos,'edicion-respuesta:')
) ev(fecha,actor,nombre,accion,motivo,antes,despues,clave)
where ev.fecha < (select instalado_en from vacaciones.historial_actividad_config)
on conflict(clave_origen) do nothing;

-- Respaldo para cancelaciones con constancia pero sin fila en historial_estados.
insert into vacaciones.historial_actividad(ocurrido_en,actor_id,actor_nombre,modulo,entidad,registro_id,solicitud_id,empleado_id,sujeto,accion,motivo,nuevos,recuperado,clave_origen)
select s.cancelado_en,s.cancelado_por,coalesce(s.cancelado_por_nombre,'Autor no registrado'),'solicitudes','solicitudes_ausencia',s.id::text,s.id,s.empleado_id,e.nombre_completo,'cancelacion',s.motivo_cancelacion,jsonb_build_object('estado','cancelada'),true,'cancelacion:' || s.id
from vacaciones.solicitudes_ausencia s join vacaciones.empleados e on e.id = s.empleado_id
where s.cancelado_en < (select instalado_en from vacaciones.historial_actividad_config)
and not exists(select 1 from vacaciones.historial_actividad h where h.solicitud_id = s.id and h.accion = 'cancelacion')
on conflict(clave_origen) do nothing;

-- Auth vive fuera de las tablas operativas. La API registra solo el tipo de
-- cambio y opciones no secretas; nunca valores de contraseñas o tokens.
create or replace function vacaciones.registrar_cambio_acceso(p_usuario uuid, p_accion text, p_cambios jsonb default '{}')
returns void language plpgsql security definer
set search_path = pg_catalog, vacaciones, auth
as $$
declare v_actor uuid; v_nombre text; v_perfil vacaciones.perfiles_usuario%rowtype; seguros jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Operación exclusiva del servidor'; end if;
  if p_accion not in ('acceso_actualizado','contrasena_restablecida','contrasena_cambiada') then raise exception 'Acción no permitida'; end if;
  v_actor := nullif(coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-vacaciones-actor-id', '')::uuid;
  if v_actor is null then raise exception 'Falta el autor verificado'; end if;
  select nombre_visible into v_nombre from vacaciones.perfiles_usuario where usuario_id = v_actor;
  select * into v_perfil from vacaciones.perfiles_usuario where usuario_id = p_usuario;
  select coalesce(jsonb_object_agg(key,value),'{}') into seguros from jsonb_each(p_cambios)
    where key in ('correoInicioSesion','permitirCambioContrasena','forzarCambioContrasena');
  insert into vacaciones.historial_actividad(actor_id,actor_nombre,modulo,entidad,registro_id,empleado_id,sujeto,accion,nuevos)
  values(v_actor,coalesce(v_nombre,'Usuario sin nombre registrado'),'accesos','perfiles_usuario',p_usuario::text,v_perfil.empleado_id,coalesce(v_perfil.nombre_visible,'Cuenta de acceso'),p_accion,seguros);
end;
$$;
revoke all on function vacaciones.registrar_cambio_acceso(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function vacaciones.registrar_cambio_acceso(uuid,text,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
