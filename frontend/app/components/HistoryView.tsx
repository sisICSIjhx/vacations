"use client";

import { useEffect, useState } from "react";
import { History, RefreshCw, Search } from "lucide-react";
import { MODULOS, detalleActividad, tituloEvento, type ConsultarHistorial, type EventoActividad, type FiltrosHistorial, type PaginaHistorial } from "../lib/historial";
import type { PerfilUsuario } from "../types";

function fechaEvento(fecha: string) {
  if (!fecha || Number.isNaN(Date.parse(fecha))) return "Fecha no registrada";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" }).format(new Date(fecha));
}

export function ListaActividad({ eventos, onSolicitud }: { eventos: EventoActividad[]; onSolicitud?: (evento: EventoActividad) => void }) {
  return <ol className="activity-list">{eventos.map(evento => {
    const detalle = detalleActividad(evento);
    return <li key={evento.id} className={`activity-item activity-${evento.accion}`}>
      <span className="activity-marker"><History size={17} /></span>
      <div className="activity-body">
        <div className="activity-heading"><strong>{tituloEvento(evento)}</strong><span className="activity-module">{MODULOS[evento.modulo] ?? evento.modulo}</span></div>
        <p className="activity-subject">{evento.sujeto}</p>
        <p className="activity-meta"><strong>{evento.actor}</strong><span> · </span><time dateTime={evento.ocurridoEn || undefined}>{fechaEvento(evento.ocurridoEn)}</time>{evento.recuperado && <span className="activity-historical" title="Movimiento recuperado de la información que ya estaba guardada antes de activar el historial general.">Registro histórico</span>}</p>
        {evento.motivo && <p className="activity-reason"><strong>Motivo: </strong>{evento.motivo}</p>}
        {evento.solicitudId && onSolicitud && <button type="button" className="activity-request-link" onClick={() => onSolicitud(evento)}>Ver historial de esta solicitud</button>}
        {detalle.campos.length > 0 && <details className="activity-details"><summary>{detalle.titulo}</summary>
          {detalle.nota && <p className="activity-detail-note">{detalle.nota}</p>}
          <dl className="activity-changes">{detalle.campos.map(campo => <div className={`activity-change ${campo.anterior === undefined ? "activity-fact" : "activity-comparison"}`} key={campo.clave}><dt>{campo.etiqueta}</dt>{campo.anterior !== undefined ? <><dd><span className="activity-value-label">Valor anterior</span><span>{campo.anterior}</span></dd><dd><span className="activity-value-label">Valor nuevo</span><strong>{campo.valor}</strong></dd></> : <dd>{campo.valor}</dd>}</div>)}</dl>
        </details>}
      </div>
    </li>;
  })}</ol>;
}

export function PanelHistorial({ consultar, filtros, respaldo = [], onSolicitud }: { consultar: ConsultarHistorial; filtros: FiltrosHistorial; respaldo?: EventoActividad[]; onSolicitud?: (evento: EventoActividad) => void }) {
  const [pagina, setPagina] = useState(0);
  const [intento, setIntento] = useState(0);
  const [resultado, setResultado] = useState<{ clave: string; datos?: PaginaHistorial; error?: string } | null>(null);
  const clave = JSON.stringify({ ...filtros, pagina, intento });
  const { texto, modulo, desde, hasta, solicitudId } = filtros;
  useEffect(() => {
    let vigente = true;
    consultar({ texto, modulo, desde, hasta, solicitudId, pagina })
      .then(datos => { if (vigente) setResultado({ clave, datos }); })
      .catch((error: unknown) => { if (vigente) setResultado({ clave, error: error instanceof Error ? error.message : "No se pudo consultar el historial." }); });
    return () => { vigente = false; };
  }, [consultar, texto, modulo, desde, hasta, solicitudId, pagina, intento, clave]);
  const cargando = resultado?.clave !== clave;
  return <div className="activity-panel" aria-busy={cargando}>
    <div className="activity-toolbar"><span>Más reciente primero · Hora de Ciudad de México</span><button type="button" className="secondary-button" onClick={() => setIntento(i => i + 1)} disabled={cargando}><RefreshCw size={15} />Actualizar</button></div>
    {cargando ? <p className="empty-note" role="status">Cargando historial…</p> : resultado?.error ? <>
      <div className="inline-alert error" role="alert"><span>{resultado.error}</span><button type="button" className="secondary-button" onClick={() => setIntento(i => i + 1)}>Reintentar</button></div>
      {respaldo.length > 0 && <><p className="empty-note">Se muestra la evidencia disponible de esta solicitud. El historial completo no pudo cargarse.</p><ListaActividad eventos={respaldo} /></>}
    </> : resultado?.datos?.eventos.length ? <ListaActividad eventos={resultado.datos.eventos} onSolicitud={onSolicitud} /> : <p className="empty-note">No hay movimientos para estos filtros.</p>}
    {!cargando && !resultado?.error && <nav className="activity-pagination" aria-label="Páginas del historial"><button className="secondary-button" type="button" disabled={pagina === 0} onClick={() => setPagina(p => p - 1)}>Anterior</button><span>Página {pagina + 1}</span><button className="secondary-button" type="button" disabled={!resultado?.datos?.hayMas} onClick={() => setPagina(p => p + 1)}>Siguiente</button></nav>}
  </div>;
}

