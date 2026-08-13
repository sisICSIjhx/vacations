-- ICSI OIL & GAS - Sistema de vacaciones (MVP administrador)
-- PostgreSQL / Supabase
--
-- Convenciones:
--   * Esquema, tablas, columnas, vistas y funciones propias en espanol.
--   * Palabras reservadas, tipos y funciones nativas conservan la sintaxis SQL.
--   * Supabase Auth se vincula mediante perfiles_usuario sin mezclar identidad y datos laborales.
--   * Una solicitud se almacena como rango; sus dias se generan en una vista.
--   * El saldo operativo disponible se guarda y solo cambia mediante operaciones controladas;
--     los compromisos planeados y pendientes se calculan en las vistas.
--   * DELETE nunca elimina fisicamente datos administrables: los marca con eliminado_en.
--     Los administradores pueden restaurarlos limpiando los campos de eliminacion.

begin;

create extension if not exists pgcrypto;
create schema if not exists vacaciones;

-- Si se consume mediante la API de datos de Supabase, el esquema vacaciones
-- debe agregarse a la lista de esquemas expuestos del proyecto. Con NestJS y
-- conexion directa a PostgreSQL no es necesario exponerlo.

comment on schema vacaciones is
  'Datos y operaciones del sistema administrativo de vacaciones de ICSI.';

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------

create or replace function vacaciones.establecer_fecha_actualizacion()
returns trigger
language plpgsql
set search_path = vacaciones, public
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organizacion y catalogos de filtrado
-- ---------------------------------------------------------------------------

create table if not exists vacaciones.organizaciones (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null,
  zona_horaria text not null default 'America/Mexico_City',
  inicio_semana smallint not null default 1
    check (inicio_semana between 0 and 6),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  eliminado_por uuid,
  motivo_eliminacion text
);

create table if not exists vacaciones.sedes (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null
    references vacaciones.organizaciones(id) on delete cascade,
  codigo text not null,
  nombre text not null,
  zona_horaria text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  eliminado_por uuid,
  motivo_eliminacion text
);

create table if not exists vacaciones.proyectos (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null
    references vacaciones.organizaciones(id) on delete cascade,
  codigo text not null,
  nombre text not null,
  descripcion text,
  fecha_inicio date,
  fecha_fin date,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  eliminado_por uuid,
  motivo_eliminacion text,
  check (fecha_fin is null or fecha_inicio is null or fecha_fin >= fecha_inicio)
);

create table if not exists vacaciones.categorias_empleado (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null
    references vacaciones.organizaciones(id) on delete cascade,
  codigo text not null,
  nombre text not null,
  color text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  eliminado_por uuid,
  motivo_eliminacion text,
  check (color is null or color ~ '^#[0-9A-Fa-f]{6}$')
);

-- La fraccion laboral permite representar, por ejemplo, sabados de medio dia.
create table if not exists vacaciones.horarios_laborales (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null
    references vacaciones.organizaciones(id) on delete cascade,
  codigo text not null,
  nombre text not null,
  predeterminado boolean not null default false,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  eliminado_por uuid,
  motivo_eliminacion text
);

create table if not exists vacaciones.dias_horario_laboral (
  id uuid primary key default gen_random_uuid(),
  horario_laboral_id uuid not null
    references vacaciones.horarios_laborales(id) on delete cascade,
  dia_semana smallint not null check (dia_semana between 0 and 6), -- 0=domingo
  fraccion_laboral numeric(4,2) not null default 0
    check (fraccion_laboral between 0 and 1),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  eliminado_por uuid,
  motivo_eliminacion text
);

create table if not exists vacaciones.empleados (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null
    references vacaciones.organizaciones(id) on delete cascade,
  numero_empleado text not null,
  nombre_completo text not null,
  correo_electronico text,
  curp varchar(18),
  nss varchar(11),
  color_calendario varchar(7) not null default '#2563EB',
  sede_id uuid references vacaciones.sedes(id) on delete set null,
  proyecto_id uuid references vacaciones.proyectos(id) on delete set null,
  categoria_id uuid
    references vacaciones.categorias_empleado(id) on delete set null,
  horario_laboral_id uuid
    references vacaciones.horarios_laborales(id) on delete set null,
  fecha_ingreso date,
  fecha_baja date,
  estado text not null default 'activo'
    check (estado in ('activo', 'inactivo')),
  origen text not null default 'manual'
    check (origen in ('manual', 'csv', 'formulario', 'integracion')),
  clave_empleado_origen text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  eliminado_por uuid,
  motivo_eliminacion text,
  check (curp is null or curp ~ '^[A-Z0-9]{18}$'),
  check (nss is null or nss ~ '^[0-9]{11}$'),
  check (color_calendario ~ '^#[0-9A-Fa-f]{6}$'),
  check (fecha_baja is null or fecha_ingreso is null or fecha_baja >= fecha_ingreso)
);

-- Los indices unicos de empleados (clave de origen, CURP, NSS) y de dias
-- festivos se crean mas abajo, en la seccion de compatibilidad, una vez que
-- eliminado_en ya existe en una instalacion previa. Crearlos aqui fallaria en
-- una base existente, donde CREATE TABLE IF NOT EXISTS no agrega la columna.

comment on column vacaciones.empleados.curp is
  'CURP del empleado en mayusculas. Dato personal; no exponer en vistas de calendario.';

comment on column vacaciones.empleados.nss is
  'Numero de Seguridad Social de 11 digitos. Dato personal; no exponer en vistas de calendario.';

comment on column vacaciones.empleados.color_calendario is
  'Color hexadecimal estable para identificar al empleado en el calendario.';

-- Perfil de acceso vinculado con Supabase Auth. Un administrador puede no estar
-- vinculado a un empleado; el futuro portal del empleado si requiere empleado_id.
create table if not exists vacaciones.perfiles_usuario (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  empleado_id uuid references vacaciones.empleados(id) on delete set null,
  nombre_visible text not null,
  rol text not null default 'empleado'
    check (rol in ('administrador', 'empleado')),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  eliminado_por uuid,
  motivo_eliminacion text
);

