"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { CircleX, Pencil, X } from "lucide-react";
import { diasVacaciones, siguienteDiaHabil } from "../lib/diaHabil";
import { separarUrgencia } from "../lib/urgente";
import type { EdicionSolicitud, Empleado, PeriodoEdicion, SolicitudAusencia, SolicitudFormulario } from "../types";

// Flujo de edicion (017): el empleado pide el cambio con su motivo y el
// administrador lo aplica (pudiendo ajustar las fechas) o lo rechaza. Ambos
// casos quedan en la bitacora y se avisan por WhatsApp y correo.

export function textoPeriodo(periodo: PeriodoEdicion): string {
  const dias = periodo.dias === undefined ? "" : ` · ${periodo.dias} día(s)`;
  return `${format(parseISO(periodo.fechaInicio), "d MMM", { locale: es })} → ${format(parseISO(periodo.fechaFin), "d MMM yyyy", { locale: es })}${dias}`;
}

function CamposPeriodo({ periodo, onChange }: {
  periodo: { fechaInicio: string; fechaFin: string; fechaReintegro: string };
  onChange: (cambios: Partial<{ fechaInicio: string; fechaFin: string; fechaReintegro: string }>) => void;
}) {
  return (
    <>
      <label><span>Fecha de inicio *</span><input required type="date" value={periodo.fechaInicio} onChange={(e) => onChange({ fechaInicio: e.target.value })} /></label>
      <label><span>Fecha final *</span><input required type="date" min={periodo.fechaInicio} value={periodo.fechaFin} onChange={(e) => onChange({ fechaFin: e.target.value, fechaReintegro: siguienteDiaHabil(e.target.value) })} /></label>
      <label><span>Fecha de reintegro *</span><input required type="date" min={periodo.fechaFin} value={periodo.fechaReintegro} onChange={(e) => onChange({ fechaReintegro: e.target.value })} /></label>
    </>
  );
}

export function SolicitarEdicionModal({ solicitud, actualizando, onClose, onConfirm }: {
  solicitud: SolicitudAusencia;
  actualizando: boolean;
  onClose: () => void;
  onConfirm: (propuesta: { fechaInicio: string; fechaFin: string; fechaReintegro: string; motivo: string }) => Promise<boolean>;
}) {
  const [periodo, setPeriodo] = useState({
    fechaInicio: solicitud.fechaInicio,
    fechaFin: solicitud.fechaFin,
    fechaReintegro: solicitud.fechaReintegro ?? siguienteDiaHabil(solicitud.fechaFin),
  });
  const [motivo, setMotivo] = useState("");
  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    if (await onConfirm({ ...periodo, motivo })) onClose();
  };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) onClose(); }}>
      <form className="form-modal" onSubmit={enviar}>
        <header>
          <div className="form-title-with-icon"><span className="icon-tile amber"><Pencil size={18} /></span><div><span className="eyebrow">{solicitud.nombreEmpleado}</span><h2>Solicitar edición</h2></div></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar" title="Cerrar"><X size={19} /></button>
        </header>
        <p className="empty-note">Periodo actual: <strong>{textoPeriodo(solicitud)}</strong>. Indica cómo debe quedar y por qué; el administrador lo revisará y hará el cambio.</p>
        <div className="form-grid two-columns">
          <CamposPeriodo periodo={periodo} onChange={(cambios) => setPeriodo((actual) => ({ ...actual, ...cambios }))} />
          <label className="span-two"><span>Motivo de la edición *</span><textarea required rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Me equivoqué en la fecha final, regreso el lunes 19" /></label>
        </div>
        <footer>
          <button className="secondary-button" type="button" onClick={onClose} title="Cancelar">Cancelar</button>
          <button className="primary-button" type="submit" disabled={actualizando || !motivo.trim()} title="Enviar solicitud de edición">{actualizando ? "Enviando…" : "Enviar solicitud de edición"}</button>
        </footer>
      </form>
    </div>
  );
}

