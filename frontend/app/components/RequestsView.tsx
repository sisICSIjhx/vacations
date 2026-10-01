"use client";

import { useEffect, useMemo, useState } from "react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarPlus, Check, CircleX, Clock, Eye, Pencil, Plus, Search, Trash2, TriangleAlert, X } from "lucide-react";
import { Select } from "./Select";
import { separarUrgencia } from "../lib/urgente";
import { siguienteDiaHabil } from "../lib/diaHabil";
import { ANTICIPACION_MINIMA_DIAS, AvisoSinAnticipacion, PanelExtemporaneo, reglasAnticipacion } from "./RegistroExtemporaneo";
import { AtenderEdicionModal, HistorialEdiciones, SolicitarEdicionModal } from "./EdicionSolicitud";
import type {
  DatosVacaciones,
  DecisionRevision,
  EdicionSolicitud,
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
  // Flujo de edicion (017): el empleado la pide; el administrador la aplica o rechaza.
  onSolicitarEdicion: (solicitudId: string, propuesta: { fechaInicio: string; fechaFin: string; fechaReintegro: string; motivo: string }) => Promise<boolean>;
  onAplicarEdicion?: (edicionId: string, formulario: SolicitudFormulario, motivo: string) => Promise<boolean>;
  onRechazarEdicion?: (edicionId: string, motivo: string) => Promise<boolean>;
}

const estiloUrgente = { background: "#fdecea", border: "1px solid #f3b8b3", color: "#b3261e", fontWeight: 700 } as const;

function EtiquetaUrgente() {
  return <span className="status-pill" style={{ ...estiloUrgente, marginLeft: 6 }} title="Solicitud extraordinaria: puede aprobarse aunque no cumpla la anticipación mínima">🚨 Urgente</span>;
}

const NOMBRE_ETAPA: Record<EtapaAccionable, string> = {
  rrhh: "RRHH",
  jefe_inmediato: "Jefe inmediato",
  mesa_directiva: "Mesa Directiva",
};

const solicitudInicial: SolicitudFormulario = { empleadoId: "", fechaInicio: "", fechaFin: "", fechaReintegro: "", comentarios: "" };

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
  const { urgente, texto: motivoEmpleado } = separarUrgencia(solicitud.comentarios);
  const anticipacionInsuficiente = etapa === "rrhh" && decision === "aprobado" && diasAnticipacion < ANTICIPACION_MINIMA_DIAS;
  const extemporanea = !!solicitud.registroExtemporaneo;
  // Sin la marca de urgente ni de registro extemporáneo, la base de datos
  // rechaza la aprobación: se bloquea el botón.
  const bloqueadaPorAnticipacion = anticipacionInsuficiente && !urgente && !extemporanea;
  // El motivo del rechazo se envía al empleado por correo; la base de datos también lo exige.
  const faltaMotivo = decision === "rechazado" && comentario.trim() === "";
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
        {urgente && (
          <div className="inline-alert" style={{ ...estiloUrgente, fontWeight: 400 }}>
            <strong>🚨 Solicitud urgente.</strong>{anticipacionInsuficiente && <> Se pidió con {Math.max(diasAnticipacion, 0)} día(s) de anticipación (menos de los {ANTICIPACION_MINIMA_DIAS} requeridos), pero por estar marcada como urgente sí puede aprobarse.</>}
            {motivoEmpleado && <><br /><strong>Motivo del empleado:</strong> {motivoEmpleado}</>}
          </div>
        )}
        {extemporanea && anticipacionInsuficiente && (
          <div className="inline-alert" style={{ background: "color-mix(in srgb, #f59e0b 12%, transparent)", borderColor: "color-mix(in srgb, #f59e0b 45%, transparent)", color: "inherit" }}>
            <strong>Registro extemporáneo.</strong> La capturó un administrador fuera de plazo{solicitud.fechaSolicitud ? ` (solicitada el ${format(parseISO(solicitud.fechaSolicitud), "d MMM yyyy", { locale: es })})` : ""}, por lo que puede aprobarse aunque no cumpla los {ANTICIPACION_MINIMA_DIAS} días de anticipación.
          </div>
        )}
        {bloqueadaPorAnticipacion && (
          <div className="inline-alert error">
            <TriangleAlert size={15} /> <strong>No se puede aprobar:</strong> las vacaciones deben pedirse con al menos {ANTICIPACION_MINIMA_DIAS} días de anticipación y esta solicitud se hizo con {Math.max(diasAnticipacion, 0)} día(s). Recházala indicando que la reprograme, o pide al empleado que la marque como urgente y explique el motivo.
          </div>
        )}
        <div className="form-grid">
          <label><span>{decision === "rechazado" ? "Motivo del rechazo (obligatorio, se enviará al empleado por correo)" : "Comentario (opcional)"}</span><textarea rows={3} required={decision === "rechazado"} value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder={decision === "aprobado" ? "Notas para la siguiente etapa" : "Explica por qué se rechaza"} /></label>
        </div>
        <footer>
          <button className="secondary-button" type="button" onClick={onClose} title="Cancelar">Cancelar</button>
          <button className={decision === "aprobado" ? "primary-button" : "primary-button danger-button"} type="submit" disabled={actualizando || faltaMotivo || bloqueadaPorAnticipacion} title={actualizando ? "Guardando…" : decision === "aprobado" ? "Confirmar aprobación" : "Confirmar rechazo"}>{actualizando ? "Guardando…" : decision === "aprobado" ? "Confirmar aprobación" : "Confirmar rechazo"}</button>
        </footer>
      </form>
    </div>
  );
}