-- El MVP crea VACACIONES, pero este catalogo tambien admite incapacidades,
-- permisos, ausencias sin goce y otros tipos futuros.
create table if not exists vacaciones.tipos_ausencia (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null
    references vacaciones.organizaciones(id) on delete cascade,
  codigo text not null,
  nombre text not null,
  color text not null default '#F4B740',
  descuenta_saldo boolean not null default true,
  requiere_aprobacion boolean not null default true,
  metodo_conteo text not null default 'dias_naturales'
    check (metodo_conteo in ('dias_naturales', 'dias_laborales')),
  excluir_dias_festivos boolean not null default false,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  eliminado_por uuid,
  motivo_eliminacion text,
  check (color ~ '^#[0-9A-Fa-f]{6}$')
);

-- ---------------------------------------------------------------------------
-- Importaciones y trazabilidad
-- ---------------------------------------------------------------------------

create table if not exists vacaciones.lotes_importacion (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null
    references vacaciones.organizaciones(id) on delete cascade,
  nombre_archivo text not null,
  hash_sha256 text,
  estado text not null default 'pendiente'
    check (
      estado in (
        'pendiente',
        'procesando',
        'completado',
        'completado_con_errores',
        'fallido'
      )
    ),
  total_filas integer not null default 0 check (total_filas >= 0),
  filas_importadas integer not null default 0 check (filas_importadas >= 0),
  filas_rechazadas integer not null default 0 check (filas_rechazadas >= 0),
  importado_en timestamptz,
  notas text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  eliminado_por uuid,
  motivo_eliminacion text,
  check (hash_sha256 is null or hash_sha256 ~ '^[0-9A-Fa-f]{64}$')
);

create table if not exists vacaciones.incidencias_importacion (
  id bigint generated always as identity primary key,
  lote_importacion_id uuid not null
    references vacaciones.lotes_importacion(id) on delete cascade,
  numero_fila integer,
  gravedad text not null default 'error'
    check (gravedad in ('advertencia', 'error')),
  codigo_incidencia text not null,
  mensaje text not null,
  datos_originales jsonb,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  eliminado_por uuid,
  motivo_eliminacion text,
  check (numero_fila is null or numero_fila > 0)
);

-- ---------------------------------------------------------------------------
-- Asignaciones, saldos y solicitudes
-- ---------------------------------------------------------------------------

-- Un registro por empleado, tipo de ausencia y anio. Los dias utilizados antes
-- del sistema permiten migrar consumos historicos sin inventar solicitudes.
create table if not exists vacaciones.asignaciones_ausencia (
  id uuid primary key default gen_random_uuid(),
  empleado_id uuid not null
    references vacaciones.empleados(id) on delete cascade,
  tipo_ausencia_id uuid not null
    references vacaciones.tipos_ausencia(id) on delete cascade,
  anio_asignacion integer not null check (anio_asignacion between 2000 and 2200),
  dias_por_derecho numeric(8,2) not null default 0
    check (dias_por_derecho >= 0),
  dias_acumulados_a_fecha numeric(8,2) not null default 0
    check (dias_acumulados_a_fecha >= 0),
  dias_disponibles numeric(8,2) not null default 0
    check (dias_disponibles >= 0),
  fecha_corte_saldo date not null default current_date,
  dias_transferidos numeric(8,2) not null default 0 check (dias_transferidos >= 0),
  ajuste_dias numeric(8,2) not null default 0,
  dias_utilizados_antes_sistema numeric(8,2) not null default 0
    check (dias_utilizados_antes_sistema >= 0),
  fecha_vencimiento date,
  notas text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  eliminado_por uuid,
  motivo_eliminacion text,
  unique (empleado_id, tipo_ausencia_id, anio_asignacion)
);

-- Conserva exactamente lo declarado por la persona en el formulario/CSV.
-- Es evidencia de importacion y no sustituye al saldo oficial calculado.
create table if not exists vacaciones.instantaneas_saldo_ausencia (
  id uuid primary key default gen_random_uuid(),
  empleado_id uuid not null
    references vacaciones.empleados(id) on delete cascade,
  tipo_ausencia_id uuid not null
    references vacaciones.tipos_ausencia(id) on delete cascade,
  anio_saldo integer not null check (anio_saldo between 2000 and 2200),
  fecha_captura date not null,
  dias_disponibles_declarados numeric(8,2) not null,
  dias_planeados_declarados numeric(8,2),
  lote_importacion_id uuid
    references vacaciones.lotes_importacion(id) on delete set null,
  numero_fila_origen integer,
  datos_originales jsonb,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  eliminado_por uuid,
  motivo_eliminacion text,
  check (numero_fila_origen is null or numero_fila_origen > 0)
);

-- Un festivo es global si sede_id es null; de lo contrario solo aplica a la sede.
create table if not exists vacaciones.dias_festivos (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null
    references vacaciones.organizaciones(id) on delete cascade,
  sede_id uuid references vacaciones.sedes(id) on delete cascade,
  fecha date not null,
  nombre text not null,
  fraccion_dia numeric(4,2) not null default 1
    check (fraccion_dia > 0 and fraccion_dia <= 1),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  eliminado_por uuid,
  motivo_eliminacion text
);

-- Indices unicos de dias_festivos: ver nota junto a la creacion de la tabla
-- empleados, mas arriba. Se crean en la seccion de compatibilidad.

create table if not exists vacaciones.solicitudes_ausencia (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null
    references vacaciones.organizaciones(id) on delete cascade,
  empleado_id uuid not null
    references vacaciones.empleados(id) on delete cascade,
  tipo_ausencia_id uuid not null
    references vacaciones.tipos_ausencia(id) on delete restrict,
  estado text not null default 'planeada'
    check (estado in ('planeada', 'pendiente', 'aprobada', 'rechazada', 'cancelada')),
  fecha_inicio date not null,
  fecha_fin date not null,
  fecha_reintegro date,
  fraccion_primer_dia numeric(4,2) not null default 1
    check (fraccion_primer_dia > 0 and fraccion_primer_dia <= 1),
  fraccion_ultimo_dia numeric(4,2) not null default 1
    check (fraccion_ultimo_dia > 0 and fraccion_ultimo_dia <= 1),
  comentarios text,
  solicitado_en timestamptz,
  resuelto_en timestamptz,
  resuelto_por text,
  origen text not null default 'administrador'
    check (origen in ('administrador', 'csv', 'formulario', 'empleado', 'integracion')),
  lote_importacion_id uuid
    references vacaciones.lotes_importacion(id) on delete set null,
  numero_fila_origen integer,
  clave_registro_origen text,
  datos_originales jsonb,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  eliminado_por uuid,
  motivo_eliminacion text,
  check (fecha_fin >= fecha_inicio),
  check (fecha_reintegro is null or fecha_reintegro > fecha_fin),
  check (fecha_inicio <> fecha_fin or fraccion_primer_dia = fraccion_ultimo_dia),
  check (numero_fila_origen is null or numero_fila_origen > 0)
);

