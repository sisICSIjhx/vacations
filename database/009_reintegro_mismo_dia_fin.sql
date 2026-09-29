-- ICSI OIL & GAS - Sistema de vacaciones
-- Permite que la fecha de reintegro coincida con la fecha final de las
-- vacaciones (antes debia ser posterior). Aditivo y seguro de re-ejecutar.
--
-- La restriccion original se creo sin nombre en 001_esquema_inicial.sql, asi
-- que se localiza por su definicion y se reemplaza por una con nombre fijo.

begin;

do $$
declare
  v_nombre text;
begin
  for v_nombre in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'vacaciones.solicitudes_ausencia'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%fecha_reintegro%'
  loop
    execute format('alter table vacaciones.solicitudes_ausencia drop constraint %I', v_nombre);
  end loop;
end
$$;

alter table vacaciones.solicitudes_ausencia
  add constraint solicitudes_ausencia_reintegro_check
  check (fecha_reintegro is null or fecha_reintegro >= fecha_fin);

commit;
