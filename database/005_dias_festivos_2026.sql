-- ICSI OIL & GAS - Dias de descanso obligatorio (festivos oficiales) 2026
-- PostgreSQL / Supabase
--
-- Los 7 dias de descanso obligatorio que marca el Articulo 74 de la Ley
-- Federal del Trabajo para Mexico. Tres de ellos son "el primer/tercer lunes
-- de..." (fechas moviles); ya se resolvieron aqui a la fecha real de 2026:
--   * Dia de la Constitucion: primer lunes de febrero       -> 2026-02-02
--   * Natalicio de Benito Juarez: tercer lunes de marzo     -> 2026-03-16
--   * Revolucion Mexicana: tercer lunes de noviembre        -> 2026-11-16
-- (El 1 de octubre de transmision del Poder Ejecutivo solo aplica en anios de
-- cambio de gobierno, p. ej. 2024 y 2030; no aplica en 2026 y no se incluye.)
--
-- Estos son festivos globales (sede_id null, aplican a todas las sedes). El
-- script es seguro de volver a correr: usa el indice unico
-- dias_festivos_globales_unicos_idx (organizacion_id, fecha, nombre) definido
-- en 001_esquema_inicial.sql para no duplicar filas.
--
-- A partir de ahora, un administrador puede agregar/editar/eliminar festivos
-- (incluidos los de anios futuros) directamente desde Catalogos > Dias
-- festivos en la app; este script solo precarga los de 2026.

begin;

insert into vacaciones.dias_festivos (organizacion_id, fecha, nombre)
select o.id, v.fecha, v.nombre
from vacaciones.organizaciones o
cross join (values
  (date '2026-01-01', 'Año Nuevo'),
  (date '2026-02-02', 'Día de la Constitución'),
  (date '2026-03-16', 'Natalicio de Benito Juárez'),
  (date '2026-05-01', 'Día del Trabajo'),
  (date '2026-09-16', 'Día de la Independencia'),
  (date '2026-11-16', 'Revolución Mexicana'),
  (date '2026-12-25', 'Navidad')
) as v(fecha, nombre)
where o.codigo = 'ICSI'
on conflict (organizacion_id, fecha, nombre)
  where sede_id is null and eliminado_en is null
  do nothing;

commit;

-- ---------------------------------------------------------------------------
-- Verificacion rapida despues de correr el script
-- ---------------------------------------------------------------------------
--
-- select fecha, nombre
-- from vacaciones.dias_festivos
-- where organizacion_id = (select id from vacaciones.organizaciones where codigo = 'ICSI')
--   and eliminado_en is null
-- order by fecha;
