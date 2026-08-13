"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarPlus, Check, ChevronDown, CircleX, Plus, Search, X } from "lucide-react";
import type { DatosVacaciones, EstadoSolicitud, SolicitudFormulario } from "../types";

interface RequestsViewProps {
  datos: DatosVacaciones;
  actualizando: boolean;
  onCreate: (formulario: SolicitudFormulario) => Promise<boolean>;
  onStatus: (id: string, estado: EstadoSolicitud) => Promise<boolean>;
}

const solicitudInicial: SolicitudFormulario = { empleadoId: "", fechaInicio: "", fechaFin: "", fechaReintegro: "", estado: "planeada", comentarios: "" };

export function RequestsView({ datos, actualizando, onCreate, onStatus }: RequestsViewProps) {
  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState("");
  const [formulario, setFormulario] = useState<SolicitudFormulario | null>(null);
  const solicitudes = useMemo(() => datos.solicitudes
    .filter((solicitud) => !estado || solicitud.estado === estado)
    .filter((solicitud) => solicitud.nombreEmpleado.toLowerCase().includes(busqueda.toLowerCase()))
    .sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio)), [busqueda, datos.solicitudes, estado]);
  const actualizar = (campo: keyof SolicitudFormulario, valor: string) => setFormulario((actual) => actual ? { ...actual, [campo]: valor } : actual);
  const guardar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    if (!formulario) return;
    const correcto = await onCreate(formulario);
    if (correcto) setFormulario(null);
  };

  return (
    <div className="page-stack">
      <section className="page-title-row">
        <div><span className="eyebrow">Control de ausencias</span><h1>Solicitudes</h1><p>Vacaciones planeadas, pendientes y resueltas.</p></div>
        <button className="primary-button" type="button" onClick={() => setFormulario({ ...solicitudInicial })}><Plus size={17} />Nueva solicitud</button>
      </section>
      <section className="content-card table-card">
        <header className="table-toolbar request-toolbar">
          <div className="search-field"><Search size={17} /><input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar empleado" /></div>
          <label className="compact-select"><span>Estado</span><select value={estado} onChange={(e) => setEstado(e.target.value)}><option value="">Todos</option><option value="planeada">Planeada</option><option value="pendiente">Pendiente</option><option value="aprobada">Aprobada</option><option value="rechazada">Rechazada</option><option value="cancelada">Cancelada</option></select><ChevronDown size={14} /></label>
        </header>
        <div className="responsive-table-wrap">
          <table className="data-table request-table">
            <thead><tr><th>Empleado</th><th>Periodo</th><th>Días</th><th>Reintegro</th><th>Origen</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>
              {solicitudes.map((solicitud) => (
                <tr key={solicitud.id}>
                  <td><div className="person-cell"><span className="avatar small" style={{ background: solicitud.colorEmpleado }}>{solicitud.nombreEmpleado.split(" ").slice(0, 2).map((p) => p[0]).join("")}</span><strong>{solicitud.nombreEmpleado}</strong></div></td>
                  <td><strong className="table-primary">{format(parseISO(solicitud.fechaInicio), "d MMM", { locale: es })} — {format(parseISO(solicitud.fechaFin), "d MMM yyyy", { locale: es })}</strong>{solicitud.comentarios && <span className="table-secondary truncate">{solicitud.comentarios}</span>}</td>
                  <td><b>{solicitud.dias}</b></td>
                  <td>{solicitud.fechaReintegro ? format(parseISO(solicitud.fechaReintegro), "d MMM yyyy", { locale: es }) : "—"}</td>
                  <td><span className="source-pill">{solicitud.origen}</span></td>
                  <td><span className={`status-pill ${solicitud.estado}`}>{solicitud.estado}</span></td>
                  <td><div className="row-actions">{["planeada", "pendiente"].includes(solicitud.estado) && <><button className="icon-button approve" type="button" disabled={actualizando} onClick={() => onStatus(solicitud.id, "aprobada")} aria-label="Aprobar"><Check size={16} /></button><button className="icon-button reject" type="button" disabled={actualizando} onClick={() => onStatus(solicitud.id, "rechazada")} aria-label="Rechazar"><CircleX size={16} /></button></>}{solicitud.estado === "aprobada" && <button className="text-button danger-text" type="button" disabled={actualizando} onClick={() => onStatus(solicitud.id, "cancelada")}>Cancelar</button>}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {formulario && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) setFormulario(null); }}>
          <form className="form-modal request-form" onSubmit={guardar}>
            <header><div className="form-title-with-icon"><span className="icon-tile amber"><CalendarPlus size={18} /></span><div><span className="eyebrow">Calendario</span><h2>Nueva solicitud</h2></div></div><button className="icon-button" type="button" onClick={() => setFormulario(null)} aria-label="Cerrar"><X size={19} /></button></header>
            <div className="form-grid two-columns">
              <label className="span-two"><span>Empleado *</span><select required value={formulario.empleadoId} onChange={(e) => actualizar("empleadoId", e.target.value)}><option value="">Seleccionar empleado</option>{datos.empleados.filter((emp) => emp.estado === "activo").map((emp) => <option value={emp.id} key={emp.id}>{emp.nombre} · {emp.saldo.diasDisponibles} días disponibles</option>)}</select></label>
              <label><span>Fecha de inicio *</span><input required type="date" value={formulario.fechaInicio} onChange={(e) => actualizar("fechaInicio", e.target.value)} /></label>
              <label><span>Fecha final *</span><input required type="date" min={formulario.fechaInicio} value={formulario.fechaFin} onChange={(e) => actualizar("fechaFin", e.target.value)} /></label>
              <label><span>Fecha de reintegro</span><input type="date" min={formulario.fechaFin} value={formulario.fechaReintegro} onChange={(e) => actualizar("fechaReintegro", e.target.value)} /></label>
              <label><span>Estado inicial</span><select value={formulario.estado} onChange={(e) => actualizar("estado", e.target.value)}><option value="planeada">Planeada</option><option value="pendiente">Pendiente</option></select></label>
              <label className="span-two"><span>Comentarios</span><textarea rows={3} value={formulario.comentarios} onChange={(e) => actualizar("comentarios", e.target.value)} placeholder="Información relevante para la administración" /></label>
            </div>
            <footer><button className="secondary-button" type="button" onClick={() => setFormulario(null)}>Cancelar</button><button className="primary-button" type="submit" disabled={actualizando}>{actualizando ? "Guardando…" : "Guardar solicitud"}</button></footer>
          </form>
        </div>
      )}
    </div>
  );
}
