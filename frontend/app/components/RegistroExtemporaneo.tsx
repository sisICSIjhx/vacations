"use client";

import { differenceInCalendarDays, parseISO } from "date-fns";
import type { PerfilUsuario, SolicitudFormulario } from "../types";

export const ANTICIPACION_MINIMA_DIAS = 15;

// Reglas de anticipación compartidas por los dos formularios de solicitud
// (sección Solicitudes y "Crear solicitud" del calendario). El administrador
// puede capturar solicitudes pasadas o fuera de plazo en lugar de quedar
// bloqueado; el resto solo con la marca de urgente.
export function reglasAnticipacion(formulario: SolicitudFormulario | null, perfil: PerfilUsuario | null, editando: boolean) {
  const fueraDePlazo = !!formulario?.fechaInicio
    && differenceInCalendarDays(parseISO(formulario.fechaInicio), new Date()) < ANTICIPACION_MINIMA_DIAS;
  const puedeRegistrarPasadas = perfil?.rol === "administrador" && !editando;
  const registroExtemporaneo = puedeRegistrarPasadas && fueraDePlazo;
  const yaAprobada = formulario?.yaAprobada ?? true;
  const descontarSaldo = formulario?.descontarSaldo ?? true;
  return {
    puedeRegistrarPasadas,
    registroExtemporaneo,
    sinAnticipacion: fueraDePlazo && !formulario?.urgente && !registroExtemporaneo,
    yaAprobada,
    preparar: (f: SolicitudFormulario): SolicitudFormulario => registroExtemporaneo
      ? { ...f, extemporanea: true, yaAprobada, descontarSaldo }
      : { ...f, extemporanea: false },
    notaFlujo: registroExtemporaneo && yaAprobada
      ? "La solicitud se guardará directamente como aprobada."
      : "La solicitud entra al flujo de aprobación: RRHH → Jefe inmediato → Mesa Directiva.",
  };
}

type Reglas = ReturnType<typeof reglasAnticipacion>;

export function PanelExtemporaneo({ formulario, reglas, onChange: cambiar }: {
  formulario: SolicitudFormulario;
  reglas: Reglas;
  onChange: (cambios: Partial<SolicitudFormulario>) => void;
}) {
  if (!reglas.puedeRegistrarPasadas) return null;
  if (!reglas.registroExtemporaneo) {
    return <p className="empty-note" style={{ margin: "0 0 8px" }}>¿Vas a registrar una solicitud pasada? Elige su fecha de inicio real y aparecerán las opciones para indicar la fecha en que se solicitó, si ya fue autorizada y si descuenta saldo.</p>;
  }
  const { yaAprobada } = reglas;
  const descontarSaldo = formulario.descontarSaldo ?? true;
  return (
    <div style={{ margin: "0 0 10px", padding: "12px 14px", borderRadius: 9, background: "color-mix(in srgb, #f59e0b 12%, transparent)", border: "1px solid color-mix(in srgb, #f59e0b 45%, transparent)", display: "grid", gap: 10, fontSize: 13 }}>
      <span><strong>Registro extemporáneo</strong> · la fecha de inicio ya pasó o faltan menos de {ANTICIPACION_MINIMA_DIAS} días. Como administrador puedes capturarla indicando cómo se trata:</span>
      <label style={{ display: "grid", gap: 4, maxWidth: 260 }}><span style={{ color: "var(--muted)", fontSize: 12, fontWeight: 650 }}>Fecha en que se solicitó</span><input type="date" max={new Date().toISOString().slice(0, 10)} value={formulario.fechaSolicitud ?? ""} onChange={(e) => cambiar({ fechaSolicitud: e.target.value })} title="Si la dejas vacía se usa la fecha de hoy" /></label>
      <div role="radiogroup" aria-label="Autorización" style={{ display: "grid", gap: 6 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}><input type="radio" name="autorizacion" checked={yaAprobada} onChange={() => cambiar({ yaAprobada: true })} /><span><strong>Ya fue autorizada</strong>: se registra como aprobada, sin pasar por las etapas y sin enviar WhatsApp ni correos.</span></label>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}><input type="radio" name="autorizacion" checked={!yaAprobada} onChange={() => cambiar({ yaAprobada: false })} /><span><strong>Enviar a revisión</strong>: pasa por RRHH → Jefe inmediato → Mesa Directiva (con sus avisos); RRHH podrá aprobarla aunque no cumpla los {ANTICIPACION_MINIMA_DIAS} días.</span></label>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}><input type="checkbox" checked={descontarSaldo} onChange={(e) => cambiar({ descontarSaldo: e.target.checked })} /><span><strong>Descontar estos días del saldo disponible</strong>{yaAprobada ? " (se descuentan al guardar)" : " (al aprobarse)"}. Desmárcalo si el saldo cargado ya los considera.</span></label>
    </div>
  );
}

export function AvisoSinAnticipacion() {
  return (
    <p role="alert" style={{ margin: "0 0 8px", padding: "10px 12px", borderRadius: 8, background: "#fdecea", border: "1px solid #d93025", color: "#b3261e", fontSize: 13 }}>
      <strong>Las vacaciones deben solicitarse con al menos {ANTICIPACION_MINIMA_DIAS} días de anticipación.</strong> Vuelve a seleccionar las fechas o, si el motivo realmente es urgente, marca la solicitud como &quot;Urgente&quot; y explica el motivo en los comentarios.
    </p>
  );
}
