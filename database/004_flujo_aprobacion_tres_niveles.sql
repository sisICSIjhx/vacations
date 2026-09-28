-- ICSI OIL & GAS - Sistema de vacaciones
-- Flujo formal de aprobacion en tres niveles: RRHH -> Jefe inmediato -> Mesa directiva
-- PostgreSQL / Supabase
--
-- Convenciones: ver database/001_esquema_inicial.sql. Este archivo es aditivo y
-- seguro de volver a ejecutar; no borra columnas, tablas ni datos existentes.
--
-- Decisiones de diseno (documentadas para quien revise esta migracion):
--   * El campo "estado" de solicitudes_ausencia NO cambia de significado ni de
--     valores permitidos. Sigue siendo el balde grueso que ya usan las vistas
--     de calendario y saldo (planeada/pendiente/aprobada/rechazada/cancelada).
--     Los dias tomados de un empleado se siguen calculando exclusivamente a
--     partir de estado = 'aprobada' (vacaciones.v_saldo_vacaciones_empleado),
--     que solo se alcanza cuando Mesa Directiva aprueba en ultima instancia.
--   * Se agrega una etapa granular (etapa_aprobacion) que indica en que punto
--     del flujo RRHH -> Jefe inmediato -> Mesa directiva esta la solicitud
--     mientras estado sigue en 'pendiente'. Al aprobar o rechazar en cualquier
--     etapa, estado se actualiza igual que antes (a 'aprobada' o 'rechazada'),
--     asi que el calendario, los saldos y el trigger de auditoria existentes
--     (historial_estados_solicitud) siguen funcionando sin cambios.
--   * "Jefe inmediato" no es un rol global: es la relacion empleados.jefe_
--     inmediato_id. Cualquier perfil de usuario vinculado a ese empleado puede
--     revisar la etapa de jefe para sus reportes directos. RRHH y Mesa
--     Directiva si son roles nuevos en perfiles_usuario.rol.
--   * La trazabilidad completa (quien decidio, cuando, que comento, resultado)
--     vive en la nueva tabla revisiones_solicitud: un registro por decision de
--     etapa, en el mismo espiritu que historial_estados_solicitud ya usa para
--     el estado grueso.

begin;

-- ---------------------------------------------------------------------------
-- 1) Jefe inmediato del empleado
-- ---------------------------------------------------------------------------

alter table vacaciones.empleados
  add column if not exists jefe_inmediato_id uuid
    references vacaciones.empleados(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'empleados_jefe_inmediato_no_autorreferencia'
  ) then
    alter table vacaciones.empleados
      add constraint empleados_jefe_inmediato_no_autorreferencia
      check (jefe_inmediato_id is null or jefe_inmediato_id <> id);
  end if;
end;
$$;

create index if not exists empleados_jefe_inmediato_idx
  on vacaciones.empleados (jefe_inmediato_id)
  where jefe_inmediato_id is not null;

comment on column vacaciones.empleados.jefe_inmediato_id is
  'Empleado que actua como jefe inmediato para la etapa 2 de aprobacion de vacaciones. Null si no tiene jefe asignado en el sistema.';

-- ---------------------------------------------------------------------------
-- 2) Roles nuevos: RRHH y Mesa Directiva
-- ---------------------------------------------------------------------------

alter table vacaciones.perfiles_usuario
  drop constraint if exists perfiles_usuario_rol_check;

alter table vacaciones.perfiles_usuario
  add constraint perfiles_usuario_rol_check
  check (rol in ('administrador', 'rrhh', 'mesa_directiva', 'empleado'));

comment on column vacaciones.perfiles_usuario.rol is
  'administrador: acceso total (incluye saltar el flujo de aprobacion). rrhh y mesa_directiva: roles de revision de la etapa homonima. empleado: autoservicio; si ademas es jefe_inmediato_id de otro empleado, puede revisar la etapa de jefe de sus reportes directos.';

