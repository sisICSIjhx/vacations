"use client";

import { addDays, format, isAfter, isBefore, parseISO, startOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { ArrowUpRight, CalendarClock, CalendarRange, CircleAlert, UsersRound } from "lucide-react";
import type { DatosVacaciones, VistaId } from "../types";

interface DashboardViewProps {
  datos: DatosVacaciones;
  onNavigate: (vista: VistaId) => void;
}

export function DashboardView({ datos, onNavigate }: DashboardViewProps) {
  const hoy = startOfDay(new Date());
  const enTreintaDias = addDays(hoy, 30);
  const solicitudesActivas = datos.solicitudes.filter((solicitud) => !["rechazada", "cancelada"].includes(solicitud.estado));
  const proximas = solicitudesActivas
    .filter((solicitud) => {
      const inicio = parseISO(solicitud.fechaInicio);
      return isAfter(inicio, addDays(hoy, -1)) && isBefore(inicio, addDays(enTreintaDias, 1));
    })
    .sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio));
  const pendientes = datos.solicitudes.filter((solicitud) => solicitud.estado === "pendiente");
  const saldoBajo = datos.empleados.filter((empleado) => empleado.saldo.diasDisponibles <= 5);
  const diasConAusencias = new Set<string>();
  for (const solicitud of solicitudesActivas) {
    const cursor = parseISO(solicitud.fechaInicio);
    const fin = parseISO(solicitud.fechaFin);
    while (cursor <= fin) {
      if (cursor.getFullYear() === hoy.getFullYear()) diasConAusencias.add(format(cursor, "yyyy-MM-dd"));
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return (
    <div className="dashboard-view page-stack">
      <section className="welcome-strip">
        <div>
          <span className="eyebrow">Panorama del equipo</span>
          <h1>Buenos días, Administración</h1>
          <p>Esta es la disponibilidad prevista del personal para las próximas semanas.</p>
        </div>
        <button className="primary-button" type="button" onClick={() => onNavigate("calendario")}>Abrir calendario <ArrowUpRight size={17} /></button>
      </section>

      <section className="kpi-grid">
        <article className="kpi-card"><span className="icon-tile blue"><UsersRound size={19} /></span><div><span>Personal activo</span><strong>{datos.empleados.filter((empleado) => empleado.estado === "activo").length}</strong><small>{datos.sedes.length} sedes registradas</small></div></article>
        <article className="kpi-card"><span className="icon-tile amber"><CalendarClock size={19} /></span><div><span>Por aprobar</span><strong>{pendientes.length}</strong><small>{pendientes.reduce((total, solicitud) => total + solicitud.dias, 0)} días solicitados</small></div></article>
        <article className="kpi-card"><span className="icon-tile green"><CalendarRange size={19} /></span><div><span>Días con ausencias</span><strong>{diasConAusencias.size}</strong><small>En el calendario anual</small></div></article>
        <article className="kpi-card"><span className="icon-tile rose"><CircleAlert size={19} /></span><div><span>Saldos bajos</span><strong>{saldoBajo.length}</strong><small>5 días disponibles o menos</small></div></article>
      </section>

      <div className="dashboard-columns">
        <section className="content-card upcoming-card">
          <header className="section-heading"><div><span className="eyebrow">Próximos 30 días</span><h2>Ausencias programadas</h2></div><button className="text-button" onClick={() => onNavigate("solicitudes")}>Ver solicitudes</button></header>
          <div className="timeline-list">
            {proximas.length === 0 ? <p className="empty-note">No hay ausencias programadas en este periodo.</p> : proximas.slice(0, 6).map((solicitud) => (
              <article key={solicitud.id}>
                <div className="timeline-date"><strong>{format(parseISO(solicitud.fechaInicio), "dd", { locale: es })}</strong><span>{format(parseISO(solicitud.fechaInicio), "MMM", { locale: es })}</span></div>
                <span className="avatar small" style={{ background: solicitud.colorEmpleado }}>{solicitud.nombreEmpleado.split(" ").slice(0, 2).map((parte) => parte[0]).join("")}</span>
                <div className="timeline-copy"><strong>{solicitud.nombreEmpleado}</strong><span>{solicitud.dias} días · reintegro {solicitud.fechaReintegro ? format(parseISO(solicitud.fechaReintegro), "d MMM", { locale: es }) : "por confirmar"}</span></div>
                <span className={`status-pill ${solicitud.estado}`}>{solicitud.estado}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="content-card balance-card">
          <header className="section-heading"><div><span className="eyebrow">Control preventivo</span><h2>Disponibilidad baja</h2></div></header>
          <div className="balance-list">
            {saldoBajo.sort((a, b) => a.saldo.diasDisponibles - b.saldo.diasDisponibles).map((empleado) => (
              <article key={empleado.id}>
                <span className="avatar small" style={{ background: empleado.color }}>{empleado.nombre.split(" ").slice(0, 2).map((parte) => parte[0]).join("")}</span>
                <div><strong>{empleado.nombre}</strong><span>{empleado.proyecto}</span></div>
                <b className={empleado.saldo.diasDisponibles === 0 ? "danger-text" : ""}>{empleado.saldo.diasDisponibles} d</b>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
