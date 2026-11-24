"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { CircleX, Pencil, Trash2, X } from "lucide-react";
import { diasVacaciones, siguienteDiaHabil } from "../lib/diaHabil";
import { separarUrgencia } from "../lib/urgente";
import type { DiaFestivo, EdicionSolicitud, Empleado, PeriodoEdicion, SolicitudAusencia, SolicitudFormulario } from "../types";

// Flujo de edicion (017): el empleado pide el cambio con su motivo y el
// administrador lo aplica (pudiendo ajustar las fechas) o lo rechaza. Ambos
// casos quedan en la bitacora y se avisan por WhatsApp y correo.

export function textoPeriodo(periodo: PeriodoEdicion): string {
  const dias = periodo.dias === undefined ? "" : ` · ${periodo.dias} día(s)`;
  return `${format(parseISO(periodo.fechaInicio), "d MMM", { locale: es })} → ${format(parseISO(periodo.fechaFin), "d MMM yyyy", { locale: es })}${dias}`;
}

type Periodo = { fechaInicio: string; fechaFin: string; fechaReintegro: string };

function CamposPeriodo({ periodo, empleado, diasFestivos, onChange }: {
  periodo: Periodo;
  empleado: Empleado | undefined;
  diasFestivos: DiaFestivo[];
  onChange: (cambios: Partial<Periodo>) => void;
}) {
  const reintegroTras = (fechaFin: string) => siguienteDiaHabil(fechaFin, empleado?.diaDescanso, diasFestivos, empleado?.sedeId);
  // Si el inicio rebasa la fecha final, se arrastran la final y el reintegro:
  // de otro modo el formulario queda con una fecha final inválida que el
  // selector ya no deja corregir hacia atrás.
  const cambiarInicio = (fechaInicio: string) => onChange(fechaInicio && periodo.fechaFin && fechaInicio > periodo.fechaFin
    ? { fechaInicio, fechaFin: fechaInicio, fechaReintegro: reintegroTras(fechaInicio) }
    : { fechaInicio });
  return (
    <>
      <label><span>Fecha de inicio *</span><input required type="date" value={periodo.fechaInicio} onChange={(e) => cambiarInicio(e.target.value)} /></label>
      <label><span>Fecha final *</span><input required type="date" min={periodo.fechaInicio} value={periodo.fechaFin} onChange={(e) => onChange({ fechaFin: e.target.value, fechaReintegro: reintegroTras(e.target.value) })} /></label>
      <label><span>Fecha de reintegro *</span><input required type="date" min={periodo.fechaFin} value={periodo.fechaReintegro} onChange={(e) => onChange({ fechaReintegro: e.target.value })} /></label>
    </>
  );
}