export function AtenderEdicionModal({ edicion, solicitud, empleado, actualizando, onClose, onAplicar, onRechazar }: {
  edicion: EdicionSolicitud;
  solicitud: SolicitudAusencia;
  empleado: Empleado | undefined;
  actualizando: boolean;
  onClose: () => void;
  onAplicar: (formulario: SolicitudFormulario, motivo: string) => Promise<boolean>;
  onRechazar: (motivo: string) => Promise<boolean>;
}) {
  // Se parte de lo que pidio el empleado; el administrador puede corregirlo.
  const [periodo, setPeriodo] = useState({
    fechaInicio: edicion.propuesta.fechaInicio,
    fechaFin: edicion.propuesta.fechaFin,
    fechaReintegro: edicion.propuesta.fechaReintegro ?? siguienteDiaHabil(edicion.propuesta.fechaFin),
  });
  const [motivo, setMotivo] = useState("");
  const periodoValido = Boolean(periodo.fechaInicio && periodo.fechaFin && periodo.fechaFin >= periodo.fechaInicio);
  const diasNuevos = periodoValido ? diasVacaciones(periodo.fechaInicio, periodo.fechaFin, empleado?.diaDescanso) : 0;
  const ajustada = periodo.fechaInicio !== edicion.propuesta.fechaInicio || periodo.fechaFin !== edicion.propuesta.fechaFin;
  const sinMotivo = !motivo.trim();

  const aplicar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    const { urgente, texto } = separarUrgencia(solicitud.comentarios);
    const formulario: SolicitudFormulario = { id: solicitud.id, empleadoId: solicitud.empleadoId, ...periodo, comentarios: texto, urgente };
    if (await onAplicar(formulario, motivo)) onClose();
  };
  const rechazar = async () => {
    if (sinMotivo) return;
    if (await onRechazar(motivo)) onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) onClose(); }}>
      <form className="form-modal" onSubmit={aplicar}>
        <header>
          <div className="form-title-with-icon"><span className="icon-tile amber"><Pencil size={18} /></span><div><span className="eyebrow">{solicitud.nombreEmpleado}</span><h2>Atender solicitud de edición</h2></div></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar" title="Cerrar"><X size={19} /></button>
        </header>
        <div className="inline-alert" style={{ display: "grid", gap: 4, color: "inherit" }}>
          <span><strong>Periodo actual:</strong> {textoPeriodo(solicitud)} · <span className={`status-pill ${solicitud.estado}`}>{solicitud.estado}</span></span>
          <span><strong>Pidió:</strong> {textoPeriodo(edicion.propuesta)}</span>
          <span><strong>Motivo{edicion.solicitadoPor ? ` (registró ${edicion.solicitadoPor})` : ""}:</strong> {edicion.motivo}</span>
        </div>
        <div className="form-grid two-columns">
          <CamposPeriodo periodo={periodo} onChange={(cambios) => setPeriodo((actual) => ({ ...actual, ...cambios }))} />
          <div className="field-slot"><span style={{ display: "block", marginBottom: 6, color: "var(--muted)", fontSize: 12, fontWeight: 650 }}>Días del nuevo periodo</span><strong>{diasNuevos} día(s){ajustada ? " · ajustado por ti" : ""}</strong></div>
          <label className="span-two"><span>Motivo de la edición o del rechazo * (se envía al empleado)</span><textarea required rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Se corrige la fecha final como lo solicitó" /></label>
        </div>
        <p className="empty-note">{solicitud.estado === "aprobada" ? "La solicitud ya está aprobada: al aplicar, el saldo del empleado se ajusta con la diferencia de días." : "La solicitud conserva la etapa de aprobación en la que está."} El empleado recibirá un correo y se avisará por WhatsApp.</p>
        <footer>
          <button className="secondary-button" type="button" onClick={onClose} title="Cancelar">Cancelar</button>
          <button className="secondary-button danger-text" type="button" disabled={actualizando || sinMotivo} onClick={() => void rechazar()} title={sinMotivo ? "Escribe el motivo del rechazo" : "Rechazar la edición"}><CircleX size={15} />Rechazar edición</button>
          <button className="primary-button" type="submit" disabled={actualizando || sinMotivo || !periodoValido} title="Aplicar edición">{actualizando ? "Guardando…" : "Aplicar edición"}</button>
        </footer>
      </form>
    </div>
  );
}

const ETIQUETA_ESTADO: Record<EdicionSolicitud["estado"], { texto: string; clase: string }> = {
  pendiente: { texto: "Pendiente", clase: "pendiente" },
  aplicada: { texto: "Aplicada", clase: "aprobada" },
  rechazada: { texto: "Rechazada", clase: "rechazada" },
};

// Bitacora visible en el detalle de la solicitud.
export function HistorialEdiciones({ ediciones }: { ediciones: EdicionSolicitud[] }) {
  if (!ediciones.length) return <p className="empty-note">Sin solicitudes de edición.</p>;
  return (
    <div className="timeline-list">
      {ediciones.map((edicion) => (
        <article key={edicion.id}>
          <div className="timeline-date"><strong>{format(parseISO(edicion.solicitadoEn), "dd")}</strong><span>{format(parseISO(edicion.solicitadoEn), "MMM", { locale: es })}</span></div>
          <div className="timeline-copy">
            <strong>Pidió: {textoPeriodo(edicion.propuesta)}{edicion.solicitadoPor ? ` · ${edicion.solicitadoPor}` : ""}</strong>
            <span>Motivo: {edicion.motivo}</span>
            {edicion.estado === "aplicada" && edicion.anterior && edicion.nuevo && <span>Cambio: {textoPeriodo(edicion.anterior)} ⇒ {textoPeriodo(edicion.nuevo)}</span>}
            {edicion.respuesta && <span>{edicion.estado === "rechazada" ? "Rechazo" : "Edición"}{edicion.resueltoPor ? ` (${edicion.resueltoPor})` : ""}{edicion.resueltoEn ? ` · ${format(parseISO(edicion.resueltoEn), "d MMM yyyy", { locale: es })}` : ""}: {edicion.respuesta}</span>}
          </div>
          <span className={`status-pill ${ETIQUETA_ESTADO[edicion.estado].clase}`}>{ETIQUETA_ESTADO[edicion.estado].texto}</span>
        </article>
      ))}
    </div>
  );
}
