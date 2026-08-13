# Configuración de Supabase y NestJS

## 1. Crear la base

1. Crea un proyecto en Supabase.
2. Abre **SQL Editor**, pega todo el contenido de `database/001_esquema_inicial.sql` y ejecútalo. Puedes volver a ejecutar el archivo para actualizar una instalación existente; conserva los datos y carga únicamente la organización ICSI, las categorías base, el horario general y el tipo VACACIONES.
3. En la configuración de la Data API, agrega `vacaciones` a **Exposed schemas**. El frontend usa explícitamente `supabase.schema("vacaciones")`.

El SQL ya concede acceso al rol `authenticated` y al rol de servicio, y activa RLS en todas las tablas. Una cuenta autenticada sin perfil administrador no obtiene acceso administrativo.

## 2. Crear el primer administrador

En **Authentication > Users**, crea el usuario con correo y contraseña. Copia su UUID y ejecuta en SQL Editor:

```sql
insert into vacaciones.perfiles_usuario (
  usuario_id,
  empleado_id,
  nombre_visible,
  rol,
  activo
)
values (
  'UUID_DEL_USUARIO_DE_AUTH',
  null,
  'Administración ICSI',
  'administrador',
  true
)
on conflict (usuario_id) do update
set nombre_visible = excluded.nombre_visible,
    rol = excluded.rol,
    activo = excluded.activo;
```

Un administrador no necesita estar vinculado a un empleado. El campo `empleado_id` se utilizará después para el portal del empleado.

## 3. Claves y variables

En Supabase, copia la URL, una **Publishable key** y una **Secret key**. La clave publicable identifica al frontend y RLS limita lo que cada sesión puede ver. La clave secreta omite RLS y por eso se usa exclusivamente dentro de NestJS, después de comprobar el JWT y el rol administrador.

Frontend, archivo `frontend/.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://TU_PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REEMPLAZAR
NEXT_PUBLIC_API_URL=http://localhost:3001
```

NestJS, archivo `api/.env`:

```dotenv
PORT=3001
FRONTEND_URLS=http://localhost:3000
SUPABASE_URL=https://TU_PROYECTO.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_REEMPLAZAR
SUPABASE_SECRET_KEY=sb_secret_REEMPLAZAR
```

Nunca pongas `SUPABASE_SECRET_KEY` en `frontend`, en una variable `NEXT_PUBLIC_*` ni en el repositorio.

## 4. Dónde corre NestJS

NestJS no corre dentro de Supabase. En desarrollo corre en tu computadora, desde `api/`, en el puerto 3001. En producción corre como servicio web independiente en Render. Supabase permanece como autenticación, PostgreSQL y Data API.

La API es deliberadamente pequeña:

- `GET /salud`: monitoreo público.
- `GET /documentacion`: Swagger.
- `POST /importaciones/vacaciones`: archivo CSV; requiere `Authorization: Bearer <access_token>` y perfil administrador.

El frontend realiza directamente en Supabase el calendario, filtros, personal, catálogos y solicitudes. Esto evita mantener una segunda capa CRUD idéntica y conserva la protección en RLS.

## 5. Edición y borrado lógico

Los administradores conservan permisos de inserción y edición sobre todas las tablas del esquema. Un `DELETE` directo ya no elimina físicamente: el trigger guarda `eliminado_en` y `eliminado_por`. Para registrar un motivo o restaurar desde una papelera usa las RPC:

```sql
select vacaciones.eliminar_registro('sedes', 'UUID_DE_LA_SEDE', 'Registro duplicado');
select vacaciones.restaurar_registro('sedes', 'UUID_DE_LA_SEDE');
```

Las vistas de calendario y saldos omiten los registros eliminados. En consultas administrativas directas a tablas base agrega `.is("eliminado_en", null)` para listar solo activos, o `.not("eliminado_en", "is", null)` para mostrar la papelera. Si se elimina o restaura una solicitud aprobada, el ajuste de saldo ocurre automáticamente en la misma transacción.

El archivo `database/001_esquema_inicial.sql` también puede ejecutarse sobre una instalación existente: agrega las columnas, índices, funciones y triggers necesarios sin borrar los datos actuales.

## 6. Desplegar NestJS en Render

1. Sube el proyecto a un repositorio Git.
2. En Render crea un Blueprint utilizando `render.yaml`, o un Web Service con runtime Docker, Dockerfile `api/Dockerfile` y contexto `api`.
3. Configura `FRONTEND_URLS`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SECRET_KEY` como variables privadas. `FRONTEND_URLS` acepta varias URLs separadas por coma.
4. Verifica `https://TU_SERVICIO.onrender.com/salud`.
5. Cambia `NEXT_PUBLIC_API_URL` del frontend por la URL de Render y vuelve a desplegar el frontend.

Render asigna el puerto mediante `PORT`; la aplicación ya escucha en `0.0.0.0` y lo respeta.

## 7. Datos sensibles y saldos

- CURP y NSS se guardan en `vacaciones.empleados`; no se incluyen en las vistas del calendario.
- `dias_por_derecho`: derecho total anual capturado por RH.
- `dias_acumulados_a_fecha`: parte devengada a la fecha de corte.
- `dias_disponibles`: saldo operativo disponible. La RPC atómica lo descuenta al aprobar y lo repone al revertir una aprobación.
- Los valores declarados por CSV se conservan también en `instantaneas_saldo_ausencia` para auditoría; no se convierten automáticamente en derecho anual.

## 8. Importación CSV

La importación acepta los dos formatos incluidos en el proyecto: el formulario original con periodos en una celda y el CSV expandido con columnas Inicio/Fin. Registra un lote con hash SHA-256, evita duplicar el mismo archivo, crea empleados faltantes sin inventar CURP/NSS y conserva cada incidencia. Los rangos invertidos o reintegros inválidos no entran al calendario.
