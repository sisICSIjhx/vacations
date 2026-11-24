"use client";

import { useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Circle, CircleCheck, CircleX, Pencil, Trash2, X } from "lucide-react";
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

// Qué impide usar las fechas del periodo; null si son válidas.
function faltaEnPeriodo(periodo: Periodo): string | null {
  if (!periodo.fechaInicio || !periodo.fechaFin || !periodo.fechaReintegro) return "Completa las tres fechas del periodo";
  if (periodo.fechaFin < periodo.fechaInicio) return "La fecha final no puede ser anterior a la de inicio";
  if (periodo.fechaReintegro < periodo.fechaFin) return "El reintegro no puede ser anterior a la fecha final";
  return null;
}

// Lo que hace falta para enviar, a la vista desde que se abre el modal. Antes el
// botón quedaba gris sin explicación mientras el motivo estaba vacío y parecía
// que las fechas no se podían editar.
function Requisitos({ items, resaltar }: { items: { listo: boolean; texto: string }[]; resaltar: boolean }) {
  const incompleto = items.some((item) => !item.listo);
  return (
    <ul className={`requisitos-envio${resaltar && incompleto ? " resaltar" : ""}`} aria-label="Requisitos para enviar" aria-live="polite">
      {items.map((item) => (
        <li key={item.texto} className={item.listo ? "listo" : "falta"}>{item.listo ? <CircleCheck size={15} aria-hidden /> : <Circle size={15} aria-hidden />}<span>{item.listo ? "" : "Falta: "}{item.texto}</span></li>
      ))}
    </ul>
  );
}