export function SolicitarEdicionModal({ solicitud, empleado, diasFestivos, actualizando, error, onClose, onConfirm }: {
  solicitud: SolicitudAusencia;
  empleado: Empleado | undefined;
  diasFestivos: DiaFestivo[];
  actualizando: boolean;
  // Error de la última operación: el aviso general queda oculto tras el modal.
  error?: string | null;
  onClose: () => void;
  onConfirm: (propuesta: Periodo & { motivo: string }) => Promise<boolean>;
}) {
  const reintegroActual = solicitud.fechaReintegro ?? siguienteDiaHabil(solicitud.fechaFin, empleado?.diaDescanso, diasFestivos, empleado?.sedeId);
  const [periodo, setPeriodo] = useState<Periodo>({ fechaInicio: solicitud.fechaInicio, fechaFin: solicitud.fechaFin, fechaReintegro: reintegroActual });
  const [motivo, setMotivo] = useState("");
  const [intentado, setIntentado] = useState(false);
  const [rechazado, setRechazado] = useState(false);

  const periodoValido = Boolean(periodo.fechaInicio && periodo.fechaFin && periodo.fechaFin >= periodo.fechaInicio);
  const sinCambios = periodo.fechaInicio === solicitud.fechaInicio && periodo.fechaFin === solicitud.fechaFin && periodo.fechaReintegro === reintegroActual;
  const diasNuevos = periodoValido ? diasVacaciones(periodo.fechaInicio, periodo.fechaFin, empleado?.diaDescanso, diasFestivos, empleado?.sedeId) : 0;
  // El botón no se deshabilita por datos faltantes: al pulsarlo se explica qué
  // falta (antes quedaba gris sin decir por qué mientras el motivo estaba vacío).
  const falta = !periodo.fechaInicio || !periodo.fechaFin || !periodo.fechaReintegro ? "Completa las tres fechas del nuevo periodo."
    : !periodoValido ? "La fecha final no puede ser anterior a la fecha de inicio."
    : periodo.fechaReintegro < periodo.fechaFin ? "La fecha de reintegro no puede ser anterior a la fecha final."
    : sinCambios ? "Todavía no cambias ninguna fecha: ajusta el inicio, el final o el reintegro."
    : !motivo.trim() ? "Escribe el motivo de la edición para poder enviarla."
    : null;

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setIntentado(true);
    setRechazado(false);
    if (falta) return;
    if (await onConfirm({ ...periodo, motivo })) onClose();
    else setRechazado(true);
  };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) onClose(); }}>
      <form className="form-modal" onSubmit={enviar} noValidate>
        <header>
          <div className="form-title-with-icon"><span className="icon-tile amber"><Pencil size={18} /></span><div><span className="eyebrow">{solicitud.nombreEmpleado}</span><h2>Solicitar edición</h2></div></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar" title="Cerrar"><X size={19} /></button>
        </header>
        <p className="empty-note" style={{ marginBottom: 14 }}>Periodo actual: <strong>{textoPeriodo(solicitud)}</strong>. Indica cómo debe quedar y por qué; el administrador lo revisará y hará el cambio.</p>
        <div className="form-grid two-columns">
          <CamposPeriodo periodo={periodo} empleado={empleado} diasFestivos={diasFestivos} onChange={(cambios) => setPeriodo((actual) => ({ ...actual, ...cambios }))} />
          <div className="field-slot"><span style={{ display: "block", marginBottom: 6, color: "var(--muted)", fontSize: 12, fontWeight: 650 }}>Días del nuevo periodo</span><strong>{sinCambios ? "Sin cambios todavía" : periodoValido ? `${diasNuevos} día(s)` : "—"}</strong></div>
          <label className="span-two"><span>Motivo de la edición *</span><textarea required rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-invalid={intentado && !motivo.trim()} placeholder="Escribe aquí por qué cambian las fechas. Ej.: me equivoqué en la fecha final, regreso el lunes 19" /></label>
        </div>
        {intentado && falta && <p className="inline-alert error" role="alert" style={{ margin: "14px 0 0" }}>{falta}</p>}
        {rechazado && !falta && <p className="inline-alert error" role="alert" style={{ margin: "14px 0 0" }}>{error || "No se pudo enviar la solicitud de edición. Inténtalo de nuevo."}</p>}
        <footer>
          <button className="secondary-button" type="button" onClick={onClose} title="Cancelar">Cancelar</button>
          <button className="primary-button" type="submit" disabled={actualizando} title="Enviar solicitud de edición">{actualizando ? "Enviando…" : "Enviar solicitud de edición"}</button>
        </footer>
      </form>
    </div>
  );
}

