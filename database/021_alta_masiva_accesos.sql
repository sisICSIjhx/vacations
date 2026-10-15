-- ICSI OIL & GAS - Alta masiva de accesos a la plataforma (rol empleado)
-- PostgreSQL / Supabase. Ejecutar en Supabase > SQL Editor.
--
-- Origen: CORREOS_TRABAJADORES.xlsx (correo principal de cada trabajador
-- activo). Se dejaron fuera los marcados con ACTIVO = 0, José Manuel Sosa
-- (se salió), las cuentas de área (Mesa Directiva, Finanzas) y SOLDADOR
-- (sin nombre y correo con dominio .con).
--
-- Cómo usarlo:
--   1) Ejecútalo tal cual. Es solo una REVISIÓN: no crea nada y muestra qué
--      haría con cada persona y qué empleados activos no vienen en la lista.
--   2) Si está bien, cambia false por true en la línea marcada «APLICAR» y
--      ejecútalo otra vez. Exporta el resultado (botón Export > CSV): la
--      columna contrasena_temporal solo se muestra en esa ejecución.
--
-- Al aplicar, solo para las filas «Se creará»:
--   * crea la cuenta en Supabase Auth ya confirmada, sin enviar correos, con
--     una contraseña temporal aleatoria;
--   * le permite cambiar su contraseña y le exige cambiarla al iniciar sesión
--     (los mismos indicadores que usa el botón «Crear acceso»);
--   * crea su perfil con rol «empleado» vinculado a su registro de Personal;
--   * llena el correo del empleado si estaba vacío (lo usan los avisos).
-- No toca a quien ya tiene acceso ni a correos que ya tengan una cuenta. Todo
-- corre en una sola transacción: si algo falla, no se crea nada. Se puede
-- volver a ejecutar sin duplicar: quien ya quedó dado de alta sale como
-- «Ya tenía acceso».
--
-- «Ver contraseña» no mostrará estas contraseñas temporales (las cifra la API,
-- no SQL); sí mostrará la que cada empleado elija al cambiarla. Si alguien
-- pierde la temporal, usa «Restablecer contraseña» en Personal.

create temporary table tmp_config on commit drop as
select false as aplicar;  -- APLICAR: cambia false por true para crear los accesos

create temporary table tmp_lista (nombre text, correo text) on commit drop;