function CampoMotivo({ etiqueta, ayuda, valor, invalido, referencia, onChange }: {
  etiqueta: string;
  ayuda: string;
  valor: string;
  // true tras intentar enviar sin motivo: se resalta en rojo.
  invalido: boolean;
  referencia: React.RefObject<HTMLTextAreaElement | null>;
  onChange: (valor: string) => void;
}) {
  return (
    <label className="span-two">
      <span>{etiqueta} *<b className="campo-obligatorio">Obligatorio</b></span>
      {/* El ejemplo va debajo, no como texto dentro del campo: ahí parecía un motivo ya escrito. */}
      <textarea ref={referencia} required rows={3} value={valor} onChange={(e) => onChange(e.target.value)} aria-invalid={invalido} placeholder="Escribe aquí el motivo" />
      <small className={`campo-ayuda${invalido ? " error" : ""}`}>{invalido ? "Este campo está vacío: escribe el motivo para poder continuar." : ayuda}</small>
    </label>
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
  const motivoRef = useRef<HTMLTextAreaElement>(null);

  const sinCambios = periodo.fechaInicio === solicitud.fechaInicio && periodo.fechaFin === solicitud.fechaFin && periodo.fechaReintegro === reintegroActual;
  const faltaFechas = faltaEnPeriodo(periodo) ?? (sinCambios ? "Cambia al menos una fecha del periodo" : null);
  const sinMotivo = !motivo.trim();
  const diasNuevos = faltaFechas ? 0 : diasVacaciones(periodo.fechaInicio, periodo.fechaFin, empleado?.diaDescanso, diasFestivos, empleado?.sedeId);

  const enviar = async (evento: React.FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    setRechazado(false);
    // El botón no se deshabilita por datos faltantes: se resalta lo que falta y
    // se lleva el cursor ahí.
    if (faltaFechas || sinMotivo) {
      setIntentado(true);
      if (faltaFechas) evento.currentTarget.querySelector<HTMLInputElement>('input[type="date"]')?.focus();
      else motivoRef.current?.focus();
      return;
    }
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
        <p className="empty-note" style={{ marginBottom: 14 }}>Periodo actual: <strong>{textoPeriodo(solicitud)}</strong>. Para pedir el cambio necesitas <strong>dos cosas</strong>: las fechas nuevas y el motivo. El administrador lo revisará y hará el cambio.</p>
        <div className="form-grid two-columns">
          <CamposPeriodo periodo={periodo} empleado={empleado} diasFestivos={diasFestivos} onChange={(cambios) => setPeriodo((actual) => ({ ...actual, ...cambios }))} />
          <div className="field-slot"><span style={{ display: "block", marginBottom: 6, color: "var(--muted)", fontSize: 12, fontWeight: 650 }}>Días del nuevo periodo</span><strong>{sinCambios ? "Sin cambios todavía" : faltaFechas ? "—" : `${diasNuevos} día(s)`}</strong></div>
          <CampoMotivo etiqueta="Motivo de la edición" ayuda="Ejemplo: me equivoqué en la fecha final, regreso el lunes 19." valor={motivo} invalido={intentado && sinMotivo} referencia={motivoRef} onChange={setMotivo} />
        </div>
        <Requisitos resaltar={intentado} items={[
          { listo: !faltaFechas, texto: faltaFechas ?? `Fechas nuevas: ${textoPeriodo(periodo)}` },
          { listo: !sinMotivo, texto: sinMotivo ? "Escribe el motivo de la edición" : "Motivo escrito" },
        ]} />
        {rechazado && <p className="inline-alert error" role="alert" style={{ margin: "14px 0 0" }}>{error || "No se pudo enviar la solicitud de edición. Inténtalo de nuevo."}</p>}
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

export function AtenderEdicionModal({ edicion, solicitud, empleado, diasFestivos, actualizando, error, onClose, onAplicar, onRechazar }: {
  edicion: EdicionSolicitud;
  solicitud: SolicitudAusencia;
  empleado: Empleado | undefined;
  diasFestivos: DiaFestivo[];
  actualizando: boolean;
  error?: string | null;
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
  const [intentado, setIntentado] = useState(false);
  const [rechazado, setRechazado] = useState(false);
  const motivoRef = useRef<HTMLTextAreaElement>(null);
  const faltaFechas = faltaEnPeriodo(periodo);
  const diasNuevos = faltaFechas ? 0 : diasVacaciones(periodo.fechaInicio, periodo.fechaFin, empleado?.diaDescanso, diasFestivos, empleado?.sedeId);
  const ajustada = periodo.fechaInicio !== edicion.propuesta.fechaInicio || periodo.fechaFin !== edicion.propuesta.fechaFin;
  const sinMotivo = !motivo.trim();
  const pedirMotivo = () => { setIntentado(true); motivoRef.current?.focus(); };

  const aplicar = async (evento: React.FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    setRechazado(false);
    if (faltaFechas) {
      setIntentado(true);
      evento.currentTarget.querySelector<HTMLInputElement>('input[type="date"]')?.focus();
      return;
    }
    if (sinMotivo) { pedirMotivo(); return; }
    const { urgente, texto } = separarUrgencia(solicitud.comentarios);
    const formulario: SolicitudFormulario = { id: solicitud.id, empleadoId: solicitud.empleadoId, ...periodo, comentarios: texto, urgente };
    if (await onAplicar(formulario, motivo)) onClose();
    else setRechazado(true);
  };
  const rechazar = async () => {
    setRechazado(false);
    if (sinMotivo) { pedirMotivo(); return; }
    if (await onRechazar(motivo)) onClose();
    else setRechazado(true);
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) onClose(); }}>
      <form className="form-modal" onSubmit={aplicar} noValidate>
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
          <div className="field-slot"><span style={{ display: "block", marginBottom: 6, color: "var(--muted)", fontSize: 12, fontWeight: 650 }}>Días del nuevo periodo</span><strong>{faltaFechas ? "—" : `${diasNuevos} día(s)${ajustada ? " · ajustado por ti" : ""}`}</strong></div>
          <CampoMotivo etiqueta="Motivo de la edición o del rechazo" ayuda="Se envía al empleado. Ejemplo: se corrige la fecha final como lo solicitó." valor={motivo} invalido={intentado && sinMotivo} referencia={motivoRef} onChange={setMotivo} />
        </div>
        <Requisitos resaltar={intentado} items={[
          { listo: !faltaFechas, texto: faltaFechas ?? `Periodo a aplicar: ${textoPeriodo(periodo)}` },
          { listo: !sinMotivo, texto: sinMotivo ? "Escribe el motivo (también para rechazar)" : "Motivo escrito" },
        ]} />
        {rechazado && <p className="inline-alert error" role="alert" style={{ margin: "14px 0 0" }}>{error || "No se pudo guardar. Inténtalo de nuevo."}</p>}
        <p className="empty-note" style={{ marginTop: 14 }}>{solicitud.estado === "aprobada" ? "La solicitud ya está aprobada: al aplicar, el saldo del empleado se ajusta con la diferencia de días." : "La solicitud conserva la etapa de aprobación en la que está."} El empleado recibirá un correo y se avisará por WhatsApp.</p>
        <footer>
          <button className="secondary-button" type="button" onClick={onClose} title="Cancelar">Cancelar</button>
          <button className="secondary-button danger-text" type="button" disabled={actualizando} onClick={() => void rechazar()} title="Rechazar la edición"><CircleX size={15} />Rechazar edición</button>
          <button className="primary-button" type="submit" disabled={actualizando} title="Aplicar edición">{actualizando ? "Guardando…" : "Aplicar edición"}</button>
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