create table if not exists vacaciones.historial_estados_solicitud (
  id bigint generated always as identity primary key,
  solicitud_ausencia_id uuid not null
    references vacaciones.solicitudes_ausencia(id) on delete cascade,
  estado_anterior text,
  estado_nuevo text not null,
  cambiado_en timestamptz not null default now(),
  cambiado_por text,
  comentarios text,
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  eliminado_por uuid,
  motivo_eliminacion text,
  check (
    estado_anterior is null
    or estado_anterior in ('planeada', 'pendiente', 'aprobada', 'rechazada', 'cancelada')
  ),
  check (estado_nuevo in ('planeada', 'pendiente', 'aprobada', 'rechazada', 'cancelada'))
);

-- ---------------------------------------------------------------------------
-- Compatibilidad con instalaciones existentes y unicidad de registros activos
-- ---------------------------------------------------------------------------

-- CREATE TABLE IF NOT EXISTS no agrega columnas a una instalacion previa. Este
-- bloque hace que el mismo archivo sirva tanto para instalaciones nuevas como
-- para actualizar una base existente sin perder datos.
do $$
declare
  nombre_tabla text;
begin
  foreach nombre_tabla in array array[
    'organizaciones',
    'sedes',
    'proyectos',
    'categorias_empleado',
    'horarios_laborales',
    'dias_horario_laboral',
    'empleados',
    'perfiles_usuario',
    'tipos_ausencia',
    'lotes_importacion',
    'incidencias_importacion',
    'asignaciones_ausencia',
    'instantaneas_saldo_ausencia',
    'dias_festivos',
    'solicitudes_ausencia',
    'historial_estados_solicitud'
  ]
  loop
    execute format(
      'alter table vacaciones.%I '
      'add column if not exists actualizado_en timestamptz not null default now()',
      nombre_tabla
    );
    execute format(
      'alter table vacaciones.%I '
      'add column if not exists eliminado_en timestamptz',
      nombre_tabla
    );
    execute format(
      'alter table vacaciones.%I '
      'add column if not exists eliminado_por uuid',
      nombre_tabla
    );
    execute format(
      'alter table vacaciones.%I '
      'add column if not exists motivo_eliminacion text',
      nombre_tabla
    );
  end loop;
end;
$$;

-- La tabla de dias usaba una llave primaria natural. Se agrega un id para que
-- un dia eliminado pueda volver a crearse sin reciclar el registro historico.
alter table vacaciones.dias_horario_laboral
  add column if not exists id uuid default gen_random_uuid();
alter table vacaciones.dias_horario_laboral
  alter column id set not null;
alter table vacaciones.dias_horario_laboral
  drop constraint if exists dias_horario_laboral_pkey;
alter table vacaciones.dias_horario_laboral
  add constraint dias_horario_laboral_pkey primary key (id);

-- Las restricciones UNIQUE tradicionales tambien consideran registros
-- eliminados. Se sustituyen por indices parciales: solo los activos compiten.
alter table vacaciones.organizaciones
  drop constraint if exists organizaciones_codigo_key;
alter table vacaciones.sedes
  drop constraint if exists sedes_organizacion_id_codigo_key;
alter table vacaciones.proyectos
  drop constraint if exists proyectos_organizacion_id_codigo_key;
alter table vacaciones.categorias_empleado
  drop constraint if exists categorias_empleado_organizacion_id_codigo_key;
alter table vacaciones.horarios_laborales
  drop constraint if exists horarios_laborales_organizacion_id_codigo_key;
alter table vacaciones.empleados
  drop constraint if exists empleados_organizacion_id_numero_empleado_key;
alter table vacaciones.perfiles_usuario
  drop constraint if exists perfiles_usuario_empleado_id_key;
alter table vacaciones.tipos_ausencia
  drop constraint if exists tipos_ausencia_organizacion_id_codigo_key;
alter table vacaciones.instantaneas_saldo_ausencia
  drop constraint if exists instantaneas_saldo_ausencia_empleado_id_tipo_ausencia_id_anio_key;
alter table vacaciones.instantaneas_saldo_ausencia
  drop constraint if exists instantaneas_saldo_ausencia_empleado_id_tipo_ausencia_id_anio_saldo_fecha_captura_lote_importacion_id_key;

-- PostgreSQL trunca identificadores largos a 63 caracteres. Este bloque retira
-- las dos restricciones anteriores aunque su nombre haya quedado truncado.
do $$
declare
  restriccion record;
begin
  for restriccion in
    select conrelid::regclass as tabla, conname
    from pg_constraint
    where contype = 'u'
      and (
        (conrelid = 'vacaciones.instantaneas_saldo_ausencia'::regclass
          and conname like 'instantaneas_saldo_ausencia_empleado_id_tipo_ausencia_id_anio%')
      )
  loop
    execute format(
      'alter table %s drop constraint %I',
      restriccion.tabla,
      restriccion.conname
    );
  end loop;
end;
$$;

create unique index if not exists organizaciones_codigo_activo_unico_idx
  on vacaciones.organizaciones (codigo)
  where eliminado_en is null;
create unique index if not exists sedes_codigo_activo_unico_idx
  on vacaciones.sedes (organizacion_id, codigo)
  where eliminado_en is null;
create unique index if not exists proyectos_codigo_activo_unico_idx
  on vacaciones.proyectos (organizacion_id, codigo)
  where eliminado_en is null;
create unique index if not exists categorias_codigo_activo_unico_idx
  on vacaciones.categorias_empleado (organizacion_id, codigo)
  where eliminado_en is null;
create unique index if not exists horarios_codigo_activo_unico_idx
  on vacaciones.horarios_laborales (organizacion_id, codigo)
  where eliminado_en is null;