insert into tmp_lista (nombre, correo)
values
  ('ABDIEL DAGOBERTO RIVERA AMARO', 'abdielriveraicsi@gmail.com'),
  ('ANA DEL CARMEN MARTINEZ SANCHEZ', 'mtzanadelcarmen.icsiog@gmail.com'),
  ('ÁNGEL GABRIEL ORTIZ ALVARADO', 'ingenieria.proyectos@icsiog.com'),
  ('ANTONIO DOMINGUEZ VAZQUEZ', 'antoniodominguezicsi@gmail.com'),
  ('ARMANDO ARCANGEL SANCHEZ BRITO', 'direccion.general@icsiog.com'),
  ('BRANDON YAIR REBOLLEDO IZQUIERDO', 'yairrebolledoicsi@gmail.com'),
  ('CESAR AUGUSTO CASTRO RESENDIZ', 'cesaraugustoicsi@gmail.com'),
  ('CESAR MANUEL MARQUEZ GARCIA', 'operacion.sur@icsiog.com'),
  ('FRANCISCO DE JESUS GRACIA MATEO', 'compras@icsiog.com'),
  ('GUADALUPE ESTEFANIA ÁLVAREZ IZQUIERDO', 'guadalupealvarez.icsiog@gmail.com'),
  ('ISMAEL MARTÍNEZ GONZÁLEZ', 'ismaelmartinezicsi@gmail.com'),
  ('JHONNY EDUARDO HERNANDEZ ESTRADA', 'sistemasicsiog@gmail.com'),
  ('JORGE ANTONIO CORNELIO BENITEZ', 'medicion@icsiog.com'),
  ('JULIO CESAR LARA ALOR', 'juliolaraicsi@gmail.com'),
  ('LUCERO MORALEZ SANTIAGO', 'coord.proyecto01@icsiog.com'),
  ('MAYRA BERENICE MARIANO GONZALEZ', 'contabilidad@icsiog.com'),
  ('MIRLETTE HERNANDEZ MATUS', 'mirlettehernandezicsi@gmail.com'),
  ('NATHANAEL VITELIO GUTIERREZ ALVARADO', 'natanaelgutierrez.icsiog@gmail.com'),
  ('NEREIDA CRUZ FERNÁNDEZ', 'nereidacruzicsi@gmail.com'),
  ('NORMAN DANIEL WRIGHT DIAZ', 'normanwrighticsi@gmail.com'),
  ('PAULO CESAR MOLINA VILLAGRAN', 'proyectos.especiales@icsiog.com'),
  ('RICARDO ANTONIO VALDEZ PEREZ', 'operacion.centro@icsiog.com'),
  ('RICARDO RAMIREZ ARMENTA', 'ricardoramirezicsi@gmail.com'),
  ('VICTOR ADRIAN SOSA CASTILLO', 'mantenimiento@icsiog.com'),
  ('WILBER MARIN VALDIVIESO', 'wilbermarinicsi@gmail.com'),
  ('ZALATIEL MARTINEZ MARTINEZ', 'zalatielmartinezicsi@gmail.com'),
  ('KAREN STEFANY OLMEDO ORTIZ', 'recursos.humanos@icsiog.com'),
  ('ELPIDIO CABRERA BARRIOS', 'elpidiocabreraicsi@gmail.com'),
  ('JOSE LUIS VIDAL RAMIREZ', 'josevidalicsi@gmail.com'),
  ('GILBERTO BARRERA NOLASCO', 'scadaicsi@gmail.com'),
  ('OMAR HERNANDEZ GARCIA', 'omarh.icsi@gmail.com'),
  ('JORGE ALBERTO LINARES GUTIERREZ', 'comercial@icsiog.com'),
  ('GABRIEL DE LA CRUZ SAGRESO', 'gabrieldelacruzicsi@gmail.com'),
  ('BERNARDO DEL ÁNGEL VILLALOBOS RAMÍREZ', 'bernardovillalobosicsi@gmail.com'),
  ('DOMINGO DOMINGUEZ GONZÁLEZ', 'domingogonzalesicsi@gmail.com'),
  ('LUIS ALBERTO SANTIAGO TOLEDO', 'luisantiagoicsi@gmail.com'),
  ('MOISÉS HERNÁNDEZ ALEJANDRO', 'moiseshernandezicsi@gmail.com'),
  ('LUIS ANDRES ZAMORA RANGEL', 'luiszamoraicsi@gmail.com'),
  ('ANGEL HERNANDEZ ESCAMILLA', 'angelescamillaicsi@gmail.com'),  -- en el Excel: ANGEL ESCAMILLA
  ('GERARDO MACIAS SANTIAGO', 'gerardomacias.icsiog@gmail.com'),
  ('RICARDO MOLINA VILLAGRÁN', 'ricardomolinaicsi@gmail.com'),
  ('KARINA SOSA BARAHONA', 'karinasosaicsi@gmail.com'),
  ('LEONARDO MARTINEZ BETANZOS', 'leonardomartinezbetanzosicsi@gmail.com'),
  ('ALEJANDRO VAZQUEZ SANTIAGO', 'procura@icsiog.com'),  -- en el Excel: ALEJANDRO VELAZQUEZ SANTIAGO
  ('ABIMAEL MARTINEZ MARTINEZ', 'abimaelmartinezicsi@gmail.com'),
  ('DIANA LAURA LÓPEZ GÓMEZ', 'dianalauralopezgomezicsi@gmail.com'),
  ('CRISTOPHER QUINO', 'omamina@icsiog.com'),
  ('DIEGO BRUNO BRADLEY', 'santaanatula@icsiog.com');

