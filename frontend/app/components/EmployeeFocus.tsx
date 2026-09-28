"use client";

import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { BriefcaseBusiness, Building2, CalendarCheck2, CalendarClock, MapPin, RotateCcw, UserRound } from "lucide-react";
import { Select } from "./Select";
import type { DatosVacaciones, Empleado, FiltrosCalendario, PerfilUsuario } from "../types";

interface EmployeeFocusProps {
  datos: DatosVacaciones;
  filtros: FiltrosCalendario;
  empleadoSeleccionado?: Empleado;
  perfil: PerfilUsuario | null;
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

export function EmployeeFocus({ datos, filtros, empleadoSeleccionado, perfil, onChange }: EmployeeFocusProps) {
  const actualizar = (campo: keyof FiltrosCalendario, valor: string) => onChange({ ...filtros, [campo]: valor });
  const limpiar = () => onChange({ empleadoId: "", sedeId: "", proyectoId: "", categoriaId: "", estado: "" });
  // Los filtros por equipo y la leyenda del calendario compartido son
  // herramientas de revisión (admin/RRHH/Mesa Directiva); un "empleado" en
  // autoservicio no tiene nada que filtrar, solo su propio saldo.
  const esAutoservicio = perfil?.rol === "empleado";

  return (
    <aside className="focus-panel">
      {esAutoservicio ? (
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Mis vacaciones</span>
            <h2>Mi saldo y solicitudes</h2>
          </div>
        </div>
      ) : (
        <>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Vista del equipo</span>
              <h2>Enfoque del calendario</h2>
            </div>
            <button type="button" className="icon-button subtle" onClick={limpiar} aria-label="Limpiar filtros" title="Limpiar filtros"><RotateCcw size={16} /></button>
          </div>

          <div className="filter-stack">
            <label>
              <span><UserRound size={14} />Empleado</span>
              <Select value={filtros.empleadoId} onChange={(valor) => actualizar("empleadoId", valor)}>
                <option value="">Todo el personal</option>
                {datos.empleados.filter((empleado) => empleado.estado === "activo").map((empleado) => <option value={empleado.id} key={empleado.id}>{empleado.nombre}</option>)}
              </Select>
            </label>
            <label>
              <span><MapPin size={14} />Sede</span>
              <Select value={filtros.sedeId} onChange={(valor) => actualizar("sedeId", valor)}>
                <option value="">Todas las sedes</option>
                {datos.sedes.map((item) => <option value={item.id} key={item.id}>{item.nombre}</option>)}
              </Select>
            </label>
            <label>
              <span><BriefcaseBusiness size={14} />Proyecto</span>
              <Select value={filtros.proyectoId} onChange={(valor) => actualizar("proyectoId", valor)}>
                <option value="">Todos los proyectos</option>
                {datos.proyectos.map((item) => <option value={item.id} key={item.id}>{item.nombre}</option>)}
              </Select>
            </label>
            <div className="filter-row">
              <label>
                <span><Building2 size={14} />Categoría</span>
                <Select value={filtros.categoriaId} onChange={(valor) => actualizar("categoriaId", valor)}>
                  <option value="">Todas</option>
                  {datos.categorias.map((item) => <option value={item.id} key={item.id}>{item.nombre}</option>)}
                </Select>
              </label>
              <label>
                <span><CalendarCheck2 size={14} />Estado</span>
                <Select value={filtros.estado} onChange={(valor) => actualizar("estado", valor)}>
                  <option value="">Todos</option>
                  <option value="planeada">Planeada</option>
                  <option value="pendiente">Pendiente</option>
                  <option value="aprobada">Aprobada</option>
                </Select>
              </label>
            </div>
          </div>
        </>
      )}

      {empleadoSeleccionado ? (
        <section className="employee-insight">
          {!esAutoservicio && (
            <header>
              <span className="avatar" style={{ background: empleadoSeleccionado.color }}>{empleadoSeleccionado.nombre.split(" ").slice(0, 2).map((parte) => parte[0]).join("")}</span>
              <div><strong>{empleadoSeleccionado.nombre}</strong><span>{empleadoSeleccionado.numeroEmpleado} · {empleadoSeleccionado.categoria}</span></div>
            </header>
          )}
          <div className="employee-meta"><MapPin size={14} />{empleadoSeleccionado.sede}<span>•</span>{empleadoSeleccionado.proyecto}</div>
          <div className="stat-grid">
            <Stat etiqueta="Disponibles" valor={empleadoSeleccionado.saldo.diasDisponibles} tono={empleadoSeleccionado.color} />
            <Stat etiqueta="Acumulados" valor={empleadoSeleccionado.saldo.diasAcumulados} />
            <Stat etiqueta="Por derecho" valor={empleadoSeleccionado.saldo.diasPorDerecho} />
            <Stat etiqueta="Tomados" valor={empleadoSeleccionado.saldo.diasTomados} />
          </div>
          <div className="insight-row"><CalendarClock size={15} /><span>Solicitados (planeados o pendientes)</span><strong>{empleadoSeleccionado.saldo.diasPlaneados + empleadoSeleccionado.saldo.diasPendientes} días</strong></div>
          <div className="insight-row"><CalendarCheck2 size={15} /><span>Ingreso</span><strong>{empleadoSeleccionado.fechaIngreso ? format(parseISO(empleadoSeleccionado.fechaIngreso), "d MMM yyyy", { locale: es }) : "Sin fecha"}</strong></div>
        </section>
      ) : esAutoservicio ? (
        <p className="empty-note">Tu cuenta todavía no está vinculada a un registro de empleado. Contacta a RRHH o a Administración para que la asocien y puedas ver tu saldo aquí.</p>
      ) : (
        <section className="team-summary">
          <span className="summary-orbit"><UserRound size={22} /></span>
          <div><strong>{datos.empleados.filter((empleado) => empleado.estado === "activo").length}</strong><span>personas activas</span></div>
          <div><strong>{datos.empleados.reduce((total, empleado) => total + empleado.saldo.diasDisponibles, 0)}</strong><span>días disponibles</span></div>
        </section>
      )}

      {!esAutoservicio && (
        <div className="legend-card">
          <span className="eyebrow">Lectura rápida</span>
          <div className="legend-list">
            <div><i className="legend-holiday" />Día festivo oficial</div>
            <div><i className="legend-person" />Color asignado al empleado</div>
            <div><span className="day-pill multiple-pill sample">2</span>Más de una persona ausente</div>
          </div>
        </div>
      )}
    </aside>
  );
}