create unique index if not exists dias_horario_activo_unico_idx
  on vacaciones.dias_horario_laboral (horario_laboral_id, dia_semana)
  where eliminado_en is null;
create unique index if not exists empleados_numero_activo_unico_idx
  on vacaciones.empleados (organizacion_id, numero_empleado)
  where eliminado_en is null;
create unique index if not exists perfiles_empleado_activo_unico_idx
  on vacaciones.perfiles_usuario (empleado_id)
  where empleado_id is not null and eliminado_en is null;
create unique index if not exists tipos_ausencia_codigo_activo_unico_idx
  on vacaciones.tipos_ausencia (organizacion_id, codigo)
  where eliminado_en is null;
create unique index if not exists instantaneas_saldo_activas_unicas_idx
  on vacaciones.instantaneas_saldo_ausencia (
    empleado_id,
    tipo_ausencia_id,
    anio_saldo,
    fecha_captura,
    lote_importacion_id
  )
  nulls not distinct
  where eliminado_en is null;

drop index if exists vacaciones.empleados_clave_origen_unica_idx;
create unique index empleados_clave_origen_unica_idx
  on vacaciones.empleados (organizacion_id, origen, clave_empleado_origen)
  where clave_empleado_origen is not null and eliminado_en is null;

drop index if exists vacaciones.empleados_curp_unica_idx;
create unique index empleados_curp_unica_idx
  on vacaciones.empleados (organizacion_id, curp)
  where curp is not null and eliminado_en is null;

drop index if exists vacaciones.empleados_nss_unico_idx;
create unique index empleados_nss_unico_idx
  on vacaciones.empleados (organizacion_id, nss)
  where nss is not null and eliminado_en is null;

drop index if exists vacaciones.dias_festivos_globales_unicos_idx;
create unique index dias_festivos_globales_unicos_idx
  on vacaciones.dias_festivos (organizacion_id, fecha, nombre)
  where sede_id is null and eliminado_en is null;

drop index if exists vacaciones.dias_festivos_sede_unicos_idx;
create unique index dias_festivos_sede_unicos_idx
  on vacaciones.dias_festivos (organizacion_id, sede_id, fecha, nombre)
  where sede_id is not null and eliminado_en is null;

create or replace function vacaciones.registrar_estado_solicitud()
returns trigger
language plpgsql
set search_path = vacaciones, public
as $$
begin
  if tg_op = 'INSERT' then
    insert into vacaciones.historial_estados_solicitud (
      solicitud_ausencia_id,
      estado_anterior,
      estado_nuevo,
      cambiado_por
    ) values (
      new.id,
      null,
      new.estado,
      new.resuelto_por
    );
  elsif new.estado is distinct from old.estado then
    insert into vacaciones.historial_estados_solicitud (
      solicitud_ausencia_id,
      estado_anterior,
      estado_nuevo,
      cambiado_por
    ) values (
      new.id,
      old.estado,
      new.estado,
      new.resuelto_por
    );
  end if;

  return new;
end;
$$;

drop trigger if exists auditar_estado_solicitud
  on vacaciones.solicitudes_ausencia;

create trigger auditar_estado_solicitud
after insert or update of estado on vacaciones.solicitudes_ausencia
for each row execute function vacaciones.registrar_estado_solicitud();

-- ---------------------------------------------------------------------------
-- Indices para calendario, filtros y rangos
-- ---------------------------------------------------------------------------

create index if not exists empleados_filtros_idx
  on vacaciones.empleados (
    organizacion_id,
    estado,
    sede_id,
    proyecto_id,
    categoria_id
  );

create index if not exists empleados_nombre_idx
  on vacaciones.empleados (organizacion_id, nombre_completo);

create index if not exists solicitudes_empleado_estado_idx
  on vacaciones.solicitudes_ausencia (
    empleado_id,
    estado,
    fecha_inicio,
    fecha_fin
  );

create index if not exists solicitudes_organizacion_fechas_idx
  on vacaciones.solicitudes_ausencia (
    organizacion_id,
    fecha_inicio,
    fecha_fin
  );

create index if not exists solicitudes_rango_fechas_idx
  on vacaciones.solicitudes_ausencia
  using gist (daterange(fecha_inicio, fecha_fin, '[]'));

-- Hace idempotente la importacion: volver a cargar el mismo archivo no duplica
-- solicitudes creadas a partir de una fila y periodo ya procesados.
drop index if exists vacaciones.solicitudes_clave_origen_unica_idx;
create unique index solicitudes_clave_origen_unica_idx
  on vacaciones.solicitudes_ausencia (organizacion_id, clave_registro_origen);

create index if not exists lotes_hash_busqueda_idx
  on vacaciones.lotes_importacion (organizacion_id, hash_sha256)
  where hash_sha256 is not null and eliminado_en is null;

create index if not exists asignaciones_busqueda_idx
  on vacaciones.asignaciones_ausencia (
    empleado_id,
    anio_asignacion,
    tipo_ausencia_id
  );

create index if not exists dias_festivos_busqueda_idx
  on vacaciones.dias_festivos (organizacion_id, sede_id, fecha);

create index if not exists incidencias_lote_idx
  on vacaciones.incidencias_importacion (lote_importacion_id, numero_fila);

-- ---------------------------------------------------------------------------
-- Vistas de calendario y saldos
-- ---------------------------------------------------------------------------

-- Sustituye las columnas Dia 1, Dia 2, ... del CSV. Conserva cada dia del rango
-- para pintar el calendario, aunque no descuente saldo por horario o festivo.
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
  s.actualizado_en
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

create or replace view vacaciones.v_resumen_diario_calendario
with (security_invoker = true)
as
select
  organizacion_id,
  fecha_calendario,
  count(distinct empleado_id) filter (
    where estado in ('planeada', 'pendiente', 'aprobada')
  ) as empleados_ausentes,
  count(distinct empleado_id) filter (
    where estado = 'planeada'
  ) as empleados_planeados,
  count(distinct empleado_id) filter (
    where estado = 'pendiente'
  ) as empleados_pendientes,
  count(distinct empleado_id) filter (
    where estado = 'aprobada'
  ) as empleados_aprobados
from vacaciones.v_dias_solicitud_calendario
group by organizacion_id, fecha_calendario;

