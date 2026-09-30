-- 014_vista_registro_extemporaneo.sql
-- Expone en vacaciones.v_dias_solicitud_calendario (de donde la app lee las
-- solicitudes) las columnas que agrego 012, para que la pantalla de RRHH sepa
-- que una solicitud es un registro extemporaneo y permita aprobarla sin la
-- anticipacion minima (la base de datos ya lo permitia desde 012).
-- Ejecutar despues de 012. Seguro de re-ejecutar.

begin;

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
    and df.fecha = calendario.fecha_calendario
    and (df.sede_id is null or df.sede_id = e.sede_id)
    and df.eliminado_en is null
  limit 1
) festivo on true
where s.eliminado_en is null
  and e.eliminado_en is null
  and ta.eliminado_en is null;

commit;

-- Si alguna solicitud fuera de plazo se capturo ANTES de tener el registro
-- extemporaneo (queda bloqueada en RRHH), se puede marcar a mano:
-- update vacaciones.solicitudes_ausencia
-- set registro_extemporaneo = true
-- where id = '<id de la solicitud>';