-- ---------------------------------------------------------------------------
-- 3) Etapa granular de aprobacion en la solicitud
-- ---------------------------------------------------------------------------

alter table vacaciones.solicitudes_ausencia
  add column if not exists etapa_aprobacion text not null default 'rrhh';

alter table vacaciones.solicitudes_ausencia
  drop constraint if exists solicitudes_ausencia_etapa_aprobacion_check;
alter table vacaciones.solicitudes_ausencia
  add constraint solicitudes_ausencia_etapa_aprobacion_check
  check (etapa_aprobacion in ('rrhh', 'jefe_inmediato', 'mesa_directiva', 'aprobada', 'rechazada'));

alter table vacaciones.solicitudes_ausencia
  add column if not exists etapa_rechazo text;

alter table vacaciones.solicitudes_ausencia
  drop constraint if exists solicitudes_ausencia_etapa_rechazo_check;
alter table vacaciones.solicitudes_ausencia
  add constraint solicitudes_ausencia_etapa_rechazo_check
  check (etapa_rechazo is null or etapa_rechazo in ('rrhh', 'jefe_inmediato', 'mesa_directiva'));

comment on column vacaciones.solicitudes_ausencia.etapa_aprobacion is
  'Etapa actual del flujo mientras estado = pendiente: rrhh, jefe_inmediato o mesa_directiva. Pasa a aprobada/rechazada junto con estado.';
comment on column vacaciones.solicitudes_ausencia.etapa_rechazo is
  'Etapa que rechazo la solicitud (null si fue aprobada o si el rechazo es anterior a este flujo).';

create index if not exists solicitudes_etapa_aprobacion_idx
  on vacaciones.solicitudes_ausencia (etapa_aprobacion)
  where eliminado_en is null;

-- Backfill de solicitudes existentes: no se reinterpreta en que etapa
-- historica quedo cada una (esa informacion no existia antes de este flujo).
-- Las ya resueltas se marcan consistentes con su estado; las que seguian
-- abiertas (planeada/pendiente/cancelada) entran al inicio del flujo nuevo.
update vacaciones.solicitudes_ausencia
set etapa_aprobacion = 'aprobada'
where estado = 'aprobada' and etapa_aprobacion <> 'aprobada';

update vacaciones.solicitudes_ausencia
set etapa_aprobacion = 'rechazada'
where estado = 'rechazada' and etapa_aprobacion <> 'rechazada';

-- ---------------------------------------------------------------------------
-- 4) Trazabilidad: una fila por decision de etapa
-- ---------------------------------------------------------------------------

create table if not exists vacaciones.revisiones_solicitud (
  id uuid primary key default gen_random_uuid(),
  solicitud_ausencia_id uuid not null
    references vacaciones.solicitudes_ausencia(id) on delete cascade,
  etapa text not null check (etapa in ('rrhh', 'jefe_inmediato', 'mesa_directiva')),
  decision text not null check (decision in ('aprobado', 'rechazado')),
  estado_resultante text not null,
  -- Referencia a perfiles_usuario (no directo a auth.users) para que
  -- PostgREST pueda resolver el embed perfiles_usuario(nombre_visible) que
  -- usa el frontend al mostrar el historial. Todo llamador autorizado de
  -- revisar_solicitud ya tiene, por definicion, un perfil activo.
  usuario_id uuid references vacaciones.perfiles_usuario(usuario_id) on delete set null,
  comentario text,
  creado_en timestamptz not null default now()
);

comment on table vacaciones.revisiones_solicitud is
  'Historial inmutable de cada decision de RRHH, Jefe inmediato o Mesa Directiva sobre una solicitud de vacaciones.';

create index if not exists revisiones_solicitud_solicitud_idx
  on vacaciones.revisiones_solicitud (solicitud_ausencia_id, creado_en);

alter table vacaciones.revisiones_solicitud enable row level security;
revoke all on vacaciones.revisiones_solicitud from public;