create or replace view vacaciones.v_saldo_vacaciones_empleado
with (security_invoker = true)
as
with uso_por_anio as (
  select
    empleado_id,
    tipo_ausencia_id,
    extract(year from fecha_calendario)::integer as anio_asignacion,
    count(distinct solicitud_ausencia_id) filter (
      where estado in ('planeada', 'pendiente', 'aprobada')
    ) as cantidad_solicitudes,
    coalesce(sum(dias_descontados) filter (where estado = 'planeada'), 0)
      as dias_planeados,
    coalesce(sum(dias_descontados) filter (where estado = 'pendiente'), 0)
      as dias_pendientes,
    coalesce(sum(dias_descontados) filter (where estado = 'aprobada'), 0)
      as dias_aprobados
  from vacaciones.v_dias_solicitud_calendario
  where descuenta_saldo
  group by
    empleado_id,
    tipo_ausencia_id,
    extract(year from fecha_calendario)::integer
)
select
  a.id as asignacion_ausencia_id,
  e.organizacion_id,
  a.empleado_id,
  e.numero_empleado,
  e.nombre_completo,
  e.color_calendario,
  e.sede_id,
  se.nombre as nombre_sede,
  e.proyecto_id,
  p.nombre as nombre_proyecto,
  e.categoria_id,
  c.nombre as nombre_categoria,
  a.tipo_ausencia_id,
  ta.codigo as codigo_tipo_ausencia,
  ta.nombre as nombre_tipo_ausencia,
  a.anio_asignacion,
  a.dias_por_derecho,
  a.dias_acumulados_a_fecha,
  a.dias_disponibles,
  a.fecha_corte_saldo,
  a.dias_transferidos,
  a.ajuste_dias,
  a.dias_utilizados_antes_sistema,
  (a.dias_por_derecho + a.dias_transferidos + a.ajuste_dias)::numeric(8,2)
    as total_dias_por_derecho,
  coalesce(u.cantidad_solicitudes, 0) as cantidad_solicitudes,
  (coalesce(u.cantidad_solicitudes, 0) > 0) as solicito_vacaciones,
  coalesce(u.dias_planeados, 0)::numeric(8,2) as dias_planeados,
  coalesce(u.dias_pendientes, 0)::numeric(8,2) as dias_pendientes,
  coalesce(u.dias_aprobados, 0)::numeric(8,2) as dias_tomados_anio,
  a.dias_disponibles::numeric(8,2) as dias_restantes_despues_aprobadas,
  (
    a.dias_disponibles
    - coalesce(u.dias_pendientes, 0)
    - coalesce(u.dias_planeados, 0)
  )::numeric(8,2) as dias_restantes_despues_compromisos
from vacaciones.asignaciones_ausencia a
join vacaciones.empleados e
  on e.id = a.empleado_id
join vacaciones.organizaciones o
  on o.id = e.organizacion_id
 and o.eliminado_en is null
join vacaciones.tipos_ausencia ta
  on ta.id = a.tipo_ausencia_id
left join vacaciones.sedes se
  on se.id = e.sede_id
 and se.eliminado_en is null
left join vacaciones.proyectos p
  on p.id = e.proyecto_id
 and p.eliminado_en is null
left join vacaciones.categorias_empleado c
  on c.id = e.categoria_id
 and c.eliminado_en is null
left join uso_por_anio u
  on u.empleado_id = a.empleado_id
 and u.tipo_ausencia_id = a.tipo_ausencia_id
 and u.anio_asignacion = a.anio_asignacion
where a.eliminado_en is null
  and e.eliminado_en is null
  and ta.eliminado_en is null;

-- Funcion RPC para obtener los contadores diarios con filtros combinables.
create or replace function vacaciones.obtener_resumen_diario_calendario(
  p_organizacion_id uuid,
  p_desde date,
  p_hasta date,
  p_empleados_ids uuid[] default null,
  p_sedes_ids uuid[] default null,
  p_proyectos_ids uuid[] default null,
  p_categorias_ids uuid[] default null,
  p_estados text[] default array['planeada', 'pendiente', 'aprobada']::text[]
)
returns table (
  fecha_calendario date,
  empleados_ausentes bigint,
  empleados_planeados bigint,
  empleados_pendientes bigint,
  empleados_aprobados bigint,
  personas jsonb
)
language sql
stable
security invoker
set search_path = vacaciones, public
as $$
  with datos_filtrados as (
    select *
    from vacaciones.v_dias_solicitud_calendario d
    where d.organizacion_id = p_organizacion_id
      and d.fecha_calendario between p_desde and p_hasta
      and d.estado = any(p_estados)
      and (p_empleados_ids is null or d.empleado_id = any(p_empleados_ids))
      and (p_sedes_ids is null or d.sede_id = any(p_sedes_ids))
      and (p_proyectos_ids is null or d.proyecto_id = any(p_proyectos_ids))
      and (p_categorias_ids is null or d.categoria_id = any(p_categorias_ids))
  ),
  persona_por_dia as (
    select
      d.fecha_calendario,
      d.empleado_id,
      max(d.nombre_completo) as nombre_completo,
      array_agg(distinct d.estado) as estados
    from datos_filtrados d
    group by d.fecha_calendario, d.empleado_id
  )
  select
    d.fecha_calendario,
    count(*)::bigint as empleados_ausentes,
    count(*) filter (where 'planeada' = any(d.estados))::bigint
      as empleados_planeados,
    count(*) filter (where 'pendiente' = any(d.estados))::bigint
      as empleados_pendientes,
    count(*) filter (where 'aprobada' = any(d.estados))::bigint
      as empleados_aprobados,
    jsonb_agg(
      jsonb_build_object(
        'empleado_id', d.empleado_id,
        'nombre_completo', d.nombre_completo,
        'estados', d.estados
      ) order by d.nombre_completo
    ) as personas
  from persona_por_dia d
  group by d.fecha_calendario
  order by d.fecha_calendario;
$$;

-- Funciones auxiliares de identidad. Se declaran antes de las RPC que las usan.
create or replace function vacaciones.es_administrador()
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
      and p.rol = 'administrador'
      and p.activo
      and p.eliminado_en is null
  );
$$;

