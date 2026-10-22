# Historial de actividad

En **Administrar → Historial** se puede buscar por persona, acción o motivo y filtrar por módulo y fechas. Se muestran 30 movimientos por página, del más reciente al más antiguo, con hora de Ciudad de México. Cada movimiento ofrece un detalle según su contenido: «Datos de la aprobación», «Periodo propuesto», «Datos del registro creado» o «Qué cambió». «Ver historial de esta solicitud» reúne sus movimientos, incluso cuando ya no está en la lista operativa.

Las aprobaciones y altas muestran información del evento, sin una comparación artificial con un valor anterior vacío. «Valor anterior / Valor nuevo» aparece únicamente para campos distintos con ambos valores registrados; un vacío conocido se indica como «Sin asignar». Los campos vacíos y valores sin cambios se omiten. Si una actualización solo conserva un valor, se explica que falta evidencia anterior para comparar. «Registro histórico» identifica movimientos recuperados de información previa.

El detalle de Solicitudes usa la misma cronología: creación, decisiones, ediciones y cancelación con autor, fecha y motivo. Si el historial completo no puede cargarse, aparece un aviso con reintento y se conserva como respaldo la evidencia ya disponible de la solicitud.

## Alcance y permisos

- Registra cambios nuevos en solicitudes, revisiones, ediciones, empleados, asignaciones e instantáneas de saldo, días conservados, catálogos, horarios, festivos, lotes/incidencias de importación y perfiles de acceso.
- La API identifica al usuario que crea o modifica accesos e importa datos. Los cambios de configuración de Auth y contraseñas registran la acción, nunca la contraseña. Como Auth y PostgreSQL son servicios separados, si falla el registro posterior se informa que el acceso cambió y que debe revisarse antes de repetir la operación.
- Administración consulta todo; RRHH consulta actividad operativa excepto accesos; Mesa Directiva consulta solicitudes y, desde 027, saldos; empleados consultan las propias y las de sus reportes actuales cuando son jefes.
- Los usuarios no pueden insertar, modificar ni borrar eventos directamente. Los disparadores registran cambios de datos dentro de la transacción; un rollback también revierte el evento. La evidencia no se elimina en cascada.
- CURP y NSS registran que cambió el dato sin duplicar su valor. Se excluyen tokens, contraseñas, cargas originales CSV y marcas técnicas sin cambios de negocio.
- Se recupera evidencia previa de estados, revisiones, ediciones y cancelaciones. Nombres o fechas no guardados se muestran como no registrados. No existe reconstrucción retroactiva de cambios de personal o catálogos que nunca tuvieron auditoría.

## Activación

1. Confirmar que la base tiene las migraciones anteriores, incluida 025.
2. Aplicar [`026_historial_actividad.sql`](../database/026_historial_actividad.sql) en Supabase.
3. Desplegar API y frontend. No requiere cambios en Edge Functions.
4. Con cuentas de prueba, comprobar creación, aprobación, edición y cancelación, y comparar Administración, RRHH, Mesa Directiva, jefe y empleado. El historial no ofrece edición ni borrado.

La migración puede volver a ejecutarse sin duplicar la recuperación histórica. La instalación crea un límite temporal para evitar importar de nuevo eventos futuros. Para revertir la interfaz, conservar la tabla y su evidencia.

## Validación local

### Ajustes manuales de saldo (027)

En **Personal → Editar** (Administración/RRHH) o **Ajustar saldo** (Mesa Directiva), cualquier cambio de días por derecho, acumulados o disponibles exige un motivo. Espacios en blanco no son válidos. Para descontar cuatro días, capturar el saldo disponible resultante y explicar la causa; por ejemplo, «Descuento de 4 días por ausencias solicitado por el empleado». Se conserva autor de sesión, fecha, año, valor anterior y nuevo. Sin modificación del saldo no se pide justificación. El alta inicial permanece reservada a Administración/RRHH.

Aplicar [`027_ajuste_saldo_con_motivo.sql`](../database/027_ajuste_saldo_con_motivo.sql) después de 026 y publicar el frontend actualizado en la misma ventana de despliegue: el cliente anterior deja de poder escribir saldos directamente. Si el saldo cambia durante la edición, se rechaza el ajuste; cerrar y volver a cargar Personal antes de reintentarlo. Los cambios del expediente y del saldo son operaciones separadas; saldo y evidencia sí se confirman juntos.

[`database/tests/ajuste-saldo.mjs`](../database/tests/ajuste-saldo.mjs), con la misma variable `PGLITE_MODULE` descrita abajo, ejecuta 026/027 y funciones reales de arrastre, aniversario y cambio de estado administrativo. Cubre los tres roles, motivo, autor, valores, conflicto de saldo, no-op, escritura directa denegada, inactivo/anónimo, rollback y fallo de auditoría. Usa tablas del DDL y un calendario de fixture de tres días para verificar descuentos/reintegros por estado; no reemplaza una prueba de toda la cadena en Supabase.

### Comandos

Frontend: `npm run lint` y `npm test` desde `frontend/`. API: `npm run lint`, `npm run build`, `npm test -- --runInBand` y `npm run test:e2e -- --runInBand` desde `api/`.

La prueba [`database/tests/historial-actividad.mjs`](../database/tests/historial-actividad.mjs) ejecuta la migración 026 en PostgreSQL embebido (PGlite), con tablas tomadas del DDL existente y funciones de identidad simuladas. Cubre recuperación idempotente, cancelación en dos escrituras, actor, rollback, RLS, inmutabilidad para usuarios, secretos excluidos y conservación tras borrado físico. No ejecuta toda la cadena histórica ni acredita aplicación en Supabase, entrega de correo o integración de Auth real.

Para repetirla, instalar `@electric-sql/pglite` en una carpeta temporal y establecer `PGLITE_MODULE` con la ruta absoluta de `node_modules/@electric-sql/pglite/dist/index.js`; ejecutar `node database/tests/historial-actividad.mjs` desde la raíz.
