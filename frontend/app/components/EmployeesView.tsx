"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { BadgeCheck, Pencil, Plus, Search, ShieldCheck, X } from "lucide-react";
import type { DatosVacaciones, Empleado, EmpleadoFormulario } from "../types";

interface EmployeesViewProps {
  datos: DatosVacaciones;
  actualizando: boolean;
  onSave: (formulario: EmpleadoFormulario) => Promise<boolean>;
}

const formularioVacio: EmpleadoFormulario = {
  numeroEmpleado: "",
  nombre: "",
  correo: "",
  curp: "",
  nss: "",
  color: "#2563EB",
  sedeId: "",
  proyectoId: "",
  categoriaId: "",
  fechaIngreso: "",
  diasPorDerecho: 0,
  diasAcumulados: 0,
  diasDisponibles: 0,
};

function desdeEmpleado(empleado: Empleado): EmpleadoFormulario {
  return {
    id: empleado.id,
    numeroEmpleado: empleado.numeroEmpleado,
    nombre: empleado.nombre,
    correo: empleado.correo ?? "",
    curp: empleado.curp ?? "",
    nss: empleado.nss ?? "",
    color: empleado.color,
    sedeId: empleado.sedeId ?? "",
    proyectoId: empleado.proyectoId ?? "",
    categoriaId: empleado.categoriaId ?? "",
    fechaIngreso: empleado.fechaIngreso ?? "",
    diasPorDerecho: empleado.saldo.diasPorDerecho,
    diasAcumulados: empleado.saldo.diasAcumulados,
    diasDisponibles: empleado.saldo.diasDisponibles,
  };
}

