"use client";

import { useEffect, useMemo, useState } from "react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarPlus, Check, CircleX, Clock, Eye, Pencil, Plus, Search, Trash2, TriangleAlert, X } from "lucide-react";
import { Select } from "./Select";
import type {
  DatosVacaciones,
  DecisionRevision,
  Empleado,
  EtapaAprobacion,
  PerfilUsuario,
  RevisionSolicitud,
  SolicitudAusencia,
  SolicitudFormulario,
} from "../types";

type EtapaAccionable = Exclude<EtapaAprobacion, "aprobada" | "rechazada">;

interface RequestsViewProps {
  datos: DatosVacaciones;
  perfil: PerfilUsuario | null;
  actualizando: boolean;
  onCreate?: (formulario: SolicitudFormulario) => Promise<boolean>;
  onRevisar: (id: string, etapa: EtapaAccionable, decision: DecisionRevision, comentario?: string) => Promise<boolean>;
  onObtenerRevisiones: (id: string) => Promise<RevisionSolicitud[]>;
  onCancelar?: (id: string, estado: "cancelada") => Promise<boolean>;
  onDelete?: (id: string) => Promise<boolean>;
}

const ANTICIPACION_MINIMA_DIAS = 15;

const NOMBRE_ETAPA: Record<EtapaAccionable, string> = {
  rrhh: "RRHH",
  jefe_inmediato: "Jefe inmediato",
  mesa_directiva: "Mesa Directiva",
};

const solicitudInicial: SolicitudFormulario = { empleadoId: "", fechaInicio: "", fechaFin: "", fechaReintegro: "", comentarios: "" };

function desdeSolicitud(solicitud: SolicitudAusencia): SolicitudFormulario {
  return {
    id: solicitud.id,
    empleadoId: solicitud.empleadoId,
    fechaInicio: solicitud.fechaInicio,
    fechaFin: solicitud.fechaFin,
    fechaReintegro: solicitud.fechaReintegro ?? "",
    comentarios: solicitud.comentarios ?? "",
  };
}

// Etiqueta visible del estado: mientras esta pendiente, muestra ademas la
// etapa del flujo (RRHH / Jefe inmediato / Mesa Directiva) que debe actuar; si
// fue rechazada, muestra que etapa la rechazo. El color sigue viniendo del
// estado grueso existente (status-pill.pendiente/aprobada/rechazada/...).
function textoEstado(solicitud: SolicitudAusencia): string {
  if (solicitud.estado === "pendiente" && solicitud.etapaAprobacion in NOMBRE_ETAPA) {
    return `Pendiente · ${NOMBRE_ETAPA[solicitud.etapaAprobacion as EtapaAccionable]}`;
  }
  if (solicitud.estado === "rechazada" && solicitud.etapaRechazo) {
    return `Rechazada · ${NOMBRE_ETAPA[solicitud.etapaRechazo]}`;
  }
  return solicitud.estado;
}

// Determina si el usuario actual puede aprobar/rechazar esta solicitud ahora
// mismo, y en cuál etapa. Un administrador puede actuar en cualquier etapa
// abierta; RRHH y Mesa Directiva solo en la etapa homónima; un jefe inmediato
// (rol "empleado" con reportes directos) solo sobre sus propios reportes y
// solo cuando la solicitud está justo en la etapa de jefe.
// Acota que solicitudes puede ver cada rol, en el mismo criterio que ya
// aplica el RLS de la base real (lectura_solicitud_propia/_rrhh_mesa/
// _jefe_inmediato): administrador/RRHH/Mesa Directiva ven todo; un "empleado"
// solo ve las propias y, si ademas es jefe inmediato, las de sus reportes
// directos. En modo demostracion no hay RLS real, asi que este filtro es el
// que reproduce ese alcance; en modo real es una capa extra inofensiva (los
// datos que llegan del hook ya vienen acotados por RLS).
function solicitudesVisibles(perfil: PerfilUsuario | null, solicitudes: SolicitudAusencia[], empleados: Empleado[]): SolicitudAusencia[] {
  if (!perfil) return [];
  if (perfil.rol === "administrador" || perfil.rol === "rrhh" || perfil.rol === "mesa_directiva") return solicitudes;
  return solicitudes.filter((solicitud) => {
    if (solicitud.empleadoId === perfil.empleadoId) return true;
    if (!perfil.esJefeInmediato) return false;
    const empleado = empleados.find((item) => item.id === solicitud.empleadoId);
    return empleado?.jefeInmediatoId === perfil.empleadoId;
  });
}