export function HistoryView({ consultar, perfil }: { consultar: ConsultarHistorial; perfil: PerfilUsuario | null }) {
  const [borrador, setBorrador] = useState({ texto: "", modulo: "", desde: "", hasta: "" });
  const [filtros, setFiltros] = useState(borrador);
  const [solicitud, setSolicitud] = useState<EventoActividad | null>(null);
  const gestion = perfil?.rol === "administrador" || perfil?.rol === "rrhh";
  return <div className="page-stack">
    <section className="page-heading"><div><h1>Historial</h1><p>Consulta quién hizo cada cambio, cuándo ocurrió y qué cambió.</p></div></section>
    <section className="content-card history-card">
      <form className="history-filters" onSubmit={e => { e.preventDefault(); setSolicitud(null); setFiltros({ ...borrador }); }}>
        <label className="history-search"><span>Buscar</span><div><Search size={16} /><input value={borrador.texto} onChange={e => setBorrador({ ...borrador, texto: e.target.value })} placeholder="Persona, acción o motivo" /></div></label>
        <label><span>Módulo</span><select value={borrador.modulo} onChange={e => setBorrador({ ...borrador, modulo: e.target.value })}><option value="">Todos los permitidos</option>{Object.entries(MODULOS).filter(([id]) => gestion ? id !== "accesos" || perfil?.rol === "administrador" : id === "solicitudes" || (id === "saldos" && perfil?.rol === "mesa_directiva")).map(([id,nombre]) => <option key={id} value={id}>{nombre}</option>)}</select></label>
        <label><span>Desde</span><input type="date" value={borrador.desde} max={borrador.hasta || undefined} onChange={e => setBorrador({ ...borrador, desde: e.target.value })} /></label>
        <label><span>Hasta</span><input type="date" value={borrador.hasta} min={borrador.desde || undefined} onChange={e => setBorrador({ ...borrador, hasta: e.target.value })} /></label>
        <button type="submit" className="primary-button">Filtrar</button><button type="button" className="secondary-button" onClick={() => { const vacios = { texto: "", modulo: "", desde: "", hasta: "" }; setSolicitud(null); setBorrador(vacios); setFiltros(vacios); }}>Limpiar</button>
      </form>
      <p className="history-note">Los registros anteriores incluyen únicamente la evidencia que ya estaba guardada. Los cambios nuevos se registran desde la activación del historial.</p>
      {solicitud && <div className="activity-toolbar"><strong>{solicitud.sujeto}</strong><button type="button" className="secondary-button" onClick={() => setSolicitud(null)}>Volver al historial general</button></div>}
      <PanelHistorial key={solicitud?.solicitudId ?? JSON.stringify(filtros)} consultar={consultar} filtros={solicitud ? { solicitudId: solicitud.solicitudId } : filtros} onSolicitud={solicitud ? undefined : setSolicitud} />
    </section>
  </div>;
}