create or replace function vacaciones.empleado_actual_id()
returns uuid
language sql
stable
security definer
set search_path = vacaciones, auth, public
as $$
  select p.empleado_id
  from vacaciones.perfiles_usuario p
  where p.usuario_id = auth.uid()
    and p.activo
    and p.eliminado_en is null
  limit 1;
$$;

-- RPC administrativa para registrar tambien el motivo. p_tabla solo acepta
-- tablas conocidas; no se concatena ningun nombre proporcionado sin validarlo.
create or replace function vacaciones.eliminar_registro(
  p_tabla text,
  p_id text,
  p_motivo text default null
)
returns boolean
language plpgsql
security invoker
set search_path = vacaciones, auth, public
as $$
declare
  columna_id text;
  filas_afectadas integer;
  tablas_permitidas constant text[] := array[
    'organizaciones',
    'sedes',
    'proyectos',
    'categorias_empleado',
    'horarios_laborales',
    'dias_horario_laboral',
    'empleados',
    'perfiles_usuario',
    'tipos_ausencia',
    'lotes_importacion',
    'incidencias_importacion',
    'asignaciones_ausencia',
    'instantaneas_saldo_ausencia',
    'dias_festivos',
    'solicitudes_ausencia',
    'historial_estados_solicitud'
  ];
begin
  if not vacaciones.es_administrador() then
    raise exception 'Solo un administrador puede eliminar registros.';
  end if;
  if not (p_tabla = any(tablas_permitidas)) then
    raise exception 'Tabla no permitida para borrado logico: %', p_tabla;
  end if;

  columna_id := case
    when p_tabla = 'perfiles_usuario' then 'usuario_id'
    else 'id'
  end;

  execute format(
    'update vacaciones.%I '
    'set eliminado_en = now(), eliminado_por = auth.uid(), motivo_eliminacion = $2 '
    'where %I::text = $1 and eliminado_en is null',
    p_tabla,
    columna_id
  ) using p_id, p_motivo;

  get diagnostics filas_afectadas = row_count;
  return filas_afectadas = 1;
end;
$$;

create or replace function vacaciones.restaurar_registro(
  p_tabla text,
  p_id text
)
returns boolean
language plpgsql
security invoker
set search_path = vacaciones, auth, public
as $$
declare
  columna_id text;
  filas_afectadas integer;
  tablas_permitidas constant text[] := array[
    'organizaciones',
    'sedes',
    'proyectos',
    'categorias_empleado',
    'horarios_laborales',
    'dias_horario_laboral',
    'empleados',
    'perfiles_usuario',
    'tipos_ausencia',
    'lotes_importacion',
    'incidencias_importacion',
    'asignaciones_ausencia',
    'instantaneas_saldo_ausencia',
    'dias_festivos',
    'solicitudes_ausencia',
    'historial_estados_solicitud'
  ];
begin
  if not vacaciones.es_administrador() then
    raise exception 'Solo un administrador puede restaurar registros.';
  end if;
  if not (p_tabla = any(tablas_permitidas)) then
    raise exception 'Tabla no permitida para restauracion: %', p_tabla;
  end if;

  columna_id := case
    when p_tabla = 'perfiles_usuario' then 'usuario_id'
    else 'id'
  end;

  execute format(
    'update vacaciones.%I '
    'set eliminado_en = null, eliminado_por = null, motivo_eliminacion = null '
    'where %I::text = $1 and eliminado_en is not null',
    p_tabla,
    columna_id
  ) using p_id;

  get diagnostics filas_afectadas = row_count;
  return filas_afectadas = 1;
end;
$$;

-- Cambia el estado de forma atomica y mantiene el saldo disponible. El
-- frontend administrativo debe usar esta RPC para aprobar o revertir una
-- solicitud, en vez de actualizar el estado directamente.
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

  update vacaciones.solicitudes_ausencia
  set estado = p_estado_nuevo,
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
-- Disparadores de auditoria, actualizado_en y borrado logico
-- ---------------------------------------------------------------------------

-- Intercepta DELETE y lo transforma en UPDATE. Se conserva DELETE en los
-- permisos para que clientes REST existentes no tengan que cambiar de verbo.
-- Las eliminaciones fisicas provocadas internamente por una cascada se permiten
-- (por ejemplo, al borrar definitivamente un usuario desde Supabase Auth).
create or replace function vacaciones.aplicar_borrado_logico()
returns trigger
language plpgsql
set search_path = vacaciones, auth, public
as $$
declare
  columna_id text;
  valor_id text;
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;

  columna_id := case
    when tg_table_name = 'perfiles_usuario' then 'usuario_id'
    else 'id'
  end;
  valor_id := to_jsonb(old) ->> columna_id;

  execute format(
    'update %I.%I '
    'set eliminado_en = coalesce(eliminado_en, now()), '
    '    eliminado_por = coalesce(eliminado_por, auth.uid()) '
    'where %I::text = $1',
    tg_table_schema,
    tg_table_name,
    columna_id
  ) using valor_id;

  -- RETURN NULL cancela el DELETE original; el UPDATE anterior queda aplicado.
  return null;
end;
$$;

-- Una solicitud aprobada ya desconto saldo. Borrarla lo reintegra antes de que
-- desaparezca de la vista operativa; restaurarla vuelve a descontarlo despues.
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
     and old.estado = 'aprobada' then
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
     and new.estado = 'aprobada' then
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

do $$
declare
  nombre_tabla text;
begin
  foreach nombre_tabla in array array[
    'organizaciones',
    'sedes',
    'proyectos',
    'categorias_empleado',
    'horarios_laborales',
    'dias_horario_laboral',
    'empleados',
    'perfiles_usuario',
    'tipos_ausencia',
    'lotes_importacion',
    'incidencias_importacion',
    'asignaciones_ausencia',
    'instantaneas_saldo_ausencia',
    'dias_festivos',
    'solicitudes_ausencia',
    'historial_estados_solicitud'
  ]
  loop
    execute format(
      'drop trigger if exists establecer_actualizado_en on vacaciones.%I',
      nombre_tabla
    );
    execute format(
      'create trigger establecer_actualizado_en '
      'before update on vacaciones.%I '
      'for each row execute function vacaciones.establecer_fecha_actualizacion()',
      nombre_tabla
    );
  end loop;
end;
$$;