drop policy if exists acceso_total_administrador on vacaciones.revisiones_solicitud;
create policy acceso_total_administrador
  on vacaciones.revisiones_solicitud
  for all to authenticated
  using (vacaciones.es_administrador())
  with check (vacaciones.es_administrador());

-- No se agrega una policy de INSERT para "authenticated": esta tabla es el
-- registro de auditoria de cada decision, y debe escribirse unicamente desde
-- dentro de vacaciones.revisar_solicitud (security definer, ver mas abajo),
-- nunca por una insercion directa via la Data API. Sin una policy de INSERT
-- para "authenticated", ningun usuario no administrador puede insertar aqui
-- por su cuenta; la funcion sí puede, porque corre con los permisos de su
-- dueno. El administrador conserva insert vía "acceso_total_administrador".

drop policy if exists lectura_revision_interesada on vacaciones.revisiones_solicitud;
create policy lectura_revision_interesada
  on vacaciones.revisiones_solicitud
  for select to authenticated
  using (
    exists (
      select 1
      from vacaciones.solicitudes_ausencia s
      where s.id = solicitud_ausencia_id
        and s.empleado_id = vacaciones.empleado_actual_id()
    )
    or exists (
      select 1 from vacaciones.perfiles_usuario p
      where p.usuario_id = auth.uid()
        and p.activo
        and p.eliminado_en is null
        and p.rol in ('rrhh', 'mesa_directiva')
    )
    or exists (
      select 1
      from vacaciones.perfiles_usuario p
      join vacaciones.solicitudes_ausencia s on s.id = solicitud_ausencia_id
      join vacaciones.empleados e on e.id = s.empleado_id
      where p.usuario_id = auth.uid()
        and p.activo
        and p.eliminado_en is null
        and p.empleado_id is not null
        and p.empleado_id = e.jefe_inmediato_id
    )
  );

-- Solo select para "authenticated": sin policy de insert para ese rol (ver
-- arriba), el grant de insert quedaria sin efecto util y podria confundir a
-- quien audite los permisos. service_role si conserva insert (uso administrativo,
-- omite RLS por diseno de Supabase).
grant select on vacaciones.revisiones_solicitud to authenticated;
grant select, insert on vacaciones.revisiones_solicitud to service_role;

-- ---------------------------------------------------------------------------
-- 5) Vista de calendario: exponer las columnas nuevas
-- ---------------------------------------------------------------------------
-- Mismo cuerpo que en 001_esquema_inicial.sql; solo se agregan columnas al
-- final del select. create or replace view no requiere recrear dependientes.

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
  s.etapa_rechazo
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

-- ---------------------------------------------------------------------------
-- 6) Permisos de lectura para RRHH, Mesa Directiva y Jefe inmediato
-- ---------------------------------------------------------------------------
-- Las vistas de calendario y saldo son security_invoker: basta con exponer las
-- tablas base para que ambas vistas respeten automaticamente estas reglas.

drop policy if exists lectura_solicitud_rrhh_mesa on vacaciones.solicitudes_ausencia;
create policy lectura_solicitud_rrhh_mesa
  on vacaciones.solicitudes_ausencia
  for select to authenticated
  using (
    eliminado_en is null
    and exists (
      select 1 from vacaciones.perfiles_usuario p
      where p.usuario_id = auth.uid()
        and p.activo
        and p.eliminado_en is null
        and p.rol in ('rrhh', 'mesa_directiva')
    )
  );

drop policy if exists lectura_solicitud_jefe_inmediato on vacaciones.solicitudes_ausencia;
create policy lectura_solicitud_jefe_inmediato
  on vacaciones.solicitudes_ausencia
  for select to authenticated
  using (
    eliminado_en is null
    and exists (
      select 1
      from vacaciones.perfiles_usuario p
      join vacaciones.empleados e on e.id = solicitudes_ausencia.empleado_id
      where p.usuario_id = auth.uid()
        and p.activo
        and p.eliminado_en is null
        and p.empleado_id is not null
        and p.empleado_id = e.jefe_inmediato_id
    )
  );

