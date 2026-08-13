"use client";

import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { BriefcaseBusiness, Building2, CalendarCheck2, CalendarClock, MapPin, RotateCcw, UserRound } from "lucide-react";
import type { DatosVacaciones, Empleado, FiltrosCalendario } from "../types";

interface EmployeeFocusProps {
  datos: DatosVacaciones;
  filtros: FiltrosCalendario;
  empleadoSeleccionado?: Empleado;
  onChange: (filtros: FiltrosCalendario) => void;
}

function Stat({ etiqueta, valor, tono }: { etiqueta: string; valor: number; tono?: string }) {
  return (
    <div className="mini-stat">
      <span>{etiqueta}</span>
      <strong style={tono ? { color: tono } : undefined}>{valor}</strong>
    </div>
  );
}

export function EmployeeFocus({ datos, filtros, empleadoSeleccionado, onChange }: EmployeeFocusProps) {
  const actualizar = (campo: keyof FiltrosCalendario, valor: string) => onChange({ ...filtros, [campo]: valor });
  const limpiar = () => onChange({ empleadoId: "", sedeId: "", proyectoId: "", categoriaId: "", estado: "" });

  return (
    <aside className="focus-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Vista del equipo</span>
          <h2>Enfoque del calendario</h2>
        </div>
        <button type="button" className="icon-button subtle" onClick={limpiar} aria-label="Limpiar filtros"><RotateCcw size={16} /></button>
      </div>

      <div className="filter-stack">
        <label>
          <span><UserRound size={14} />Empleado</span>
          <select value={filtros.empleadoId} onChange={(evento) => actualizar("empleadoId", evento.target.value)}>
            <option value="">Todo el personal</option>
            {datos.empleados.filter((empleado) => empleado.estado === "activo").map((empleado) => <option value={empleado.id} key={empleado.id}>{empleado.nombre}</option>)}
          </select>
        </label>
        <label>
          <span><MapPin size={14} />Sede</span>
          <select value={filtros.sedeId} onChange={(evento) => actualizar("sedeId", evento.target.value)}>
            <option value="">Todas las sedes</option>
            {datos.sedes.map((item) => <option value={item.id} key={item.id}>{item.nombre}</option>)}
          </select>
        </label>
        <label>
          <span><BriefcaseBusiness size={14} />Proyecto</span>
          <select value={filtros.proyectoId} onChange={(evento) => actualizar("proyectoId", evento.target.value)}>
            <option value="">Todos los proyectos</option>
            {datos.proyectos.map((item) => <option value={item.id} key={item.id}>{item.nombre}</option>)}
          </select>
        </label>
        <div className="filter-row">
          <label>
            <span><Building2 size={14} />Categoría</span>
            <select value={filtros.categoriaId} onChange={(evento) => actualizar("categoriaId", evento.target.value)}>
              <option value="">Todas</option>
              {datos.categorias.map((item) => <option value={item.id} key={item.id}>{item.nombre}</option>)}
            </select>
          </label>
          <label>
            <span><CalendarCheck2 size={14} />Estado</span>
            <select value={filtros.estado} onChange={(evento) => actualizar("estado", evento.target.value)}>
              <option value="">Todos</option>
              <option value="planeada">Planeada</option>
              <option value="pendiente">Pendiente</option>
              <option value="aprobada">Aprobada</option>
            </select>
          </label>
        </div>
      </div>

      {empleadoSeleccionado ? (
        <section className="employee-insight">
          <header>
            <span className="avatar" style={{ background: empleadoSeleccionado.color }}>{empleadoSeleccionado.nombre.split(" ").slice(0, 2).map((parte) => parte[0]).join("")}</span>
            <div><strong>{empleadoSeleccionado.nombre}</strong><span>{empleadoSeleccionado.numeroEmpleado} · {empleadoSeleccionado.categoria}</span></div>
          </header>
          <div className="employee-meta"><MapPin size={14} />{empleadoSeleccionado.sede}<span>•</span>{empleadoSeleccionado.proyecto}</div>
          <div className="stat-grid">
            <Stat etiqueta="Disponibles" valor={empleadoSeleccionado.saldo.diasDisponibles} tono={empleadoSeleccionado.color} />
            <Stat etiqueta="Acumulados" valor={empleadoSeleccionado.saldo.diasAcumulados} />
            <Stat etiqueta="Por derecho" valor={empleadoSeleccionado.saldo.diasPorDerecho} />
            <Stat etiqueta="Tomados" valor={empleadoSeleccionado.saldo.diasTomados} />
          </div>
          <div className="insight-row"><CalendarClock size={15} /><span>Planeados o pendientes</span><strong>{empleadoSeleccionado.saldo.diasPlaneados + empleadoSeleccionado.saldo.diasPendientes} días</strong></div>
          <div className="insight-row"><CalendarCheck2 size={15} /><span>Ingreso</span><strong>{empleadoSeleccionado.fechaIngreso ? format(parseISO(empleadoSeleccionado.fechaIngreso), "d MMM yyyy", { locale: es }) : "Sin fecha"}</strong></div>
        </section>
      ) : (
        <section className="team-summary">
          <span className="summary-orbit"><UserRound size={22} /></span>
          <div><strong>{datos.empleados.filter((empleado) => empleado.estado === "activo").length}</strong><span>personas activas</span></div>
          <div><strong>{datos.empleados.reduce((total, empleado) => total + empleado.saldo.diasDisponibles, 0)}</strong><span>días disponibles</span></div>
        </section>
      )}

      <div className="legend-card">
        <span className="eyebrow">Lectura rápida</span>
        <div><i className="legend-holiday" />Día festivo oficial</div>
        <div><i className="legend-person" />Color asignado al empleado</div>
        <div><span className="people-count sample">2</span>Más de una persona ausente</div>
      </div>
    </aside>
  );
}