export function EmployeesView({ datos, actualizando, onSave }: EmployeesViewProps) {
  const [busqueda, setBusqueda] = useState("");
  const [formulario, setFormulario] = useState<EmpleadoFormulario | null>(null);
  const empleados = useMemo(() => datos.empleados.filter((empleado) => `${empleado.nombre} ${empleado.numeroEmpleado} ${empleado.sede} ${empleado.proyecto}`.toLowerCase().includes(busqueda.toLowerCase())), [busqueda, datos.empleados]);
  const actualizar = (campo: keyof EmpleadoFormulario, valor: string | number) => setFormulario((actual) => actual ? { ...actual, [campo]: valor } : actual);

  const guardar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    if (!formulario) return;
    const correcto = await onSave({ ...formulario, curp: formulario.curp.toUpperCase() });
    if (correcto) setFormulario(null);
  };

  return (
    <div className="page-stack">
      <section className="page-title-row">
        <div><span className="eyebrow">Administración</span><h1>Personal</h1><p>Expediente, asignación y saldo vacacional del equipo.</p></div>
        <button className="primary-button" type="button" onClick={() => setFormulario({ ...formularioVacio })}><Plus size={17} />Alta de empleado</button>
      </section>

      <section className="content-card table-card">
        <header className="table-toolbar">
          <div className="search-field"><Search size={17} /><input value={busqueda} onChange={(evento) => setBusqueda(evento.target.value)} placeholder="Buscar por nombre, número, sede o proyecto" /></div>
          <span>{empleados.length} registros</span>
        </header>
        <div className="responsive-table-wrap">
          <table className="data-table employee-table">
            <thead><tr><th>Empleado</th><th>Asignación</th><th>Ingreso</th><th>Disponibles</th><th>Tomados</th><th>Identificación</th><th /></tr></thead>
            <tbody>
              {empleados.map((empleado) => (
                <tr key={empleado.id}>
                  <td><div className="person-cell"><span className="avatar small" style={{ background: empleado.color }}>{empleado.nombre.split(" ").slice(0, 2).map((parte) => parte[0]).join("")}</span><div><strong>{empleado.nombre}</strong><span>{empleado.numeroEmpleado} · {empleado.categoria}</span></div></div></td>
                  <td><strong className="table-primary">{empleado.proyecto}</strong><span className="table-secondary">{empleado.sede}</span></td>
                  <td>{empleado.fechaIngreso ? format(parseISO(empleado.fechaIngreso), "d MMM yyyy", { locale: es }) : "—"}</td>
                  <td><span className="balance-pair"><b>{empleado.saldo.diasDisponibles}</b><span>de</span><b>{empleado.saldo.diasAcumulados}</b></span><span className="table-secondary">disponibles / acumulados</span></td>
                  <td>{empleado.saldo.diasTomados} días</td>
                  <td>{empleado.curp || empleado.nss ? <span className="secure-label"><ShieldCheck size={14} />Capturada</span> : <span className="muted-label">Pendiente</span>}</td>
                  <td><button className="icon-button subtle" type="button" onClick={() => setFormulario(desdeEmpleado(empleado))} aria-label={`Editar ${empleado.nombre}`}><Pencil size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {formulario && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) setFormulario(null); }}>
          <form className="form-modal employee-form" onSubmit={guardar}>
            <header><div><span className="eyebrow">{formulario.id ? "Modificar registro" : "Nuevo registro"}</span><h2>{formulario.id ? "Editar empleado" : "Alta de empleado"}</h2></div><button className="icon-button" type="button" onClick={() => setFormulario(null)} aria-label="Cerrar"><X size={19} /></button></header>
            <div className="form-grid two-columns">
              <label className="span-two"><span>Nombre completo *</span><input required value={formulario.nombre} onChange={(e) => actualizar("nombre", e.target.value)} /></label>
              <label><span>Número de empleado *</span><input required value={formulario.numeroEmpleado} onChange={(e) => actualizar("numeroEmpleado", e.target.value)} /></label>
              <label><span>Correo electrónico</span><input type="email" value={formulario.correo} onChange={(e) => actualizar("correo", e.target.value)} /></label>
              <label><span>CURP</span><input maxLength={18} value={formulario.curp} onChange={(e) => actualizar("curp", e.target.value.toUpperCase())} placeholder="18 caracteres" /></label>
              <label><span>NSS</span><input inputMode="numeric" maxLength={11} value={formulario.nss} onChange={(e) => actualizar("nss", e.target.value.replace(/\D/g, ""))} placeholder="11 dígitos" /></label>
              <label><span>Sede</span><select value={formulario.sedeId} onChange={(e) => actualizar("sedeId", e.target.value)}><option value="">Seleccionar</option>{datos.sedes.map((item) => <option value={item.id} key={item.id}>{item.nombre}</option>)}</select></label>
              <label><span>Proyecto</span><select value={formulario.proyectoId} onChange={(e) => actualizar("proyectoId", e.target.value)}><option value="">Seleccionar</option>{datos.proyectos.map((item) => <option value={item.id} key={item.id}>{item.nombre}</option>)}</select></label>
              <label><span>Categoría</span><select value={formulario.categoriaId} onChange={(e) => actualizar("categoriaId", e.target.value)}><option value="">Seleccionar</option>{datos.categorias.map((item) => <option value={item.id} key={item.id}>{item.nombre}</option>)}</select></label>
              <label><span>Fecha de ingreso</span><input type="date" value={formulario.fechaIngreso} onChange={(e) => actualizar("fechaIngreso", e.target.value)} /></label>
              <label><span>Color en calendario</span><span className="color-input"><input type="color" value={formulario.color} onChange={(e) => actualizar("color", e.target.value)} /><code>{formulario.color}</code></span></label>
            </div>
            <div className="form-section-title"><BadgeCheck size={16} /><span>Saldo vacacional</span><small>Son conceptos diferentes</small></div>
            <div className="form-grid three-columns">
              <label><span>Días por derecho</span><input type="number" min="0" step="0.5" value={formulario.diasPorDerecho} onChange={(e) => actualizar("diasPorDerecho", Number(e.target.value))} /></label>
              <label><span>Acumulados a la fecha</span><input type="number" min="0" step="0.5" value={formulario.diasAcumulados} onChange={(e) => actualizar("diasAcumulados", Number(e.target.value))} /></label>
              <label><span>Disponibles actuales</span><input type="number" min="0" step="0.5" value={formulario.diasDisponibles} onChange={(e) => actualizar("diasDisponibles", Number(e.target.value))} /></label>
            </div>
            <footer><button className="secondary-button" type="button" onClick={() => setFormulario(null)}>Cancelar</button><button className="primary-button" type="submit" disabled={actualizando}>{actualizando ? "Guardando…" : "Guardar empleado"}</button></footer>
          </form>
        </div>
      )}
    </div>
  );
}