function etapaRevisable(perfil: PerfilUsuario | null, solicitud: SolicitudAusencia, empleados: Empleado[]): EtapaAccionable | null {
  if (!perfil) return null;
  // "planeada" es un balde distinto (historico/CSV, sin revision activa): solo
  // es accionable una solicitud realmente en curso ('pendiente').
  if (solicitud.estado !== "pendiente") return null;
  const etapa = solicitud.etapaAprobacion;
  if (etapa !== "rrhh" && etapa !== "jefe_inmediato" && etapa !== "mesa_directiva") return null;
  if (perfil.rol === "administrador") return etapa;
  if (perfil.rol === "rrhh") return etapa === "rrhh" ? "rrhh" : null;
  if (perfil.rol === "mesa_directiva") return etapa === "mesa_directiva" ? "mesa_directiva" : null;
  if (perfil.rol === "empleado" && perfil.esJefeInmediato && etapa === "jefe_inmediato") {
    const empleado = empleados.find((item) => item.id === solicitud.empleadoId);
    return empleado?.jefeInmediatoId === perfil.empleadoId ? "jefe_inmediato" : null;
  }
  return null;
}

function DecisionModal({ solicitud, etapa, decision, onClose, onConfirm, actualizando }: {
  solicitud: SolicitudAusencia;
  etapa: EtapaAccionable;
  decision: DecisionRevision;
  onClose: () => void;
  onConfirm: (comentario: string) => Promise<boolean>;
  actualizando: boolean;
}) {
  const [comentario, setComentario] = useState("");
  const diasAnticipacion = differenceInCalendarDays(parseISO(solicitud.fechaInicio), new Date());
  const anticipacionInsuficiente = etapa === "rrhh" && decision === "aprobado" && diasAnticipacion < ANTICIPACION_MINIMA_DIAS;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) onClose(); }}>
      <form className="form-modal" onSubmit={(evento) => { evento.preventDefault(); void onConfirm(comentario); }}>
        <header>
          <div className="form-title-with-icon">
            <span className={`icon-tile ${decision === "aprobado" ? "green" : "red"}`}>{decision === "aprobado" ? <Check size={18} /> : <CircleX size={18} />}</span>
            <div><span className="eyebrow">{NOMBRE_ETAPA[etapa]}</span><h2>{decision === "aprobado" ? "Aprobar solicitud" : "Rechazar solicitud"}</h2></div>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar" title="Cerrar"><X size={19} /></button>
        </header>
        <p className="empty-note">
          {solicitud.nombreEmpleado} · {format(parseISO(solicitud.fechaInicio), "d MMM", { locale: es })} — {format(parseISO(solicitud.fechaFin), "d MMM yyyy", { locale: es })} · {solicitud.dias} día(s)
        </p>
        {anticipacionInsuficiente && (
          <div className="inline-alert error">
            <TriangleAlert size={15} /> No cumple la anticipación mínima de {ANTICIPACION_MINIMA_DIAS} días (faltan {ANTICIPACION_MINIMA_DIAS - diasAnticipacion} día(s)). RRHH no podrá aprobarla hasta cumplirla; considera rechazarla o pedir que se reprograme.
          </div>
        )}
        <div className="form-grid">
          <label><span>Comentario {decision === "rechazado" ? "(motivo del rechazo)" : "(opcional)"}</span><textarea rows={3} value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder={decision === "aprobado" ? "Notas para la siguiente etapa" : "Explica por qué se rechaza"} /></label>
        </div>
        <footer>
          <button className="secondary-button" type="button" onClick={onClose} title="Cancelar">Cancelar</button>
          <button className={decision === "aprobado" ? "primary-button" : "primary-button danger-button"} type="submit" disabled={actualizando} title={actualizando ? "Guardando…" : decision === "aprobado" ? "Confirmar aprobación" : "Confirmar rechazo"}>{actualizando ? "Guardando…" : decision === "aprobado" ? "Confirmar aprobación" : "Confirmar rechazo"}</button>
        </footer>
      </form>
    </div>
  );
}