// Antes de eliminar una solicitud que aún no se aprueba se ofrece corregir las
// fechas: con frecuencia se quiere eliminar solo para volver a capturarla.
export function EliminarSolicitudModal({ solicitud, propia, puedeEditar, edicionPendiente, actualizando, error, onClose, onEditar, onConfirm }: {
  solicitud: SolicitudAusencia;
  // true: la elimina su propio empleado; false: el administrador, de otra persona.
  propia: boolean;
  puedeEditar: boolean;
  edicionPendiente: boolean;
  actualizando: boolean;
  error?: string | null;
  onClose: () => void;
  onEditar: () => void;
  onConfirm: () => Promise<boolean>;
}) {
  const [rechazado, setRechazado] = useState(false);
  const eliminar = async () => {
    setRechazado(false);
    if (await onConfirm()) onClose();
    else setRechazado(true);
  };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) onClose(); }}>
      <div className="form-modal" role="dialog" aria-modal="true" aria-labelledby="titulo-eliminar-solicitud">
        <header>
          <div className="form-title-with-icon"><span className="icon-tile amber"><Trash2 size={18} /></span><div><span className="eyebrow">{solicitud.nombreEmpleado}</span><h2 id="titulo-eliminar-solicitud">¿Eliminar la solicitud?</h2></div></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar" title="Cerrar"><X size={19} /></button>
        </header>
        <p className="empty-note">Periodo: <strong>{textoPeriodo(solicitud)}</strong>. Aún no está aprobada: si la eliminas, sus {solicitud.dias} día(s) no se descontarán {propia ? "de tu saldo" : "del saldo del empleado"} y dejará de aparecer en el calendario. No se puede deshacer.</p>
        {puedeEditar
          ? <p style={{ margin: "16px 0 0" }}><strong>¿Prefieres cambiar las fechas en su lugar?</strong> Puedes pedir la edición del periodo sin perder la solicitud ni su avance en la revisión.</p>
          : edicionPendiente && <p style={{ margin: "16px 0 0" }}>Esta solicitud ya tiene una edición de fechas en espera del administrador; al eliminarla, esa edición se cierra.</p>}
        {rechazado && <p className="inline-alert error" role="alert" style={{ margin: "14px 0 0" }}>{error || "No se pudo eliminar la solicitud. Inténtalo de nuevo."}</p>}
        <footer>
          <button className="secondary-button" type="button" onClick={onClose} title="Conservar la solicitud como está">Cancelar</button>
          <button className="secondary-button danger-text" type="button" disabled={actualizando} onClick={() => void eliminar()} title="Eliminar la solicitud"><Trash2 size={15} />{actualizando ? "Eliminando…" : puedeEditar ? "No, eliminarla" : "Eliminar solicitud"}</button>
          {puedeEditar && <button className="primary-button" type="button" disabled={actualizando} onClick={onEditar} title="Ir a la edición de fechas"><Pencil size={15} />Sí, editar fechas</button>}
        </footer>
      </div>
    </div>
  );
}

export function AtenderEdicionModal({ edicion, solicitud, empleado, diasFestivos, actualizando, onClose, onAplicar, onRechazar }: {
  edicion: EdicionSolicitud;
  solicitud: SolicitudAusencia;
  empleado: Empleado | undefined;
  diasFestivos: DiaFestivo[];
  actualizando: boolean;
  onClose: () => void;
  onAplicar: (formulario: SolicitudFormulario, motivo: string) => Promise<boolean>;
  onRechazar: (motivo: string) => Promise<boolean>;
}) {
  // Se parte de lo que pidio el empleado; el administrador puede corregirlo.
  const [periodo, setPeriodo] = useState({
    fechaInicio: edicion.propuesta.fechaInicio,
    fechaFin: edicion.propuesta.fechaFin,
    fechaReintegro: edicion.propuesta.fechaReintegro ?? siguienteDiaHabil(edicion.propuesta.fechaFin, empleado?.diaDescanso, diasFestivos, empleado?.sedeId),
  });
  const [motivo, setMotivo] = useState("");
  const periodoValido = Boolean(periodo.fechaInicio && periodo.fechaFin && periodo.fechaFin >= periodo.fechaInicio);
  const diasNuevos = periodoValido ? diasVacaciones(periodo.fechaInicio, periodo.fechaFin, empleado?.diaDescanso, diasFestivos, empleado?.sedeId) : 0;
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
          <CamposPeriodo periodo={periodo} empleado={empleado} diasFestivos={diasFestivos} onChange={(cambios) => setPeriodo((actual) => ({ ...actual, ...cambios }))} />
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