function DetailDrawer({ solicitud, empleado, ediciones, onClose, onObtenerRevisiones }: {
  solicitud: SolicitudAusencia;
  empleado: Empleado | undefined;
  ediciones: EdicionSolicitud[];
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
        {solicitud.comentarios && <div className="form-grid"><label><span>{separarUrgencia(solicitud.comentarios).urgente ? <>Motivo de la urgencia <EtiquetaUrgente /></> : "Comentario del empleado"}</span><p className="empty-note" style={{ textAlign: "left" }}>{separarUrgencia(solicitud.comentarios).texto || "—"}</p></label></div>}

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
        <div className="form-section-title"><Pencil size={16} /><span>Historial de ediciones</span></div>
        <HistorialEdiciones ediciones={ediciones} />
        <footer><button className="secondary-button" type="button" onClick={onClose} title="Cerrar">Cerrar</button></footer>
      </div>
    </div>
  );
}

export function RequestsView({ datos, perfil, actualizando, onCreate, onRevisar, onObtenerRevisiones, onCancelar, onDelete, onSolicitarEdicion, onAplicarEdicion, onRechazarEdicion }: RequestsViewProps) {
  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState("");
  const [formulario, setFormulario] = useState<SolicitudFormulario | null>(null);
  const [decisionActiva, setDecisionActiva] = useState<{ solicitud: SolicitudAusencia; etapa: EtapaAccionable; decision: DecisionRevision } | null>(null);
  const [detalleActivo, setDetalleActivo] = useState<SolicitudAusencia | null>(null);
  const [edicionActiva, setEdicionActiva] = useState<{ solicitud: SolicitudAusencia; edicion?: EdicionSolicitud } | null>(null);

  const edicionPendienteDe = (solicitudId: string) => datos.ediciones.find((item) => item.solicitudId === solicitudId && item.estado === "pendiente");
  const solicitudes = useMemo(() => solicitudesVisibles(perfil, datos.solicitudes, datos.empleados)
    .filter((solicitud) => !estado || (estado === "edicion"
      ? datos.ediciones.some((item) => item.solicitudId === solicitud.id && item.estado === "pendiente")
      : solicitud.estado === estado))
    .filter((solicitud) => solicitud.nombreEmpleado.toLowerCase().includes(busqueda.toLowerCase()))
    .sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio)), [busqueda, datos.ediciones, datos.empleados, datos.solicitudes, estado, perfil]);
  const edicionesPorAtender = perfil?.rol === "administrador" ? datos.ediciones.filter((item) => item.estado === "pendiente").length : 0;

  const empleadoDe = (solicitud: SolicitudAusencia) => datos.empleados.find((item) => item.id === solicitud.empleadoId);
  const esAutoservicio = perfil?.rol === "empleado";
  // Ver nota equivalente en VacationApp.RequestModal: una cuenta de
  // autoservicio sin empleado_id vinculado no puede crear solicitudes.
  const sinEmpleadoVinculado = esAutoservicio && !perfil?.empleadoId;
  const opcionesEmpleadoFormulario = esAutoservicio
    ? datos.empleados.filter((emp) => emp.id === perfil?.empleadoId)
    : datos.empleados.filter((emp) => emp.estado === "activo" || emp.id === formulario?.empleadoId);
  const empleadoElegido = datos.empleados.find((emp) => emp.id === formulario?.empleadoId);

  const actualizar = (campo: keyof SolicitudFormulario, valor: string) => setFormulario((actual) => {
    if (!actual) return actual;
    const siguiente = { ...actual, [campo]: valor };
    if (campo === "fechaFin") siguiente.fechaReintegro = siguienteDiaHabil(siguiente.fechaFin);
    return siguiente;
  });
  const reglas = reglasAnticipacion(formulario, perfil, false);
  const { sinAnticipacion } = reglas;
  const guardar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    if (!formulario || !onCreate || sinAnticipacion) return;
    const correcto = await onCreate(reglas.preparar(formulario));
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
          <label className="compact-select"><span>Estado</span><Select value={estado} onChange={setEstado}><option value="">Todos</option><option value="planeada">Planeada</option><option value="pendiente">Pendiente</option><option value="aprobada">Aprobada</option><option value="rechazada">Rechazada</option><option value="cancelada">Cancelada</option><option value="edicion">Con edición solicitada</option></Select></label>
          {edicionesPorAtender > 0 && <button className="secondary-button" type="button" onClick={() => setEstado("edicion")} title="Ver las solicitudes con edición pendiente"><Pencil size={15} />{edicionesPorAtender} {edicionesPorAtender === 1 ? "edición por atender" : "ediciones por atender"}</button>}
        </header>
        <div className="responsive-table-wrap">
          <table className="data-table request-table">
            <thead><tr><th>Empleado</th><th>Fecha de solicitud</th><th>Periodo</th><th>Días solicitados</th><th>Días tomados</th><th>Estado</th><th className="th-flex">Comentarios</th><th>Acciones</th></tr></thead>
            <tbody>
              {solicitudes.map((solicitud) => {
                const empleado = empleadoDe(solicitud);
                const { urgente, texto: comentarioVisible } = separarUrgencia(solicitud.comentarios);
                const etapaAccionable = etapaRevisable(perfil, solicitud, datos.empleados);
                // Nadie edita directo: el dueño (o el administrador en su nombre)
                // pide la edición y el administrador la atiende (017).
                const edicionPendiente = edicionPendienteDe(solicitud.id);
                const puedeAtender = Boolean(edicionPendiente && onAplicarEdicion && perfil?.rol === "administrador");
                const puedePedirEdicion = !edicionPendiente && ["planeada", "pendiente", "aprobada"].includes(solicitud.estado)
                  && (perfil?.rol === "administrador" || (Boolean(perfil?.empleadoId) && solicitud.empleadoId === perfil?.empleadoId));
                return (
                  <tr key={solicitud.id} className="row-clickable" onDoubleClick={() => setDetalleActivo(solicitud)} title="Doble clic para ver detalle">
                    <td><div className="person-cell"><span className="avatar small" style={{ background: solicitud.colorEmpleado }}>{solicitud.nombreEmpleado.split(" ").slice(0, 2).map((p) => p[0]).join("")}</span><strong>{solicitud.nombreEmpleado}</strong></div></td>
                    <td>{solicitud.fechaSolicitud ? format(parseISO(solicitud.fechaSolicitud), "d MMM yyyy", { locale: es }) : "—"}</td>
                    <td><span className="period-chip">{format(parseISO(solicitud.fechaInicio), "d MMM", { locale: es })}<span className="arrow">→</span>{format(parseISO(solicitud.fechaFin), "d MMM yyyy", { locale: es })}</span></td>
                    <td><span className="count-badge" title={`${solicitud.dias} día(s) solicitados`}>{solicitud.dias}</span></td>
                    <td><span className="count-chip">{empleado?.saldo.diasTomados ?? 0} días</span></td>
                    <td><span className={`status-pill ${solicitud.estado}`}>{textoEstado(solicitud)}</span>{urgente && <EtiquetaUrgente />}{edicionPendiente && <span className="status-pill pendiente" style={{ marginLeft: 6 }} title={`Edición solicitada: ${edicionPendiente.motivo}`}>✏️ Edición solicitada</span>}</td>
                    <td><span className="table-secondary truncate" style={{ maxWidth: 260, display: "inline-block" }} title={comentarioVisible || undefined}>{comentarioVisible || "—"}</span></td>
                    <td>
                      <div className="row-actions">
                        {etapaAccionable && <>
                          <button className="icon-button approve" type="button" disabled={actualizando} onClick={() => setDecisionActiva({ solicitud, etapa: etapaAccionable, decision: "aprobado" })} aria-label="Aprobar" title="Aprobar"><Check size={16} /></button>
                          <button className="icon-button reject" type="button" disabled={actualizando} onClick={() => setDecisionActiva({ solicitud, etapa: etapaAccionable, decision: "rechazado" })} aria-label="Rechazar" title="Rechazar"><CircleX size={16} /></button>
                        </>}
                        {onCancelar && solicitud.estado === "aprobada" && <button className="text-button danger-text" type="button" disabled={actualizando} onClick={() => onCancelar(solicitud.id, "cancelada")} aria-label={`Cancelar solicitud de ${solicitud.nombreEmpleado}`} title="Cancelar solicitud">Cancelar</button>}
                        <button className="icon-button subtle" type="button" onClick={() => setDetalleActivo(solicitud)} aria-label={`Ver detalle de la solicitud de ${solicitud.nombreEmpleado}`} title="Ver detalle"><Eye size={15} /></button>
                        {puedeAtender && <button className="icon-button approve" type="button" disabled={actualizando} onClick={() => setEdicionActiva({ solicitud, edicion: edicionPendiente })} aria-label={`Atender edición de ${solicitud.nombreEmpleado}`} title="Atender solicitud de edición"><Pencil size={15} /></button>}
                        {puedePedirEdicion && <button className="icon-button subtle" type="button" disabled={actualizando} onClick={() => setEdicionActiva({ solicitud })} aria-label={`Solicitar edición de la solicitud de ${solicitud.nombreEmpleado}`} title={perfil?.rol === "administrador" && solicitud.empleadoId !== perfil.empleadoId ? "Registrar solicitud de edición en nombre del empleado" : "Solicitar edición"}><Pencil size={15} /></button>}
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
            <header><div className="form-title-with-icon"><span className="icon-tile amber"><CalendarPlus size={18} /></span><div><span className="eyebrow">Calendario</span><h2>Nueva solicitud</h2></div></div><button className="icon-button" type="button" onClick={() => setFormulario(null)} aria-label="Cerrar" title="Cerrar"><X size={19} /></button></header>
            <div className="form-grid two-columns">
              {esAutoservicio ? (
                <div className="span-two stat-grid">
                  <div className="mini-stat"><span>Disponibles</span><strong>{empleadoElegido?.saldo.diasDisponibles ?? 0}</strong></div>
                  <div className="mini-stat"><span>Tomados</span><strong>{empleadoElegido?.saldo.diasTomados ?? 0}</strong></div>
                </div>
              ) : (
                <>
                  <label className="span-two"><span>Empleado *</span><Select value={formulario.empleadoId} onChange={(valor) => actualizar("empleadoId", valor)}><option value="">Seleccionar empleado</option>{opcionesEmpleadoFormulario.map((emp) => <option value={emp.id} key={emp.id}>{emp.nombre}</option>)}</Select></label>
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
              <label><span>Fecha de reintegro *</span><input required type="date" min={formulario.fechaFin} value={formulario.fechaReintegro} onChange={(e) => actualizar("fechaReintegro", e.target.value)} title="Por defecto, el siguiente día hábil; puede ser el mismo día de la fecha final" /></label>
              <div className="field-slot" style={{ display: "flex", flexDirection: "column" }}><span style={{ display: "block", marginBottom: 6, color: "var(--muted)", fontSize: 12, fontWeight: 650 }}>Tipo de solicitud</span><button type="button" className="secondary-button" aria-pressed={!!formulario.urgente} title="Marca la solicitud como no planeada; el comentario será obligatorio" onClick={() => setFormulario((actual) => actual && { ...actual, urgente: !actual.urgente })} style={{ width: "100%", minHeight: 48, justifyContent: "center", ...(formulario.urgente ? { background: "#fdecea", borderColor: "#d93025", color: "#b3261e" } : {}) }}>{formulario.urgente ? "🚨 Urgente" : "Marcar como urgente"}</button></div>
              <label className="span-two"><span>Comentarios{formulario.urgente ? " *" : ""}</span><textarea required={!!formulario.urgente} rows={3} value={formulario.comentarios} onChange={(e) => actualizar("comentarios", e.target.value)} placeholder={formulario.urgente ? "Explica el motivo urgente (obligatorio)" : "Información relevante para quienes revisan la solicitud"} /></label>
            </div>
            <PanelExtemporaneo formulario={formulario} reglas={reglas} onChange={(cambios) => setFormulario((actual) => actual && { ...actual, ...cambios })} />
            {sinAnticipacion && <AvisoSinAnticipacion />}
            <p className="empty-note">{reglas.notaFlujo}</p>
            <footer><button className="secondary-button" type="button" onClick={() => setFormulario(null)} title="Cancelar">Cancelar</button><button className="primary-button" type="submit" disabled={actualizando || sinAnticipacion} title={actualizando ? "Guardando…" : "Guardar solicitud"}>{actualizando ? "Guardando…" : "Guardar solicitud"}</button></footer>
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
          ediciones={datos.ediciones.filter((item) => item.solicitudId === detalleActivo.id)}
          onClose={() => setDetalleActivo(null)}
          onObtenerRevisiones={onObtenerRevisiones}
        />
      )}

      {edicionActiva && (edicionActiva.edicion && onAplicarEdicion && onRechazarEdicion ? (
        <AtenderEdicionModal
          edicion={edicionActiva.edicion}
          solicitud={edicionActiva.solicitud}
          empleado={empleadoDe(edicionActiva.solicitud)}
          actualizando={actualizando}
          onClose={() => setEdicionActiva(null)}
          onAplicar={(formularioEdicion, motivo) => onAplicarEdicion(edicionActiva.edicion!.id, formularioEdicion, motivo)}
          onRechazar={(motivo) => onRechazarEdicion(edicionActiva.edicion!.id, motivo)}
        />
      ) : (
        <SolicitarEdicionModal
          solicitud={edicionActiva.solicitud}
          actualizando={actualizando}
          onClose={() => setEdicionActiva(null)}
          onConfirm={(propuesta) => onSolicitarEdicion(edicionActiva.solicitud.id, propuesta)}
        />
      ))}
    </div>
  );
}
