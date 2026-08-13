"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, UploadCloud } from "lucide-react";
import type { IncidenciaImportacion } from "../types";

interface ImportViewProps {
  incidencias: IncidenciaImportacion[];
  onImport: (archivo: File) => Promise<{ importadas: number; rechazadas: number; mensaje: string }>;
}

export function ImportView({ incidencias, onImport }: ImportViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [resultado, setResultado] = useState<{ importadas: number; rechazadas: number; mensaje: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const importar = async () => {
    if (!archivo) return;
    setProcesando(true);
    setError(null);
    try {
      setResultado(await onImport(archivo));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No fue posible importar el archivo.");
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div className="page-stack">
      <section className="page-title-row"><div><span className="eyebrow">Carga controlada</span><h1>Importar vacaciones</h1><p>Valida el CSV antes de incorporarlo al calendario y conserva la trazabilidad.</p></div></section>
      <div className="import-layout">
        <section className="content-card upload-card">
          <button className={`drop-zone ${archivo ? "selected" : ""}`} type="button" onClick={() => inputRef.current?.click()}>
            <input ref={inputRef} hidden type="file" accept=".csv,text/csv" onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setResultado(null); }} />
            <span className="upload-orbit"><UploadCloud size={28} /></span>
            <strong>{archivo ? archivo.name : "Selecciona tu archivo CSV"}</strong>
            <span>{archivo ? `${Math.ceil(archivo.size / 1024)} KB · listo para validar` : "Puedes usar el formato de planificación actual"}</span>
          </button>
          <div className="import-steps"><div><b>1</b><span><strong>Lectura</strong><small>Detectamos columnas y periodos</small></span></div><div><b>2</b><span><strong>Validación</strong><small>Fechas, personas y saldos</small></span></div><div><b>3</b><span><strong>Registro</strong><small>Solo se guardan filas válidas</small></span></div></div>
          {error && <div className="inline-alert error"><AlertTriangle size={17} />{error}</div>}
          {resultado && <div className="inline-alert success"><CheckCircle2 size={17} /><div><strong>{resultado.mensaje}</strong><span>{resultado.importadas} filas importadas · {resultado.rechazadas} rechazadas</span></div></div>}
          <button className="primary-button full-width" type="button" disabled={!archivo || procesando} onClick={importar}>{procesando ? "Validando archivo…" : "Validar e importar"}</button>
        </section>

        <section className="content-card issues-card">
          <header className="section-heading"><div><span className="eyebrow">Última revisión</span><h2>Incidencias detectadas</h2></div><FileSpreadsheet size={20} /></header>
          <div className="issue-list">
            {incidencias.length === 0 ? <p className="empty-note">No hay incidencias recientes.</p> : incidencias.map((incidencia) => <article key={incidencia.id} className={incidencia.gravedad}><AlertTriangle size={17} /><div><strong>Fila {incidencia.fila || "—"}</strong><span>{incidencia.mensaje}</span></div><small>{incidencia.gravedad}</small></article>)}
          </div>
          <p className="privacy-note">Los datos originales se conservan en el lote de importación para auditoría, pero una fila inválida nunca se muestra en el calendario.</p>
        </section>
      </div>
    </div>
  );
}
