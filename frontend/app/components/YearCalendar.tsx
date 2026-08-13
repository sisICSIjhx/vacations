"use client";

import { useMemo, useState } from "react";
import { format, getDay, getDaysInMonth, isToday, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarDays, Palmtree, UserRound, UsersRound, X } from "lucide-react";
import type { DiaFestivo, SolicitudAusencia } from "../types";

const encabezados = ["L", "M", "M", "J", "V", "S", "D"];

interface YearCalendarProps {
  anio: number;
  solicitudes: SolicitudAusencia[];
  diasFestivos: DiaFestivo[];
}

interface DetalleDia {
  fecha: string;
  solicitudes: SolicitudAusencia[];
  festivos: DiaFestivo[];
}

function fechaIso(anio: number, mes: number, dia: number) {
  return `${anio}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export function YearCalendar({ anio, solicitudes, diasFestivos }: YearCalendarProps) {
  const [detalle, setDetalle] = useState<DetalleDia | null>(null);

  const solicitudesPorDia = useMemo(() => {
    const mapa = new Map<string, SolicitudAusencia[]>();
    for (const solicitud of solicitudes) {
      const inicio = parseISO(solicitud.fechaInicio);
      const fin = parseISO(solicitud.fechaFin);
      const cursor = new Date(inicio);
      while (cursor <= fin) {
        const clave = format(cursor, "yyyy-MM-dd");
        const lista = mapa.get(clave) ?? [];
        lista.push(solicitud);
        mapa.set(clave, lista);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return mapa;
  }, [solicitudes]);

  const festivosPorDia = useMemo(() => {
    const mapa = new Map<string, DiaFestivo[]>();
    for (const festivo of diasFestivos) {
      mapa.set(festivo.fecha, [...(mapa.get(festivo.fecha) ?? []), festivo]);
    }
    return mapa;
  }, [diasFestivos]);

  return (
    <>
      <div className="year-calendar" aria-label={`Calendario de vacaciones ${anio}`}>
        {Array.from({ length: 12 }, (_, mes) => {
          const primerDia = new Date(anio, mes, 1);
          const desplazamiento = (getDay(primerDia) + 6) % 7;
          const cantidadDias = getDaysInMonth(primerDia);
          const celdasFinales = 42 - desplazamiento - cantidadDias;
          const iniciosMes = solicitudes.filter((solicitud) => solicitud.fechaInicio.slice(0, 7) === fechaIso(anio, mes, 1).slice(0, 7)).length;
          return (
            <section className="month-card" key={mes} aria-label={format(primerDia, "MMMM", { locale: es })}>
              <header className="month-header">
                <h3>{format(primerDia, "MMMM", { locale: es })}</h3>
                <span className="month-absence-count" title={iniciosMes ? `${iniciosMes} solicitudes inician este mes` : undefined}>{iniciosMes > 0 && <><CalendarDays size={12} />{iniciosMes}</>}</span>
              </header>
              <div className="week-header" aria-hidden="true">
                {encabezados.map((dia, indice) => <span key={`${dia}-${indice}`}>{dia}</span>)}
              </div>
              <div className="month-grid">
                {Array.from({ length: desplazamiento }, (_, indice) => <span className="day-cell empty" key={`empty-${indice}`} />)}
                {Array.from({ length: cantidadDias }, (_, indice) => {
                  const numero = indice + 1;
                  const clave = fechaIso(anio, mes, numero);
                  const ausencias = solicitudesPorDia.get(clave) ?? [];
                  const festivos = festivosPorDia.get(clave) ?? [];
                  const tieneContenido = ausencias.length > 0 || festivos.length > 0;
                  const fecha = new Date(anio, mes, numero);
                  const diaSemana = getDay(fecha);
                  const descripcionFecha = format(fecha, "EEEE d 'de' MMMM 'de' yyyy", { locale: es });
                  return (
                    <button
                      className={`day-cell ${diaSemana === 6 ? "saturday" : ""} ${diaSemana === 0 ? "sunday" : ""} ${tieneContenido ? "has-content" : ""} ${ausencias.length ? "has-absence" : ""} ${ausencias.length > 1 ? "multiple" : ""} ${festivos.length ? "holiday" : ""} ${isToday(fecha) ? "today" : ""}`}
                      key={clave}
                      type="button"
                      disabled={!tieneContenido}
                      onClick={() => setDetalle({ fecha: clave, solicitudes: ausencias, festivos })}
                      title={festivos.length ? `${descripcionFecha} — ${festivos.map((festivo) => festivo.nombre).join(", ")}` : undefined}
                      aria-label={`${descripcionFecha}${ausencias.length ? `, ${ausencias.length} personas ausentes` : ""}${festivos.length ? `, ${festivos[0].nombre}` : ""}`}
                    >
                      <span className="day-number">{numero}</span>
                      {festivos.length > 0 && <span className="holiday-hover-icon" aria-hidden="true"><CalendarDays size={17} /></span>}
                      {ausencias.length > 0 && (
                        <span className="absence-stack" aria-hidden="true">
                          {ausencias.length === 1 ? (
                            <span className="single-person-marker" style={{ background: ausencias[0].colorEmpleado }}><UserRound size={12} /></span>
                          ) : <>
                            <span className="people-count"><UsersRound size={11} /><b>{ausencias.length}</b></span>
                          </>}
                        </span>
                      )}
                    </button>
                  );
                })}
                {Array.from({ length: celdasFinales }, (_, indice) => <span className="day-cell empty" key={`trailing-empty-${indice}`} />)}
              </div>
            </section>
          );
        })}
      </div>

      {detalle && (
        <div className="modal-backdrop day-detail-backdrop" role="presentation" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) setDetalle(null); }}>
          <section className="day-detail" role="dialog" aria-modal="true" aria-labelledby="day-detail-title">
            <header>
              <div className="icon-tile amber"><CalendarDays size={19} /></div>
              <div>
                <span className="eyebrow">Detalle del día</span>
                <h2 id="day-detail-title">{format(parseISO(detalle.fecha), "EEEE d 'de' MMMM", { locale: es })}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setDetalle(null)} aria-label="Cerrar detalle"><X size={19} /></button>
            </header>
            {detalle.festivos.map((festivo) => (
              <div className="holiday-callout" key={festivo.id}>
                <Palmtree size={17} />
                <div><strong>Día festivo oficial</strong><span>{festivo.nombre}</span></div>
              </div>
            ))}
            <div className="day-people-list">
              {detalle.solicitudes.length === 0 ? (
                <p className="empty-note">No hay personal de vacaciones.</p>
              ) : detalle.solicitudes.map((solicitud) => (
                <article key={solicitud.id}>
                  <span className="avatar small" style={{ background: solicitud.colorEmpleado }}>{solicitud.nombreEmpleado.split(" ").slice(0, 2).map((parte) => parte[0]).join("")}</span>
                  <div>
                    <strong>{solicitud.nombreEmpleado}</strong>
                    <span>{solicitud.fechaInicio} — {solicitud.fechaFin}</span>
                  </div>
                  <span className={`status-pill ${solicitud.estado}`}>{solicitud.estado}</span>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
