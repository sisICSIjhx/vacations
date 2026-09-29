"use client";

import { useState } from "react";
import { Eye, EyeOff, X } from "lucide-react";
import { cambiarMiContrasena } from "../lib/api";
import { obtenerSupabase } from "../lib/supabase";

function CampoContrasena({ etiqueta, value, onChange, autoComplete, minLength }: { etiqueta: string; value: string; onChange: (valor: string) => void; autoComplete: string; minLength?: number }) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="span-two">
      <span>{etiqueta}</span>
      <div className="password-input">
        <input required minLength={minLength} maxLength={72} type={visible ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" onClick={() => setVisible((v) => !v)} aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={visible} title={visible ? "Ocultar contraseña" : "Mostrar contraseña"}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button>
      </div>
    </label>
  );
}

// El administrador decide por usuario si puede cambiar su contraseña; el
// servidor vuelve a comprobarlo, esto solo es la pantalla.
// Con `obligatorio` (el administrador restableció la contraseña y pidió
// cambiarla) no se puede cerrar hasta que el usuario elija una nueva.
export function ChangePasswordModal({ onClose, onActualizada, obligatorio = false }: { onClose: () => void; onActualizada?: () => void; obligatorio?: boolean }) {
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
      // Renueva la sesión para que se actualice la marca de cambio obligatorio.
      await obtenerSupabase()?.auth.refreshSession().catch(() => null);
      setListo(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cambiar la contraseña.");
    } finally {
      setGuardando(false);
    }
  };

  // Tras un cambio exitoso el modal obligatorio no debe volver a abrirse.
  const cerrar = () => {
    if (listo) onActualizada?.();
    onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(evento) => { if (!obligatorio && evento.target === evento.currentTarget) onClose(); }}>
      <form className="form-modal" onSubmit={guardar}>
        <header><div><span className="eyebrow">Mi cuenta</span><h2>{obligatorio && !listo ? "Elige tu nueva contraseña" : "Cambiar contraseña"}</h2></div>{(!obligatorio || listo) && <button className="icon-button" type="button" onClick={cerrar} aria-label="Cerrar" title="Cerrar"><X size={19} /></button>}</header>
        {listo ? (
          <>
            <p className="empty-note">Tu contraseña se actualizó. Úsala la próxima vez que inicies sesión.</p>
            <footer><button className="primary-button" type="button" onClick={cerrar} title="Cerrar">Listo</button></footer>
          </>
        ) : (
          <>
            {obligatorio && <p className="empty-note">La administración restableció tu contraseña. Por seguridad, debes cambiar la contraseña temporal por una propia antes de continuar.</p>}
            <div className="form-grid two-columns">
              <CampoContrasena etiqueta="Contraseña actual *" autoComplete="current-password" value={actual} onChange={setActual} />
              <CampoContrasena etiqueta="Nueva contraseña * (mínimo 8 caracteres)" autoComplete="new-password" minLength={8} value={nueva} onChange={setNueva} />
              <CampoContrasena etiqueta="Confirmar nueva contraseña *" autoComplete="new-password" minLength={8} value={confirmacion} onChange={setConfirmacion} />
            </div>
            <p className="empty-note">Por política interna, la administración puede consultar las contraseñas de la plataforma. No reutilices una contraseña personal.</p>
            {error && <div className="inline-alert error">{error}</div>}
            <footer>{!obligatorio && <button className="secondary-button" type="button" onClick={onClose} title="Cancelar">Cancelar</button>}<button className="primary-button" type="submit" disabled={guardando} title="Guardar">{guardando ? "Guardando…" : "Cambiar contraseña"}</button></footer>
          </>
        )}
      </form>
    </div>
  );
}