function DetailDrawer({ solicitud, empleado, onClose, onObtenerRevisiones }: {
  solicitud: SolicitudAusencia;
  empleado: Empleado | undefined;
  onClose: () => void;
  onObtenerRevisiones: (id: string) => Promise<RevisionSolicitud[]>;
}) {
  const [revisiones, setRevisiones] = useState<RevisionSolicitud[] | null>(null);
  useEffect(() => {
    let cancelado = false;
    void onObtenerRevisiones(solicitud.id).then((datos) => { if (!cancelado) setRevisiones(datos); });
    return () => { cancelado = true; };
  }, [onObtenerRevisiones, solicitud.id]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) onClose(); }}>
      <div className="form-modal">
        <header>
          <div className="form-title-with-icon">
            <span className="avatar small" style={{ background: solicitud.colorEmpleado }}>{solicitud.nombreEmpleado.split(" ").slice(0, 2).map((p) => p[0]).join("")}</span>
            <div><span className="eyebrow">Detalle de la solicitud</span><h2>{solicitud.nombreEmpleado}</h2></div>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar" title="Cerrar"><X size={19} /></button>
        </header>

        <div className="form-grid two-columns">
          <label><span>Fecha de solicitud</span><strong>{solicitud.fechaSolicitud ? format(parseISO(solicitud.fechaSolicitud), "d MMM yyyy, HH:mm", { locale: es }) : "—"}</strong></label>
          <label><span>Periodo</span><strong>{format(parseISO(solicitud.fechaInicio), "d MMM", { locale: es })} — {format(parseISO(solicitud.fechaFin), "d MMM yyyy", { locale: es })}</strong></label>
          <label><span>Días solicitados</span><strong>{solicitud.dias}</strong></label>
          <label><span>Días tomados (acumulado {empleado?.saldo.anio ?? ""})</span><strong>{empleado?.saldo.diasTomados ?? 0}</strong></label>
          <label><span>Días disponibles</span><strong>{empleado?.saldo.diasDisponibles ?? 0}</strong></label>
          <label><span>Estado actual</span><span className={`status-pill ${solicitud.estado}`} style={{ width: "fit-content" }}>{textoEstado(solicitud)}</span></label>
        </div>
        {solicitud.comentarios && <div className="form-grid"><label><span>Comentario del empleado</span><p className="empty-note" style={{ textAlign: "left" }}>{solicitud.comentarios}</p></label></div>}

        <div className="form-section-title"><Clock size={16} /><span>Historial de aprobaciones</span></div>
        {revisiones === null ? (
          <p className="empty-note">Cargando historial…</p>
        ) : revisiones.length === 0 ? (
          <p className="empty-note">Todavía no hay decisiones registradas; está pendiente de {NOMBRE_ETAPA[(solicitud.etapaAprobacion in NOMBRE_ETAPA ? solicitud.etapaAprobacion : "rrhh") as EtapaAccionable]}.</p>
        ) : (
          <div className="timeline-list">
            {revisiones.map((revision) => (
              <article key={revision.id}>
                <div className="timeline-date"><strong>{format(parseISO(revision.creadoEn), "dd")}</strong><span>{format(parseISO(revision.creadoEn), "MMM", { locale: es })}</span></div>
                <div className="timeline-copy">
                  <strong>{NOMBRE_ETAPA[revision.etapa]}{revision.nombreRevisor ? ` · ${revision.nombreRevisor}` : ""}</strong>
                  <span>{revision.comentario || "Sin comentario"}</span>
                </div>
                <span className={`status-pill ${revision.decision === "aprobado" ? "aprobada" : "rechazada"}`}>{revision.decision === "aprobado" ? "Aprobado" : "Rechazado"}</span>
              </article>
            ))}
          </div>
        )}
        <footer><button className="secondary-button" type="button" onClick={onClose} title="Cerrar">Cerrar</button></footer>
      </div>
    </div>
  );
}