-- IMPORTANTE: una policy de "perfiles_usuario" NUNCA debe consultar
-- "perfiles_usuario" directamente en su USING (aunque sea con otro alias):
-- Postgres tiene que volver a aplicarle RLS a esa subconsulta, lo que fuerza
-- reevaluar la misma policy sobre si misma y termina en
-- "infinite recursion detected in policy for relation perfiles_usuario" para
-- CUALQUIER lectura de la tabla (incluida la que hace el login para saber el
-- rol de quien entra). Por eso, igual que vacaciones.es_administrador() (001),
-- este chequeo se envuelve en una funcion security definer: la funcion sí
-- puede leer la tabla sin reactivar la policy que la esta llamando.
create or replace function vacaciones.tiene_perfil_activo()
returns boolean
language sql
stable
security definer
set search_path = vacaciones, auth, public
as $$
  select exists (
    select 1 from vacaciones.perfiles_usuario p
    where p.usuario_id = auth.uid()
      and p.activo
      and p.eliminado_en is null
  );
$$;

-- Sin esto, el historial de aprobaciones no podria mostrar el nombre de quien
-- decidio en cada etapa cuando el usuario que consulta es distinto de quien
-- decidio: lectura_perfil_propio (001) solo deja ver el perfil propio. El
-- nombre visible y el rol no son datos sensibles; se exponen a cualquier
-- perfil activo, igual que ya ocurre con los catalogos de la organizacion.
drop policy if exists lectura_perfiles_visibles on vacaciones.perfiles_usuario;
create policy lectura_perfiles_visibles
  on vacaciones.perfiles_usuario
  for select to authenticated
  using (
    activo
    and eliminado_en is null
    and vacaciones.tiene_perfil_activo()
  );

drop policy if exists lectura_empleados_rrhh_mesa on vacaciones.empleados;
create policy lectura_empleados_rrhh_mesa
  on vacaciones.empleados
  for select to authenticated
  using (
    eliminado_en is null
    and exists (
      select 1 from vacaciones.perfiles_usuario p
      where p.usuario_id = auth.uid()
        and p.activo
        and p.eliminado_en is null
        and p.rol in ('rrhh', 'mesa_directiva')
    )
  );

drop policy if exists lectura_empleados_reportes_jefe on vacaciones.empleados;
create policy lectura_empleados_reportes_jefe
  on vacaciones.empleados
  for select to authenticated
  using (
    eliminado_en is null
    and exists (
      select 1 from vacaciones.perfiles_usuario p
      where p.usuario_id = auth.uid()
        and p.activo
        and p.eliminado_en is null
        and p.empleado_id = empleados.jefe_inmediato_id
    )
  );

drop policy if exists lectura_asignacion_rrhh_mesa on vacaciones.asignaciones_ausencia;
create policy lectura_asignacion_rrhh_mesa
  on vacaciones.asignaciones_ausencia
  for select to authenticated
  using (
    eliminado_en is null
    and exists (
      select 1 from vacaciones.perfiles_usuario p
      where p.usuario_id = auth.uid()
        and p.activo
        and p.eliminado_en is null
        and p.rol in ('rrhh', 'mesa_directiva')
    )
  );

drop policy if exists lectura_asignacion_reportes_jefe on vacaciones.asignaciones_ausencia;
create policy lectura_asignacion_reportes_jefe
  on vacaciones.asignaciones_ausencia
  for select to authenticated
  using (
    eliminado_en is null
    and exists (
      select 1
      from vacaciones.perfiles_usuario p
      join vacaciones.empleados e on e.id = asignaciones_ausencia.empleado_id
      where p.usuario_id = auth.uid()
        and p.activo
        and p.eliminado_en is null
        and p.empleado_id is not null
        and p.empleado_id = e.jefe_inmediato_id
    )
  );