-- Cruce por nombre (sin acentos ni espacios dobles) con Personal y decisión
-- para cada fila.
create temporary table tmp_resultado on commit drop as
with lista as (
  select
    nombre,
    lower(trim(correo)) as correo,
    regexp_replace(upper(translate(trim(nombre), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')), '\s+', ' ', 'g') as clave
  from tmp_lista
),
personal as (
  select
    e.id,
    regexp_replace(upper(translate(trim(e.nombre_completo), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')), '\s+', ' ', 'g') as clave
  from vacaciones.empleados e
  where e.eliminado_en is null
),
cruce as (
  select
    l.nombre,
    l.correo,
    (select count(*) from personal p where p.clave = l.clave) as coincidencias,
    (select p.id from personal p where p.clave = l.clave limit 1) as empleado_id
  from lista l
)
select
  c.nombre,
  c.correo,
  c.empleado_id,
  e.nombre_completo,
  case
    when c.coincidencias = 0 then 'No está en Personal: darlo de alta primero'
    when c.coincidencias > 1 then 'Nombre repetido en Personal: revisar a mano'
    when exists (
      select 1 from vacaciones.perfiles_usuario pu
      where pu.empleado_id = c.empleado_id and pu.eliminado_en is null
    ) then 'Ya tenía acceso (sin cambios)'
    when e.estado <> 'activo' then 'Empleado inactivo en Personal'
    when c.correo !~* '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then 'Correo inválido'
    when exists (select 1 from auth.users u where lower(u.email) = c.correo)
      then 'El correo ya tiene una cuenta: revisar a mano'
    when (select count(*) from lista o where o.correo = c.correo) > 1
      then 'Correo repetido en la lista'
    when (select count(*) from cruce o where o.empleado_id = c.empleado_id) > 1
      then 'Empleado repetido en la lista'
    else 'CREAR'
  end as resultado,
  gen_random_uuid() as usuario_id,
  translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/', '-_') as contrasena
from cruce c
left join vacaciones.empleados e on e.id = c.empleado_id;

-- Cuenta de Supabase Auth, ya confirmada y con cambio de contraseña
-- obligatorio al primer inicio de sesión.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  coalesce(
    (select u.instance_id from auth.users u limit 1),
    '00000000-0000-0000-0000-000000000000'::uuid
  ),
  r.usuario_id,
  'authenticated',
  'authenticated',
  r.correo,
  extensions.crypt(r.contrasena, extensions.gen_salt('bf', 10)),
  now(),
  jsonb_build_object(
    'provider', 'email',
    'providers', jsonb_build_array('email'),
    'puede_cambiar_contrasena', true,
    'debe_cambiar_contrasena', true
  ),
  jsonb_build_object('email_verified', true),
  now(),
  now(),
  '', '', '', ''
from tmp_resultado r
where r.resultado = 'CREAR' and (select aplicar from tmp_config);

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data,
  last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(),
  r.usuario_id,
  r.usuario_id::text,
  'email',
  jsonb_build_object(
    'sub', r.usuario_id::text,
    'email', r.correo,
    'email_verified', true,
    'phone_verified', false
  ),
  now(),
  now(),
  now()
from tmp_resultado r
where r.resultado = 'CREAR' and (select aplicar from tmp_config);

insert into vacaciones.perfiles_usuario (usuario_id, empleado_id, nombre_visible, rol, activo)
select r.usuario_id, r.empleado_id, r.nombre_completo, 'empleado', true
from tmp_resultado r
where r.resultado = 'CREAR' and (select aplicar from tmp_config);

-- Los avisos por correo usan empleados.correo_electronico.
update vacaciones.empleados e
set correo_electronico = r.correo
from tmp_resultado r
where r.resultado = 'CREAR'
  and (select aplicar from tmp_config)
  and e.id = r.empleado_id
  and coalesce(trim(e.correo_electronico), '') = '';

-- Reporte: una fila por persona de la lista y, al final, los empleados activos
-- de Personal sin acceso que no vienen en la lista.
select resultado, nombre, correo, contrasena_temporal
from (
  select
    1 as grupo,
    case
      when r.resultado <> 'CREAR' then r.resultado
      when (select aplicar from tmp_config) then 'Creado'
      else 'Se creará'
    end as resultado,
    coalesce(r.nombre_completo, r.nombre) as nombre,
    r.correo,
    case
      when r.resultado = 'CREAR' and (select aplicar from tmp_config) then r.contrasena
    end as contrasena_temporal
  from tmp_resultado r
  union all
  select
    2,
    'Activo sin acceso y sin correo en la lista (no se hizo nada)',
    e.nombre_completo,
    null,
    null
  from vacaciones.empleados e
  where e.eliminado_en is null
    and e.estado = 'activo'
    and not exists (
      select 1 from vacaciones.perfiles_usuario pu
      where pu.empleado_id = e.id and pu.eliminado_en is null
    )
    and not exists (select 1 from tmp_resultado r where r.empleado_id = e.id)
) reporte
order by grupo, resultado, nombre;
