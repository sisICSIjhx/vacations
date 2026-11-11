-- 029_dias_reales_en_recordatorios.sql
-- El recordatorio de aprobacion (010) no mandaba el campo "Días", asi que la
-- Edge Function "notificar" contaba dias naturales: del 03/11 al 10/11/2026
-- decia 8 dias aunque el domingo 08/11 es el descanso del empleado y la
-- solicitud descuenta 7. Ahora manda los dias de v_dias_solicitud_calendario
-- (sin el dia de descanso ni festivos), igual que los demas avisos (016, 017).
-- Requiere volver a desplegar la Edge Function "notificar", que deja de contar
-- dias naturales. Ejecutar despues de 019. Seguro de re-ejecutar.

begin;

-- Igual que 010, mas el campo "Días" con los dias que realmente descuenta.
create or replace function vacaciones.enviar_recordatorios_pendientes()
returns integer
language plpgsql
security definer
set search_path = vacaciones, public
as $$
declare
  r record;
  v_enviados integer := 0;
  v_pendiente_de text;
begin
  for r in
    select
      s.id,
      s.etapa_aprobacion,
      s.fecha_inicio,
      s.fecha_fin,
      e.nombre_completo as empleado,
      j.nombre_completo as jefe,
      t.nombre as tipo_ausencia,
      (
        select sum(d.dias_descontados)
        from vacaciones.v_dias_solicitud_calendario d
        where d.solicitud_ausencia_id = s.id
      ) as dias,
      floor(extract(epoch from now() - vacaciones.en_etapa_desde(s.id)) / 86400)::integer as dias_espera
    from vacaciones.solicitudes_ausencia s
    join vacaciones.empleados e on e.id = s.empleado_id
    left join vacaciones.empleados j on j.id = e.jefe_inmediato_id
    left join vacaciones.tipos_ausencia t on t.id = s.tipo_ausencia_id
    where s.estado = 'pendiente'
      and s.etapa_aprobacion in ('rrhh', 'jefe_inmediato', 'mesa_directiva')
      and s.eliminado_en is null
      and vacaciones.en_etapa_desde(s.id) < now() - interval '2 days'
      and not exists (
        select 1 from vacaciones.notificaciones n
        where n.solicitud_ausencia_id = s.id
          and n.tipo = 'recordatorio'
          and n.creado_en > now() - interval '20 hours'
      )
  loop
    v_pendiente_de := case r.etapa_aprobacion
      when 'rrhh' then 'RRHH'
      when 'jefe_inmediato' then coalesce(r.jefe || ' (jefe inmediato)', 'el jefe inmediato')
      else 'la mesa directiva'
    end;

    insert into vacaciones.notificaciones (tipo, titulo, mensaje, solicitud_ausencia_id)
    values (
      'recordatorio',
      '⏰ Recordatorio de aprobación',
      'Empleado: ' || coalesce(r.empleado, 'N/D')
        || ' | Tipo: ' || coalesce(r.tipo_ausencia, 'N/D')
        || ' | Del: ' || to_char(r.fecha_inicio, 'DD/MM/YYYY')
        || ' | Al: ' || to_char(r.fecha_fin, 'DD/MM/YYYY')
        || coalesce(' | Días: ' || trim_scale(r.dias)::text, '')
        || case when r.jefe is not null and r.etapa_aprobacion <> 'jefe_inmediato'
             then ' | Jefe inmediato: ' || r.jefe else '' end
        || ' | Pendiente de: ' || v_pendiente_de
        || ' | Días en espera: ' || r.dias_espera,
      r.id
    );
    v_enviados := v_enviados + 1;
  end loop;

  return v_enviados;
end;
$$;

revoke execute on function vacaciones.enviar_recordatorios_pendientes() from public, anon, authenticated;

commit;

-- Verificacion (dias que mostrara el aviso de cada solicitud en revision):
-- select s.id, s.fecha_inicio, s.fecha_fin, sum(d.dias_descontados) as dias
-- from vacaciones.solicitudes_ausencia s
-- join vacaciones.v_dias_solicitud_calendario d on d.solicitud_ausencia_id = s.id
-- where s.estado = 'pendiente' group by 1, 2, 3 order by 2;
