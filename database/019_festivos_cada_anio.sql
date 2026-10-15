-- 019_festivos_cada_anio.sql
-- Los dias festivos se repiten cada anio sin volver a capturarlos.
--
-- dias_festivos.repeticion:
--   * 'ninguna'    -> solo la fecha capturada (p. ej. 1 de octubre de 2030,
--                     transmision del Poder Ejecutivo).
--   * 'fecha'      -> el mismo dia y mes cada anio (1 ene, 1 may, 16 sep, 25 dic).
--   * 'dia_semana' -> el mismo "n-esimo dia de la semana" del mes, tomado de la
--                     fecha capturada: 2026-02-02 = primer lunes de febrero,
--                     2026-03-16 y 2026-11-16 = tercer lunes de marzo/noviembre.
-- Un festivo que se repite aplica desde el anio de su fecha en adelante, asi
-- dar de alta uno nuevo no cambia el historial de anios anteriores.
--
-- Requiere 018: los triggers de dias_festivos ajustan el saldo de las
-- solicitudes aprobadas que caen en los festivos que se vuelven anuales.

begin;

alter table vacaciones.dias_festivos
  add column if not exists repeticion text not null default 'ninguna'
    check (repeticion in ('ninguna', 'fecha', 'dia_semana'));
comment on column vacaciones.dias_festivos.repeticion is
  'ninguna = solo esa fecha; fecha = mismo dia y mes cada anio; dia_semana = mismo n-esimo dia de la semana del mes cada anio. Aplica desde el anio de fecha.';

-- ¿El festivo capturado en p_fecha_festivo cae en p_fecha?
create or replace function vacaciones.festivo_en_fecha(p_fecha_festivo date, p_repeticion text, p_fecha date)
returns boolean
language sql
immutable
as $$
  select case p_repeticion
    when 'fecha' then
      extract(year from p_fecha) >= extract(year from p_fecha_festivo)
      and extract(month from p_fecha) = extract(month from p_fecha_festivo)
      and extract(day from p_fecha) = extract(day from p_fecha_festivo)
    when 'dia_semana' then
      extract(year from p_fecha) >= extract(year from p_fecha_festivo)
      and extract(month from p_fecha) = extract(month from p_fecha_festivo)
      and extract(dow from p_fecha) = extract(dow from p_fecha_festivo)
      -- misma semana del mes: dias 1-7 = primera, 8-14 = segunda, ...
      and (extract(day from p_fecha)::integer - 1) / 7 = (extract(day from p_fecha_festivo)::integer - 1) / 7
    else p_fecha = p_fecha_festivo
  end;
$$;

-- Igual que 016, pero el festivo se busca con festivo_en_fecha.
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
    and vacaciones.festivo_en_fecha(df.fecha, df.repeticion, calendario.fecha_calendario)
    and (df.sede_id is null or df.sede_id = e.sede_id)
    and df.eliminado_en is null
  limit 1
) festivo on true
where s.eliminado_en is null
  and e.eliminado_en is null
  and ta.eliminado_en is null;

-- Los festivos oficiales (005, Art. 74 LFT) pasan a repetirse cada anio. El
-- saldo de 2026 no cambia; si ya hay vacaciones aprobadas en anios siguientes
-- que caen en ellos, los triggers de 018 devuelven esos dias.
update vacaciones.dias_festivos df
set repeticion = v.repeticion
from vacaciones.organizaciones o
cross join (values
  (date '2026-01-01', 'Año Nuevo', 'fecha'),
  (date '2026-02-02', 'Día de la Constitución', 'dia_semana'),
  (date '2026-03-16', 'Natalicio de Benito Juárez', 'dia_semana'),
  (date '2026-05-01', 'Día del Trabajo', 'fecha'),
  (date '2026-09-16', 'Día de la Independencia', 'fecha'),
  (date '2026-11-16', 'Revolución Mexicana', 'dia_semana'),
  (date '2026-12-25', 'Navidad', 'fecha')
) as v(fecha, nombre, repeticion)
where o.codigo = 'ICSI'
  and df.organizacion_id = o.id
  and df.sede_id is null
  and df.fecha = v.fecha
  and df.nombre = v.nombre
  and df.eliminado_en is null
  and df.repeticion = 'ninguna';

-- Si alguien ya habia capturado a mano el mismo festivo para otro anio, esa
-- copia sobra: la cubre el festivo anual.
update vacaciones.dias_festivos copia
set eliminado_en = now(),
    motivo_eliminacion = 'Cubierto por el festivo anual (019)'
where copia.repeticion = 'ninguna'
  and copia.eliminado_en is null
  and exists (
    select 1
    from vacaciones.dias_festivos anual
    where anual.id <> copia.id
      and anual.repeticion <> 'ninguna'
      and anual.eliminado_en is null
      and anual.organizacion_id = copia.organizacion_id
      and anual.sede_id is not distinct from copia.sede_id
      and anual.nombre = copia.nombre
      and vacaciones.festivo_en_fecha(anual.fecha, anual.repeticion, copia.fecha)
  );

commit;

-- Verificacion: festivos de 2027 que salen de la regla anual.
-- select d::date as fecha, df.nombre
-- from generate_series(date '2027-01-01', date '2027-12-31', interval '1 day') d
-- join vacaciones.dias_festivos df
--   on df.eliminado_en is null
--  and vacaciones.festivo_en_fecha(df.fecha, df.repeticion, d::date)
-- order by 1;