drop trigger if exists ajustar_saldo_antes_borrado
  on vacaciones.solicitudes_ausencia;
create trigger ajustar_saldo_antes_borrado
before update of eliminado_en on vacaciones.solicitudes_ausencia
for each row execute function vacaciones.ajustar_saldo_borrado_solicitud();

drop trigger if exists ajustar_saldo_despues_restauracion
  on vacaciones.solicitudes_ausencia;
create trigger ajustar_saldo_despues_restauracion
after update of eliminado_en on vacaciones.solicitudes_ausencia
for each row execute function vacaciones.ajustar_saldo_restauracion_solicitud();

do $$
declare
  nombre_tabla text;
begin
  foreach nombre_tabla in array array[
    'organizaciones',
    'sedes',
    'proyectos',
    'categorias_empleado',
    'horarios_laborales',
    'dias_horario_laboral',
    'empleados',
    'perfiles_usuario',
    'tipos_ausencia',
    'lotes_importacion',
    'incidencias_importacion',
    'asignaciones_ausencia',
    'instantaneas_saldo_ausencia',
    'dias_festivos',
    'solicitudes_ausencia',
    'historial_estados_solicitud'
  ]
  loop
    execute format(
      'drop trigger if exists borrado_logico on vacaciones.%I',
      nombre_tabla
    );
    execute format(
      'create trigger borrado_logico '
      'before delete on vacaciones.%I '
      'for each row execute function vacaciones.aplicar_borrado_logico()',
      nombre_tabla
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Seguridad Supabase
-- ---------------------------------------------------------------------------

alter table vacaciones.organizaciones enable row level security;
alter table vacaciones.sedes enable row level security;
alter table vacaciones.proyectos enable row level security;
alter table vacaciones.categorias_empleado enable row level security;
alter table vacaciones.horarios_laborales enable row level security;
alter table vacaciones.dias_horario_laboral enable row level security;
alter table vacaciones.empleados enable row level security;
alter table vacaciones.perfiles_usuario enable row level security;
alter table vacaciones.tipos_ausencia enable row level security;
alter table vacaciones.lotes_importacion enable row level security;
alter table vacaciones.incidencias_importacion enable row level security;
alter table vacaciones.asignaciones_ausencia enable row level security;
alter table vacaciones.instantaneas_saldo_ausencia enable row level security;
alter table vacaciones.dias_festivos enable row level security;
alter table vacaciones.solicitudes_ausencia enable row level security;
alter table vacaciones.historial_estados_solicitud enable row level security;

revoke all on schema vacaciones from public;
revoke execute on all functions in schema vacaciones from public;

-- Acceso completo para administradores autenticados. Las politicas por tabla
-- se combinan con las politicas de autoservicio del futuro portal del empleado.
do $$
declare
  nombre_tabla text;
begin
  foreach nombre_tabla in array array[
    'organizaciones',
    'sedes',
    'proyectos',
    'categorias_empleado',
    'horarios_laborales',
    'dias_horario_laboral',
    'empleados',
    'perfiles_usuario',
    'tipos_ausencia',
    'lotes_importacion',
    'incidencias_importacion',
    'asignaciones_ausencia',
    'instantaneas_saldo_ausencia',
    'dias_festivos',
    'solicitudes_ausencia',
    'historial_estados_solicitud'
  ]
  loop
    execute format(
      'drop policy if exists acceso_total_administrador on vacaciones.%I',
      nombre_tabla
    );
    execute format(
      'create policy acceso_total_administrador on vacaciones.%I '
      'for all to authenticated '
      'using (vacaciones.es_administrador()) '
      'with check (vacaciones.es_administrador())',
      nombre_tabla
    );
  end loop;
end;
$$;

-- Catalogos visibles para cualquier usuario autenticado.
do $$
declare
  nombre_tabla text;
begin
  foreach nombre_tabla in array array[
    'organizaciones',
    'sedes',
    'proyectos',
    'categorias_empleado',
    'horarios_laborales',
    'dias_horario_laboral',
    'tipos_ausencia',
    'dias_festivos'
  ]
  loop
    execute format(
      'drop policy if exists lectura_usuario_autenticado on vacaciones.%I',
      nombre_tabla
    );
    execute format(
      'create policy lectura_usuario_autenticado on vacaciones.%I '
      'for select to authenticated using (eliminado_en is null)',
      nombre_tabla
    );
  end loop;
end;
$$;

drop policy if exists lectura_perfil_propio on vacaciones.perfiles_usuario;
create policy lectura_perfil_propio
  on vacaciones.perfiles_usuario
  for select to authenticated
  using (usuario_id = auth.uid() and eliminado_en is null);

drop policy if exists lectura_empleado_propio on vacaciones.empleados;
create policy lectura_empleado_propio
  on vacaciones.empleados
  for select to authenticated
  using (id = vacaciones.empleado_actual_id() and eliminado_en is null);

drop policy if exists lectura_asignacion_propia on vacaciones.asignaciones_ausencia;
create policy lectura_asignacion_propia
  on vacaciones.asignaciones_ausencia
  for select to authenticated
  using (
    empleado_id = vacaciones.empleado_actual_id()
    and eliminado_en is null
  );

drop policy if exists lectura_instantanea_propia
  on vacaciones.instantaneas_saldo_ausencia;
create policy lectura_instantanea_propia
  on vacaciones.instantaneas_saldo_ausencia
  for select to authenticated
  using (
    empleado_id = vacaciones.empleado_actual_id()
    and eliminado_en is null
  );

drop policy if exists lectura_solicitud_propia on vacaciones.solicitudes_ausencia;
create policy lectura_solicitud_propia
  on vacaciones.solicitudes_ausencia
  for select to authenticated
  using (
    empleado_id = vacaciones.empleado_actual_id()
    and eliminado_en is null
  );

drop policy if exists crear_solicitud_propia on vacaciones.solicitudes_ausencia;
create policy crear_solicitud_propia
  on vacaciones.solicitudes_ausencia
  for insert to authenticated
  with check (
    empleado_id = vacaciones.empleado_actual_id()
    and estado in ('planeada', 'pendiente')
    and eliminado_en is null
  );

drop policy if exists editar_solicitud_propia on vacaciones.solicitudes_ausencia;
create policy editar_solicitud_propia
  on vacaciones.solicitudes_ausencia
  for update to authenticated
  using (
    empleado_id = vacaciones.empleado_actual_id()
    and estado in ('planeada', 'pendiente')
    and eliminado_en is null
  )
  with check (
    empleado_id = vacaciones.empleado_actual_id()
    and estado in ('planeada', 'pendiente', 'cancelada')
    and eliminado_en is null
  );

drop policy if exists lectura_historial_propio
  on vacaciones.historial_estados_solicitud;
create policy lectura_historial_propio
  on vacaciones.historial_estados_solicitud
  for select to authenticated
  using (
    exists (
      select 1
      from vacaciones.solicitudes_ausencia s
      where s.id = solicitud_ausencia_id
        and s.empleado_id = vacaciones.empleado_actual_id()
        and s.eliminado_en is null
    )
    and eliminado_en is null
  );

-- Grants de la Data API. RLS sigue determinando que filas puede operar cada rol.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant usage on schema vacaciones to authenticated';
    execute 'grant select, insert, update, delete on all tables in schema vacaciones to authenticated';
    execute 'grant usage, select on all sequences in schema vacaciones to authenticated';
    execute 'grant execute on all functions in schema vacaciones to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema vacaciones to service_role';
    execute 'grant select, insert, update, delete on all tables in schema vacaciones to service_role';
    execute 'grant usage, select on all sequences in schema vacaciones to service_role';
    execute 'grant execute on all functions in schema vacaciones to service_role';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Datos iniciales ICSI; no se inventan sedes ni proyectos
-- ---------------------------------------------------------------------------

insert into vacaciones.organizaciones (
  codigo,
  nombre,
  zona_horaria,
  inicio_semana
)
values ('ICSI', 'ICSI OIL & GAS', 'America/Mexico_City', 1)
on conflict (codigo) where eliminado_en is null do update
set nombre = excluded.nombre,
    zona_horaria = excluded.zona_horaria,
    inicio_semana = excluded.inicio_semana;

insert into vacaciones.categorias_empleado (
  organizacion_id,
  codigo,
  nombre,
  color
)
select o.id, valores.codigo, valores.nombre, valores.color
from vacaciones.organizaciones o
cross join (
  values
    ('ADMINISTRATIVO', 'Administrativo', '#4F46E5'),
    ('DUAL',           'Dual',           '#0EA5E9'),
    ('OPERATIVO',      'Operativo',      '#16A34A')
) as valores(codigo, nombre, color)
where o.codigo = 'ICSI'
  and o.eliminado_en is null
on conflict (organizacion_id, codigo) where eliminado_en is null do update
set nombre = excluded.nombre,
    color = excluded.color,
    activo = true;

insert into vacaciones.horarios_laborales (
  organizacion_id,
  codigo,
  nombre,
  predeterminado
)
select o.id, 'ICSI_GENERAL', 'Horario general ICSI', true
from vacaciones.organizaciones o
where o.codigo = 'ICSI'
  and o.eliminado_en is null
on conflict (organizacion_id, codigo) where eliminado_en is null do update
set nombre = excluded.nombre,
    predeterminado = true,
    activo = true;

insert into vacaciones.dias_horario_laboral (
  horario_laboral_id,
  dia_semana,
  fraccion_laboral
)
select h.id, valores.dia_semana, valores.fraccion_laboral
from vacaciones.horarios_laborales h
join vacaciones.organizaciones o
  on o.id = h.organizacion_id
cross join (
  values
    (0, 0.00::numeric),
    (1, 1.00::numeric),
    (2, 1.00::numeric),
    (3, 1.00::numeric),
    (4, 1.00::numeric),
    (5, 1.00::numeric),
    (6, 0.50::numeric)
) as valores(dia_semana, fraccion_laboral)
where o.codigo = 'ICSI'
  and h.codigo = 'ICSI_GENERAL'
  and o.eliminado_en is null
  and h.eliminado_en is null
on conflict (horario_laboral_id, dia_semana) where eliminado_en is null do update
set fraccion_laboral = excluded.fraccion_laboral;

insert into vacaciones.tipos_ausencia (
  organizacion_id,
  codigo,
  nombre,
  color,
  descuenta_saldo,
  requiere_aprobacion,
  metodo_conteo,
  excluir_dias_festivos
)
select
  o.id,
  'VACACIONES',
  'Vacaciones',
  '#FCB900',
  true,
  true,
  'dias_naturales', -- coincide con la expansion actual del CSV
  false
from vacaciones.organizaciones o
where o.codigo = 'ICSI'
  and o.eliminado_en is null
on conflict (organizacion_id, codigo) where eliminado_en is null do update
set nombre = excluded.nombre,
    color = excluded.color,
    activo = true;

commit;

-- Consultas de ejemplo (no se ejecutan)
--
-- 1) Eventos del calendario con filtros:
-- select *
-- from vacaciones.v_dias_solicitud_calendario
-- where fecha_calendario between date '2026-01-01' and date '2026-12-31'
--   and estado in ('planeada', 'pendiente', 'aprobada')
--   and (:empleado_id is null or empleado_id = :empleado_id)
--   and (:sede_id is null or sede_id = :sede_id)
--   and (:proyecto_id is null or proyecto_id = :proyecto_id)
--   and (:categoria_id is null or categoria_id = :categoria_id);
--
-- 2) Empleados que si solicitaron vacaciones y sus saldos:
-- select *
-- from vacaciones.v_saldo_vacaciones_empleado
-- where anio_asignacion = 2026
--   and solicito_vacaciones = true;
--
-- 3) Conteo diario mediante RPC:
-- select * from vacaciones.obtener_resumen_diario_calendario(
--   :organizacion_id,
--   date '2026-01-01',
--   date '2026-12-31'
-- );
--
-- 4) Borrado logico con motivo y restauracion (administrador):
-- select vacaciones.eliminar_registro('sedes', :sede_id::text, 'Registro duplicado');
-- select vacaciones.restaurar_registro('sedes', :sede_id::text);
--
-- Un DELETE directo tambien es seguro y se transforma en borrado logico:
-- delete from vacaciones.sedes where id = :sede_id;
--
-- Para consultar la papelera administrativa:
-- select * from vacaciones.sedes where eliminado_en is not null;