-- IMPORTANTE: vacaciones.revisar_solicitud y vacaciones.guardar_solicitud_vacaciones
-- se declaran mas abajo como "security definer" (no "security invoker"), a
-- proposito. Se penso primero en "security invoker" mas policies de UPDATE
-- para RRHH/Jefe/Mesa Directiva sobre solicitudes_ausencia/asignaciones_ausencia,
-- pero esa combinacion es insegura en Supabase: el esquema ya tiene
-- "grant ... update ... to authenticated" (ver 001), asi que cualquier policy
-- de UPDATE lo bastante amplia para que la funcion "pase" tambien habilita un
-- PATCH directo por la Data API que se salta por completo la secuencia
-- obligatoria, el chequeo de anticipacion, el de saldo y el registro en
-- revisiones_solicitud. Por eso este archivo NO agrega policies de UPDATE
-- para RRHH/Jefe/Mesa Directiva sobre solicitudes_ausencia ni asignaciones_ausencia:
-- esos roles siguen sin poder tocar esas tablas de forma directa. Las dos
-- funciones, al ser "security definer", corren con los permisos de su dueno y
-- hacen ellas mismas, explicitamente, cada validacion de permiso y de regla de
-- negocio antes de escribir; son el unico camino de escritura para esos roles.

-- El empleado ya podia crear y editar su propia solicitud mientras estuviera
-- planeada/pendiente. Se ajusta para exigir ademas que siga en la primera
-- etapa del flujo: en cuanto RRHH la mueve a jefe_inmediato, el empleado deja
-- de poder editarla (aunque el estado grueso siga en 'pendiente').
drop policy if exists crear_solicitud_propia on vacaciones.solicitudes_ausencia;
create policy crear_solicitud_propia
  on vacaciones.solicitudes_ausencia
  for insert to authenticated
  with check (
    empleado_id = vacaciones.empleado_actual_id()
    and estado in ('planeada', 'pendiente')
    and etapa_aprobacion = 'rrhh'
    and eliminado_en is null
  );

drop policy if exists editar_solicitud_propia on vacaciones.solicitudes_ausencia;
create policy editar_solicitud_propia
  on vacaciones.solicitudes_ausencia
  for update to authenticated
  using (
    empleado_id = vacaciones.empleado_actual_id()
    and estado in ('planeada', 'pendiente')
    and etapa_aprobacion = 'rrhh'
    and eliminado_en is null
  )
  with check (
    empleado_id = vacaciones.empleado_actual_id()
    and estado in ('planeada', 'pendiente', 'cancelada')
    and eliminado_en is null
  );