export function RequestsView({ datos, perfil, actualizando, onCreate, onRevisar, onObtenerRevisiones, onCancelar, onDelete }: RequestsViewProps) {
  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState("");
  const [formulario, setFormulario] = useState<SolicitudFormulario | null>(null);
  const [decisionActiva, setDecisionActiva] = useState<{ solicitud: SolicitudAusencia; etapa: EtapaAccionable; decision: DecisionRevision } | null>(null);
  const [detalleActivo, setDetalleActivo] = useState<SolicitudAusencia | null>(null);

  const solicitudes = useMemo(() => solicitudesVisibles(perfil, datos.solicitudes, datos.empleados)
    .filter((solicitud) => !estado || solicitud.estado === estado)
    .filter((solicitud) => solicitud.nombreEmpleado.toLowerCase().includes(busqueda.toLowerCase()))
    .sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio)), [busqueda, datos.empleados, datos.solicitudes, estado, perfil]);

  const empleadoDe = (solicitud: SolicitudAusencia) => datos.empleados.find((item) => item.id === solicitud.empleadoId);
  const esAutoservicio = perfil?.rol === "empleado";
  // Ver nota equivalente en VacationApp.RequestModal: una cuenta de
  // autoservicio sin empleado_id vinculado no puede crear solicitudes.
  const sinEmpleadoVinculado = esAutoservicio && !perfil?.empleadoId;
  const opcionesEmpleadoFormulario = esAutoservicio
    ? datos.empleados.filter((emp) => emp.id === perfil?.empleadoId)
    : datos.empleados.filter((emp) => emp.estado === "activo" || emp.id === formulario?.empleadoId);
  const empleadoElegido = datos.empleados.find((emp) => emp.id === formulario?.empleadoId);

  const editando = Boolean(formulario?.id);
  const actualizar = (campo: keyof SolicitudFormulario, valor: string) => setFormulario((actual) => {
    if (!actual) return actual;
    const siguiente = { ...actual, [campo]: valor };
    if ((campo === "fechaInicio" || campo === "fechaFin") && siguiente.fechaReintegro && siguiente.fechaReintegro <= siguiente.fechaFin) {
      siguiente.fechaReintegro = "";
    }
    return siguiente;
  });
  const guardar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    if (!formulario || !onCreate) return;
    const correcto = await onCreate(formulario);
    if (correcto) setFormulario(null);
  };
  const eliminar = (solicitud: SolicitudAusencia) => {
    if (!onDelete) return;
    const mensaje = solicitud.estado === "aprobada"
      ? `¿Eliminar la solicitud de ${solicitud.nombreEmpleado}? Los días se reintegrarán a su saldo disponible.`
      : `¿Eliminar la solicitud de ${solicitud.nombreEmpleado}?`;
    if (window.confirm(mensaje)) void onDelete(solicitud.id);
  };
  const confirmarDecision = async (comentario: string) => {
    if (!decisionActiva) return false;
    const correcto = await onRevisar(decisionActiva.solicitud.id, decisionActiva.etapa, decisionActiva.decision, comentario || undefined);
    if (correcto) setDecisionActiva(null);
    return correcto;
  };

  return (
    <div className="page-stack">
      <section className="page-title-row">
        <div><span className="eyebrow">Control de ausencias</span><h1>Solicitudes</h1><p>RRHH → Jefe inmediato → Mesa Directiva: flujo de aprobación de vacaciones.</p></div>
        {onCreate && <button className="primary-button" type="button" disabled={sinEmpleadoVinculado} onClick={() => setFormulario({ ...solicitudInicial, empleadoId: esAutoservicio ? perfil?.empleadoId ?? "" : "" })} title={sinEmpleadoVinculado ? "Tu cuenta no está vinculada a un empleado; contacta a RRHH o Administración" : "Nueva solicitud"}><Plus size={17} />Nueva solicitud</button>}
      </section>
      <section className="content-card table-card">
        <header className="table-toolbar request-toolbar">
          {/* Buscar por empleado no aporta nada cuando el usuario solo ve sus
              propias solicitudes (o, si es jefe inmediato, las de un puñado
              de reportes directos). */}
          {!esAutoservicio && <div className="search-field"><Search size={17} /><input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar empleado" /></div>}
          <label className="compact-select"><span>Estado</span><Select value={estado} onChange={setEstado}><option value="">Todos</option><option value="planeada">Planeada</option><option value="pendiente">Pendiente</option><option value="aprobada">Aprobada</option><option value="rechazada">Rechazada</option><option value="cancelada">Cancelada</option></Select></label>
        </header>
        <div className="responsive-table-wrap">
          <table className="data-table request-table">
            <thead><tr><th>Empleado</th><th>Fecha de solicitud</th><th>Periodo</th><th>Días solicitados</th><th>Días tomados</th><th>Estado</th><th className="th-flex">Comentarios</th><th>Acciones</th></tr></thead>
            <tbody>
              {solicitudes.map((solicitud) => {
                const empleado = empleadoDe(solicitud);
                const etapaAccionable = etapaRevisable(perfil, solicitud, datos.empleados);
                const puedeEditar = Boolean(onCreate) && solicitud.etapaAprobacion === "rrhh" && ["planeada", "pendiente"].includes(solicitud.estado)
                  && (perfil?.rol === "administrador" || (perfil?.rol === "empleado" && solicitud.empleadoId === perfil.empleadoId));
                return (
                  <tr key={solicitud.id} className="row-clickable" onDoubleClick={() => setDetalleActivo(solicitud)} title="Doble clic para ver detalle">
                    <td><div className="person-cell"><span className="avatar small" style={{ background: solicitud.colorEmpleado }}>{solicitud.nombreEmpleado.split(" ").slice(0, 2).map((p) => p[0]).join("")}</span><strong>{solicitud.nombreEmpleado}</strong></div></td>
                    <td>{solicitud.fechaSolicitud ? format(parseISO(solicitud.fechaSolicitud), "d MMM yyyy", { locale: es }) : "—"}</td>
                    <td><span className="period-chip">{format(parseISO(solicitud.fechaInicio), "d MMM", { locale: es })}<span className="arrow">→</span>{format(parseISO(solicitud.fechaFin), "d MMM yyyy", { locale: es })}</span></td>
                    <td><span className="count-badge" title={`${solicitud.dias} día(s) solicitados`}>{solicitud.dias}</span></td>
                    <td><span className="count-chip">{empleado?.saldo.diasTomados ?? 0} días</span></td>
                    <td><span className={`status-pill ${solicitud.estado}`}>{textoEstado(solicitud)}</span></td>
                    <td><span className="table-secondary truncate" style={{ maxWidth: 260, display: "inline-block" }}>{solicitud.comentarios || "—"}</span></td>
                    <td>
                      <div className="row-actions">
                        {etapaAccionable && <>
                          <button className="icon-button approve" type="button" disabled={actualizando} onClick={() => setDecisionActiva({ solicitud, etapa: etapaAccionable, decision: "aprobado" })} aria-label="Aprobar" title="Aprobar"><Check size={16} /></button>
                          <button className="icon-button reject" type="button" disabled={actualizando} onClick={() => setDecisionActiva({ solicitud, etapa: etapaAccionable, decision: "rechazado" })} aria-label="Rechazar" title="Rechazar"><CircleX size={16} /></button>
                        </>}
                        {onCancelar && solicitud.estado === "aprobada" && <button className="text-button danger-text" type="button" disabled={actualizando} onClick={() => onCancelar(solicitud.id, "cancelada")} aria-label={`Cancelar solicitud de ${solicitud.nombreEmpleado}`} title="Cancelar solicitud">Cancelar</button>}
                        <button className="icon-button subtle" type="button" onClick={() => setDetalleActivo(solicitud)} aria-label={`Ver detalle de la solicitud de ${solicitud.nombreEmpleado}`} title="Ver detalle"><Eye size={15} /></button>
                        {puedeEditar && <button className="icon-button subtle" type="button" disabled={actualizando} onClick={() => setFormulario(desdeSolicitud(solicitud))} aria-label={`Editar solicitud de ${solicitud.nombreEmpleado}`} title="Editar solicitud"><Pencil size={15} /></button>}
                        {onDelete && <button className="icon-button subtle danger" type="button" disabled={actualizando} onClick={() => eliminar(solicitud)} aria-label={`Eliminar solicitud de ${solicitud.nombreEmpleado}`} title="Eliminar solicitud"><Trash2 size={15} /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {formulario && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) setFormulario(null); }}>
          <form className="form-modal request-form" onSubmit={guardar}>
            <header><div className="form-title-with-icon"><span className="icon-tile amber"><CalendarPlus size={18} /></span><div><span className="eyebrow">Calendario</span><h2>{editando ? "Editar solicitud" : "Nueva solicitud"}</h2></div></div><button className="icon-button" type="button" onClick={() => setFormulario(null)} aria-label="Cerrar" title="Cerrar"><X size={19} /></button></header>
            <div className="form-grid two-columns">
              {esAutoservicio ? (
                <div className="span-two stat-grid">
                  <div className="mini-stat"><span>Disponibles</span><strong>{empleadoElegido?.saldo.diasDisponibles ?? 0}</strong></div>
                  <div className="mini-stat"><span>Tomados</span><strong>{empleadoElegido?.saldo.diasTomados ?? 0}</strong></div>
                </div>
              ) : (
                <>
                  <label className="span-two"><span>Empleado *</span><Select disabled={editando} value={formulario.empleadoId} onChange={(valor) => actualizar("empleadoId", valor)}><option value="">Seleccionar empleado</option>{opcionesEmpleadoFormulario.map((emp) => <option value={emp.id} key={emp.id}>{emp.nombre}</option>)}</Select></label>
                  {empleadoElegido && (
                    <div className="span-two stat-grid">
                      <div className="mini-stat"><span>Disponibles</span><strong>{empleadoElegido.saldo.diasDisponibles}</strong></div>
                      <div className="mini-stat"><span>Tomados</span><strong>{empleadoElegido.saldo.diasTomados}</strong></div>
                    </div>
                  )}
                </>
              )}
              <label><span>Fecha de inicio *</span><input required type="date" value={formulario.fechaInicio} onChange={(e) => actualizar("fechaInicio", e.target.value)} /></label>
              <label><span>Fecha final *</span><input required type="date" min={formulario.fechaInicio} value={formulario.fechaFin} onChange={(e) => actualizar("fechaFin", e.target.value)} /></label>
              <label><span>Fecha de reintegro</span><input type="date" min={formulario.fechaFin} value={formulario.fechaReintegro} onChange={(e) => actualizar("fechaReintegro", e.target.value)} /></label>
              <label className="span-two"><span>Comentarios</span><textarea rows={3} value={formulario.comentarios} onChange={(e) => actualizar("comentarios", e.target.value)} placeholder="Información relevante para quienes revisan la solicitud" /></label>
            </div>
            <p className="empty-note">{editando ? "Esta solicitud sigue en RRHH; en cuanto avance de etapa ya no podrá editarse." : "La solicitud entra al flujo de aprobación: RRHH → Jefe inmediato → Mesa Directiva."}</p>
            <footer><button className="secondary-button" type="button" onClick={() => setFormulario(null)} title="Cancelar">Cancelar</button><button className="primary-button" type="submit" disabled={actualizando} title={actualizando ? "Guardando…" : "Guardar solicitud"}>{actualizando ? "Guardando…" : "Guardar solicitud"}</button></footer>
          </form>
        </div>
      )}

      {decisionActiva && (
        <DecisionModal
          solicitud={decisionActiva.solicitud}
          etapa={decisionActiva.etapa}
          decision={decisionActiva.decision}
          actualizando={actualizando}
          onClose={() => setDecisionActiva(null)}
          onConfirm={confirmarDecision}
        />
      )}

      {detalleActivo && (
        <DetailDrawer
          solicitud={detalleActivo}
          empleado={empleadoDe(detalleActivo)}
          onClose={() => setDetalleActivo(null)}
          onObtenerRevisiones={onObtenerRevisiones}
        />
      )}
    </div>
  );
}
