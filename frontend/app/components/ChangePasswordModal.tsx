"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { cambiarMiContrasena } from "../lib/api";

// El administrador decide por usuario si puede cambiar su contraseña; el
// servidor vuelve a comprobarlo, esto solo es la pantalla.
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  const guardar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    if (nueva !== confirmacion) return setError("La confirmación no coincide con la nueva contraseña.");
    setGuardando(true);
    setError(null);
    try {
      await cambiarMiContrasena(actual, nueva);
      setListo(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cambiar la contraseña.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) onClose(); }}>
      <form className="form-modal" onSubmit={guardar}>
        <header><div><span className="eyebrow">Mi cuenta</span><h2>Cambiar contraseña</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar" title="Cerrar"><X size={19} /></button></header>
        {listo ? (
          <>
            <p className="empty-note">Tu contraseña se actualizó. Úsala la próxima vez que inicies sesión.</p>
            <footer><button className="primary-button" type="button" onClick={onClose} title="Cerrar">Listo</button></footer>
          </>
        ) : (
          <>
            <div className="form-grid two-columns">
              <label className="span-two"><span>Contraseña actual *</span><input required type="password" autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} /></label>
              <label className="span-two"><span>Nueva contraseña * (mínimo 8 caracteres)</span><input required minLength={8} maxLength={72} type="password" autoComplete="new-password" value={nueva} onChange={(e) => setNueva(e.target.value)} /></label>
              <label className="span-two"><span>Confirmar nueva contraseña *</span><input required minLength={8} maxLength={72} type="password" autoComplete="new-password" value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} /></label>
            </div>
            <p className="empty-note">Por política interna, la administración puede consultar las contraseñas de la plataforma. No reutilices una contraseña personal.</p>
            {error && <div className="inline-alert error">{error}</div>}
            <footer><button className="secondary-button" type="button" onClick={onClose} title="Cancelar">Cancelar</button><button className="primary-button" type="submit" disabled={guardando} title="Guardar">{guardando ? "Guardando…" : "Cambiar contraseña"}</button></footer>
          </>
        )}
      </form>
    </div>
  );
}