-- ---------------------------------------------------------------------------
-- 7) RPC: crear o editar una solicitud validando el saldo disponible
-- ---------------------------------------------------------------------------
-- Sustituye el INSERT/UPDATE directo que hacia el frontend para altas nuevas y
-- ediciones mientras la solicitud sigue en RRHH. La validacion de saldo no
-- dependia antes de ningun punto centralizado al crear la solicitud (solo se
-- revisaba al aprobar); ahora se revisa aqui ademas de en cada etapa.

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
    if uso.dias > 0 and not exists (
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
-- 8) RPC: revisar una solicitud en la etapa que corresponde
-- ---------------------------------------------------------------------------
-- Punto unico de escritura para RRHH, Jefe inmediato y Mesa Directiva. Un
-- administrador puede usarla tambien (bypass de permisos, igual que el resto
-- del sistema). "security definer": no existe ninguna policy de UPDATE sobre
-- solicitudes_ausencia/asignaciones_ausencia para RRHH/Jefe/Mesa Directiva (a
-- proposito, ver la nota en la seccion 6), asi que esta funcion es su UNICO
-- camino de escritura, y aqui es donde se hace cumplir, explicitamente, la
-- secuencia obligatoria, el rol o relacion de jefatura, la anticipacion
-- minima y el saldo disponible antes de escribir nada.

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
    if solicitud.fecha_inicio - current_date < 15 then
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
      if uso.dias > 0 and not exists (
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
    etapa_siguiente := 'jefe_inmediato';
    estado_resultante := 'pendiente';
  else
    etapa_siguiente := 'mesa_directiva';
    estado_resultante := 'pendiente';
  end if;

  if estado_resultante = 'aprobada' then
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
-- 9) Sincronizar la RPC administrativa preexistente con la etapa granular
-- ---------------------------------------------------------------------------
-- vacaciones.cambiar_estado_solicitud (001) sigue siendo el camino directo de
-- un administrador para forzar un estado (por ejemplo, cancelar una solicitud
-- aprobada) sin pasar por el flujo de tres etapas; eso es intencional, el
-- administrador ya tiene acceso total en el resto del sistema. Pero su cuerpo
-- original no conocia etapa_aprobacion/etapa_rechazo: dejarla intacta
-- significaria que, por ejemplo, reabrir una solicitud rechazada
-- (estado -> 'pendiente') la dejaria con etapa_aprobacion todavia en
-- 'rechazada', y como vacaciones.revisar_solicitud exige que etapa_aprobacion
-- sea exactamente rrhh/jefe_inmediato/mesa_directiva, esa solicitud quedaria
-- atascada para siempre sin poder volver a pasar por RRHH, Jefe inmediato o
-- Mesa Directiva. Este es, a proposito, el "mecanismo explicito para
-- reabrirla" al que se refieren las reglas de negocio: un administrador
-- reabre moviendo el estado a 'planeada' o 'pendiente', y esta version
-- sincroniza automaticamente la etapa granular al reiniciar el flujo desde
-- RRHH. El resto del cuerpo (calculo y ajuste de dias_disponibles, disparo de
-- historial_estados_solicitud) es identico al original.
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

  if solicitud_actual.estado <> 'aprobada' and p_estado_nuevo = 'aprobada' then
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
  elsif solicitud_actual.estado = 'aprobada' and p_estado_nuevo <> 'aprobada' then
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

commit;

-- Consultas de ejemplo (no se ejecutan)
--
-- 1) Solicitudes pendientes de RRHH:
-- select * from vacaciones.v_dias_solicitud_calendario
-- where etapa_aprobacion = 'rrhh' and estado = 'pendiente';
--
-- 2) Historial completo de revisiones de una solicitud:
-- select r.*, p.nombre_visible
-- from vacaciones.revisiones_solicitud r
-- left join vacaciones.perfiles_usuario p on p.usuario_id = r.usuario_id
-- where r.solicitud_ausencia_id = :solicitud_id
-- order by r.creado_en;
--
-- 3) Aprobar en la etapa que corresponde (el propio usuario autenticado debe
--    tener el rol o la relacion de jefe inmediato correcta; si no, la funcion
--    lanza una excepcion):
-- select vacaciones.revisar_solicitud(:solicitud_id, 'rrhh', 'aprobado', 'Cumple anticipacion.');
-- select vacaciones.revisar_solicitud(:solicitud_id, 'jefe_inmediato', 'aprobado', 'Sin inconvenientes operativos.');
-- select vacaciones.revisar_solicitud(:solicitud_id, 'mesa_directiva', 'aprobado', 'Aprobado.');
--
-- 4) Asignar el jefe inmediato de un empleado:
-- update vacaciones.empleados set jefe_inmediato_id = :jefe_id where id = :empleado_id;
--
-- 5) Dar de alta un usuario de RRHH o Mesa Directiva (requiere el UUID del
--    usuario ya creado en Authentication > Users):
-- insert into vacaciones.perfiles_usuario (usuario_id, empleado_id, nombre_visible, rol, activo)
-- values ('UUID_DEL_USUARIO', null, 'RRHH ICSI', 'rrhh', true)
-- on conflict (usuario_id) do update
-- set nombre_visible = excluded.nombre_visible, rol = excluded.rol, activo = excluded.activo;
