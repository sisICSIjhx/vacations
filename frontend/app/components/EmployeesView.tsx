"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { BadgeCheck, Check, Copy, Eye, KeyRound, Pencil, Plus, Search, ShieldCheck, Trash2, UserCheck, UserX, X } from "lucide-react";
import { accesosDisponibles, actualizarAcceso, crearAcceso, listarAccesos, restablecerContrasena, verContrasena, type AccesoCreado, type AccesoUsuario } from "../lib/api";
import { obtenerSupabase, supabaseConfigurado } from "../lib/supabase";
import { Select } from "./Select";
import { DIAS_SEMANA } from "../lib/diaHabil";
import type { DatosVacaciones, Empleado, EmpleadoFormulario, RolUsuario } from "../types";

const ETIQUETA_ROL: Record<RolUsuario, string> = {
  administrador: "Administración",
  rrhh: "RRHH",
  mesa_directiva: "Mesa Directiva",
  empleado: "Empleado",
};

interface EmployeesViewProps {
  datos: DatosVacaciones;
  actualizando: boolean;
  onSave: (formulario: EmpleadoFormulario) => Promise<boolean>;
  onToggleEstado: (id: string, estado: "activo" | "inactivo") => Promise<boolean>;
  // Sin onDelete (p. ej. RRHH) no se muestra el botón de eliminar.
  onDelete?: (id: string) => Promise<boolean>;
  // La gestión de accesos (cuentas, roles, contraseñas) es solo del administrador.
  puedeGestionarAccesos?: boolean;
}

const formularioVacio: EmpleadoFormulario = {
  numeroEmpleado: "",
  nombre: "",
  correo: "",
  telefonoWhatsapp: "",
  curp: "",
  nss: "",
  color: "#2563EB",
  sedeId: "",
  proyectoId: "",
  categoriaId: "",
  fechaIngreso: "",
  jefeInmediatoId: "",
  diaDescanso: "",
  diasPorDerecho: 0,
  diasAcumulados: 0,
  diasDisponibles: 0,
};

function desdeEmpleado(empleado: Empleado): EmpleadoFormulario {
  return {
    id: empleado.id,
    numeroEmpleado: empleado.numeroEmpleado,
    nombre: empleado.nombre,
    correo: empleado.correo ?? "",
    telefonoWhatsapp: empleado.telefonoWhatsapp ?? "",
    curp: empleado.curp ?? "",
    nss: empleado.nss ?? "",
    color: empleado.color,
    sedeId: empleado.sedeId ?? "",
    proyectoId: empleado.proyectoId ?? "",
    categoriaId: empleado.categoriaId ?? "",
    fechaIngreso: empleado.fechaIngreso ?? "",
    jefeInmediatoId: empleado.jefeInmediatoId ?? "",
    diaDescanso: empleado.diaDescanso === undefined ? "" : String(empleado.diaDescanso),
    diasPorDerecho: empleado.saldo.diasPorDerecho,
    diasAcumulados: empleado.saldo.diasAcumulados,
    diasDisponibles: empleado.saldo.diasDisponibles,
  };
}

// Modal de alta/edición de acceso a la plataforma: reemplaza el proceso
// manual de crear al usuario desde el panel de Supabase y luego asignarle el
// rol con una consulta SQL. Cubre tres casos: crear un acceso nuevo (la
// cuenta se crea ya confirmada con una contraseña temporal que el
// administrador copia y comparte directamente, sin enviar correo), vincular
// una cuenta que ya existe con el mismo correo pero sin empleado asociado
// (p. ej. si se creó manualmente antes de tener esta pantalla), y editar el
// rol/estado de un acceso ya vinculado.
function AccessModal({ empleado, accesos, onClose, onRefrescar }: {
  empleado: Empleado;
  accesos: AccesoUsuario[];
  onClose: () => void;
  onRefrescar: () => void;
}) {
  const accesoActual = accesos.find((item) => item.empleadoId === empleado.id);
  const coincidenciaCorreo = !accesoActual && empleado.correo
    ? accesos.find((item) => !item.empleadoId && item.correo?.toLowerCase() === empleado.correo?.toLowerCase())
    : undefined;

  const [correo, setCorreo] = useState(empleado.correo ?? "");
  const [correoAcceso, setCorreoAcceso] = useState(accesoActual?.correo ?? "");
  const [rol, setRol] = useState<RolUsuario>(accesoActual?.rol ?? "empleado");
  const [activo, setActivo] = useState(accesoActual?.activo ?? true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<AccesoCreado | null>(null);
  const [copiado, setCopiado] = useState<"correo" | "contrasena" | null>(null);
  const [permitirCambio, setPermitirCambio] = useState(accesoActual?.puedeCambiarContrasena ?? false);
  const [forzarCambio, setForzarCambio] = useState(false);
  const [mfa, setMfa] = useState<{ factorId: string; qr?: string; secreto?: string } | null>(null);
  const [codigoMfa, setCodigoMfa] = useState("");

  const vincular = async (usuarioId: string) => {
    setGuardando(true);
    setError(null);
    try {
      await actualizarAcceso(usuarioId, { empleadoId: empleado.id });
      onRefrescar();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible vincular la cuenta.");
    } finally {
      setGuardando(false);
    }
  };

  const crear = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      const creado = await crearAcceso({ empleadoId: empleado.id, correo, rol, permitirCambioContrasena: permitirCambio, forzarCambioContrasena: forzarCambio });
      setResultado(creado);
      onRefrescar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible crear el acceso.");
    } finally {
      setGuardando(false);
    }
  };

  const guardarCambios = async () => {
    if (!accesoActual) return;
    setGuardando(true);
    setError(null);
    try {
      const correoNuevo = correoAcceso.trim();
      const cambiaCorreo = Boolean(correoNuevo) && correoNuevo.toLowerCase() !== (accesoActual.correo ?? "").toLowerCase();
      if (cambiaCorreo && !window.confirm(`¿Cambiar el correo de acceso de ${empleado.nombre} a ${correoNuevo}? A partir de ahora deberá iniciar sesión con ese correo; su contraseña no cambia.`)) return;
      await actualizarAcceso(accesoActual.usuarioId, { rol, activo, permitirCambioContrasena: permitirCambio, ...(forzarCambio ? { forzarCambioContrasena: true } : {}), ...(cambiaCorreo ? { correo: correoNuevo } : {}) });
      onRefrescar();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible guardar los cambios.");
    } finally {
      setGuardando(false);
    }
  };

  const restablecer = async () => {
    if (!accesoActual) return;
    if (!window.confirm(`¿Restablecer la contraseña de ${empleado.nombre}? Su contraseña actual dejará de funcionar de inmediato.`)) return;
    setGuardando(true);
    setError(null);
    try {
      const { contrasena } = await restablecerContrasena(accesoActual.usuarioId, permitirCambio, forzarCambio);
      setResultado({ usuarioId: accesoActual.usuarioId, correo: accesoActual.correo ?? "", contrasena, rol: accesoActual.rol });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible restablecer la contraseña.");
    } finally {
      setGuardando(false);
    }
  };

  const mostrarContrasena = async () => {
    if (!accesoActual) return;
    const { contrasena } = await verContrasena(accesoActual.usuarioId);
    if (!contrasena) {
      setError("No hay una contraseña guardada para este usuario (la cuenta ya existía antes o su contraseña se cambió fuera del sistema). Usa «Restablecer contraseña» para generar una nueva.");
      return;
    }
    setResultado({ usuarioId: accesoActual.usuarioId, correo: accesoActual.correo ?? "", contrasena, rol: accesoActual.rol });
  };

  // Ver contraseñas exige una sesión verificada con el autenticador (MFA/TOTP):
  // si el administrador aún no tiene uno, se le pide vincularlo primero.
  const consultar = async () => {
    const supabase = obtenerSupabase();
    if (!accesoActual || !supabase) return;
    setGuardando(true);
    setError(null);
    try {
      const { data: nivel } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (nivel?.currentLevel === "aal2") {
        await mostrarContrasena();
        return;
      }
      const { data: factores, error: errorFactores } = await supabase.auth.mfa.listFactors();
      if (errorFactores) throw errorFactores;
      const verificado = factores?.totp[0];
      if (verificado) {
        setMfa({ factorId: verificado.id });
        return;
      }
      for (const pendiente of (factores?.all ?? []).filter((factor) => factor.status === "unverified")) {
        await supabase.auth.mfa.unenroll({ factorId: pendiente.id });
      }
      const { data: nuevo, error: errorAlta } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `ICSI People ${Date.now()}` });
      if (errorAlta || !nuevo) throw errorAlta ?? new Error("No fue posible iniciar la vinculación.");
      setMfa({ factorId: nuevo.id, qr: nuevo.totp.qr_code, secreto: nuevo.totp.secret });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible consultar la contraseña.");
    } finally {
      setGuardando(false);
    }
  };

  const confirmarMfa = async (evento: React.FormEvent) => {
    evento.preventDefault();
    const supabase = obtenerSupabase();
    if (!mfa || !supabase) return;
    setGuardando(true);
    setError(null);
    try {
      const { error: errorCodigo } = await supabase.auth.mfa.challengeAndVerify({ factorId: mfa.factorId, code: codigoMfa.trim() });
      if (errorCodigo) throw new Error("Código incorrecto o vencido. Inténtalo de nuevo.");
      setMfa(null);
      setCodigoMfa("");
      await mostrarContrasena();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible verificar el código.");
    } finally {
      setGuardando(false);
    }
  };

  const copiar = async (texto: string, campo: "correo" | "contrasena") => {
    await navigator.clipboard.writeText(texto);
    setCopiado(campo);
    window.setTimeout(() => setCopiado(null), 2000);
  };

  const selectorRol = (valorActual: RolUsuario, onChange: (valor: RolUsuario) => void) => (
    <Select value={valorActual} onChange={(valor) => onChange(valor as RolUsuario)}>
      <option value="empleado">Empleado</option>
      <option value="rrhh">RRHH</option>
      <option value="mesa_directiva">Mesa Directiva</option>
      <option value="administrador">Administrador</option>
    </Select>
  );

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) onClose(); }}>
      <div className="form-modal">
        <header><div><span className="eyebrow">Acceso a la plataforma</span><h2>{empleado.nombre}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar" title="Cerrar"><X size={19} /></button></header>

        {resultado ? (
          <>
            {resultado.contrasena ? (
              <>
                <p className="empty-note">Comparte estos datos con {empleado.nombre} por el medio que prefieras (puedes volver a consultarla con «Ver contraseña» mientras el usuario no la cambie).</p>
                <div className="invite-link-box">
                  <code>{resultado.correo}</code>
                  <button type="button" className="secondary-button" onClick={() => copiar(resultado.correo, "correo")} title="Copiar correo">{copiado === "correo" ? <Check size={15} /> : <Copy size={15} />}{copiado === "correo" ? "Copiado" : "Copiar"}</button>
                </div>
                <div className="invite-link-box">
                  <code>{resultado.contrasena}</code>
                  <button type="button" className="secondary-button" onClick={() => copiar(resultado.contrasena!, "contrasena")} title="Copiar contraseña">{copiado === "contrasena" ? <Check size={15} /> : <Copy size={15} />}{copiado === "contrasena" ? "Copiado" : "Copiar"}</button>
                </div>
              </>
            ) : (
              <p className="empty-note">El correo <strong>{resultado.correo}</strong> ya tenía una cuenta creada; se vinculó a {empleado.nombre} sin cambiar su contraseña. Puede seguir entrando con la que ya tenía.</p>
            )}
            <footer><button className="primary-button" type="button" onClick={onClose} title="Cerrar">Listo</button></footer>
          </>
        ) : mfa ? (
          <form className="access-stack" onSubmit={confirmarMfa}>
            {mfa.qr ? (
              <>
                <p className="empty-note">Para ver contraseñas necesitas un código de tu app de autenticación. Escanea este QR con Google Authenticator, Microsoft Authenticator, Authy o similar, y escribe el código de 6 dígitos que muestre.</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mfa.qr} alt="Código QR para vincular el autenticador" width={180} height={180} style={{ background: "#fff", padding: 8, borderRadius: 8, alignSelf: "center" }} />
                <div className="invite-link-box"><code>{mfa.secreto}</code></div>
              </>
            ) : (
              <p className="empty-note">Escribe el código de 6 dígitos de tu app de autenticación para ver la contraseña.</p>
            )}
            <label><span>Código de verificación</span><input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={codigoMfa} onChange={(e) => setCodigoMfa(e.target.value)} placeholder="123456" /></label>
            {error && <div className="inline-alert error">{error}</div>}
            <footer><button className="secondary-button" type="button" onClick={() => { setMfa(null); setCodigoMfa(""); setError(null); }} title="Cancelar">Cancelar</button><button className="primary-button" type="submit" disabled={guardando} title="Verificar">{guardando ? "Verificando…" : "Verificar"}</button></footer>
          </form>
        ) : accesoActual ? (
          <div className="access-stack">
            <div className="form-grid two-columns">
              <label><span>Rol</span>{selectorRol(rol, setRol)}</label>
              <label><span>Estado</span><Select value={activo ? "activo" : "inactivo"} onChange={(valor) => setActivo(valor === "activo")}><option value="activo">Activo</option><option value="inactivo">Inactivo</option></Select></label>
            </div>
            <label><span>Correo de inicio de sesión</span><input type="email" value={correoAcceso} onChange={(e) => setCorreoAcceso(e.target.value)} placeholder="empleado@icsi.com" /></label>
            <label className="option-card">
              <div className="option-text">
                <strong>Permitir que el usuario cambie su contraseña</strong>
                <small>{permitirCambio ? "Verá un botón con una llave en la barra superior para cambiarla cuando quiera. Tú podrás seguir consultándola con tu código del autenticador." : "El usuario solo podrá entrar con la contraseña que le compartas. Si la olvida, tendrás que restablecérsela."}</small>
              </div>
              <input type="checkbox" role="switch" className="switch" checked={permitirCambio} onChange={(e) => setPermitirCambio(e.target.checked)} />
            </label>
            <label className="option-card">
              <div className="option-text">
                <strong>Al restablecer, pedir al usuario que cambie la contraseña al iniciar sesión</strong>
                <small>Al entrar con la contraseña temporal, el sistema le exigirá elegir una nueva antes de continuar. Tú podrás seguir consultándola con tu código del autenticador.</small>
              </div>
              <input type="checkbox" role="switch" className="switch" checked={forzarCambio} onChange={(e) => setForzarCambio(e.target.checked)} />
            </label>
            <div className="action-row">
              <button type="button" className="secondary-button" disabled={guardando} onClick={consultar} title="Ver contraseña (requiere código del autenticador)"><Eye size={15} />Ver contraseña</button>
              <button type="button" className="secondary-button" disabled={guardando} onClick={restablecer} title="Restablecer contraseña"><KeyRound size={15} />Restablecer contraseña</button>
            </div>
            {error && <div className="inline-alert error">{error}</div>}
            <footer><button className="secondary-button" type="button" onClick={onClose} title="Cancelar">Cancelar</button><button className="primary-button" type="button" disabled={guardando} onClick={guardarCambios} title="Guardar cambios">{guardando ? "Guardando…" : "Guardar cambios"}</button></footer>
          </div>
        ) : coincidenciaCorreo ? (
          <>
            <p className="empty-note">Ya existe una cuenta con el correo <strong>{coincidenciaCorreo.correo}</strong> (rol {ETIQUETA_ROL[coincidenciaCorreo.rol]}) que no está vinculada a ningún empleado. Puedes vincularla a {empleado.nombre} en vez de crear una cuenta nueva.</p>
            {error && <div className="inline-alert error">{error}</div>}
            <footer><button className="secondary-button" type="button" onClick={onClose} title="Cancelar">Cancelar</button><button className="primary-button" type="button" disabled={guardando} onClick={() => vincular(coincidenciaCorreo.usuarioId)} title="Vincular cuenta">{guardando ? "Vinculando…" : "Vincular cuenta"}</button></footer>
          </>
        ) : (
          <form className="access-stack" onSubmit={crear}>
            <div className="form-grid two-columns">
              <label className="span-two"><span>Correo electrónico *</span><input required type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} placeholder="empleado@icsi.com" /></label>
              <label className="span-two"><span>Rol</span>{selectorRol(rol, setRol)}</label>
            </div>
            <label className="option-card">
              <div className="option-text">
                <strong>Permitir que el usuario cambie su contraseña</strong>
                <small>{permitirCambio ? "Verá un botón con una llave en la barra superior para cambiarla cuando quiera. Tú podrás seguir consultándola con tu código del autenticador." : "El usuario solo podrá entrar con la contraseña que le compartas. Si la olvida, tendrás que restablecérsela."}</small>
              </div>
              <input type="checkbox" role="switch" className="switch" checked={permitirCambio} onChange={(e) => setPermitirCambio(e.target.checked)} />
            </label>
            <label className="option-card">
              <div className="option-text">
                <strong>Pedir al usuario que cambie la contraseña al iniciar sesión</strong>
                <small>Al entrar con la contraseña temporal, el sistema le exigirá elegir una nueva antes de continuar. Tú podrás seguir consultándola con tu código del autenticador.</small>
              </div>
              <input type="checkbox" role="switch" className="switch" checked={forzarCambio} onChange={(e) => setForzarCambio(e.target.checked)} />
            </label>
            <p className="empty-note">Se creará la cuenta con una contraseña temporal generada automáticamente, que podrás copiar y compartir con {empleado.nombre}. Si este correo ya tenía una cuenta creada (p. ej. desde el panel de Supabase), en vez de fallar se vinculará a este empleado sin tocar su contraseña.</p>
            {error && <div className="inline-alert error">{error}</div>}
            <footer><button className="secondary-button" type="button" onClick={onClose} title="Cancelar">Cancelar</button><button className="primary-button" type="submit" disabled={guardando} title="Crear acceso">{guardando ? "Creando…" : "Crear acceso"}</button></footer>
          </form>
        )}
      </div>
    </div>
  );
}

export function EmployeesView({ datos, actualizando, onSave, onToggleEstado, onDelete, puedeGestionarAccesos = false }: EmployeesViewProps) {
  const mostrarAccesos = supabaseConfigurado && accesosDisponibles && puedeGestionarAccesos;
  const [busqueda, setBusqueda] = useState("");
  const [formulario, setFormulario] = useState<EmpleadoFormulario | null>(null);
  const [accesos, setAccesos] = useState<AccesoUsuario[]>([]);
  const [gestionAcceso, setGestionAcceso] = useState<Empleado | null>(null);
  const empleados = useMemo(() => datos.empleados.filter((empleado) => `${empleado.nombre} ${empleado.numeroEmpleado} ${empleado.sede} ${empleado.proyecto}`.toLowerCase().includes(busqueda.toLowerCase())), [busqueda, datos.empleados]);
  const actualizar = (campo: keyof EmpleadoFormulario, valor: string | number) => setFormulario((actual) => actual ? { ...actual, [campo]: valor } : actual);
  const accesoDe = (empleado: Empleado) => accesos.find((item) => item.empleadoId === empleado.id);

  const cargarAccesos = useCallback(() => {
    if (!mostrarAccesos) return;
    void listarAccesos().then(setAccesos).catch(() => {});
  }, [mostrarAccesos]);
  useEffect(() => { cargarAccesos(); }, [cargarAccesos]);

  const guardar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    if (!formulario) return;
    const correcto = await onSave({ ...formulario, curp: formulario.curp.toUpperCase() });
    if (correcto) setFormulario(null);
  };

  const alternarEstado = (empleado: Empleado) => {
    const siguiente = empleado.estado === "activo" ? "inactivo" : "activo";
    const mensaje = siguiente === "inactivo"
      ? `¿Dar de baja a ${empleado.nombre}? No podrá recibir nuevas solicitudes de vacaciones hasta reactivarlo.`
      : `¿Reactivar a ${empleado.nombre}?`;
    if (window.confirm(mensaje)) void onToggleEstado(empleado.id, siguiente);
  };

  const eliminar = (empleado: Empleado) => {
    if (window.confirm(`¿Eliminar a ${empleado.nombre} de forma permanente? Su historial de solicitudes se conservará pero dejará de aparecer en el sistema.`)) {
      void onDelete?.(empleado.id);
    }
  };

  return (
    <div className="page-stack">
      <section className="page-title-row">
        <div><span className="eyebrow">Administración</span><h1>Personal</h1><p>Expediente, asignación y saldo vacacional del equipo.</p></div>
        <button className="primary-button" type="button" onClick={() => setFormulario({ ...formularioVacio })} title="Alta de empleado"><Plus size={17} />Alta de empleado</button>
      </section>

      <section className="content-card table-card">
        <header className="table-toolbar">
          <div className="search-field"><Search size={17} /><input value={busqueda} onChange={(evento) => setBusqueda(evento.target.value)} placeholder="Buscar por nombre, número, sede o proyecto" /></div>
          <span>{empleados.length} registros</span>
        </header>
        <div className="responsive-table-wrap">
          <table className="data-table employee-table">
            <thead><tr><th className="th-flex">Empleado</th><th>Proyecto</th><th>Sede</th><th>Ingreso</th><th>Disponibles</th><th>Tomados</th><th>Identificación</th><th>Estado</th>{mostrarAccesos && <th>Acceso</th>}<th>Acciones</th></tr></thead>
            <tbody>
              {empleados.map((empleado) => (
                <tr key={empleado.id}>
                  <td><div className="person-cell"><span className="avatar small" style={{ background: empleado.color }}>{empleado.nombre.split(" ").slice(0, 2).map((parte) => parte[0]).join("")}</span><div><strong>{empleado.nombre}</strong><span>{empleado.numeroEmpleado} · {empleado.categoria}</span></div></div></td>
                  <td>{empleado.proyecto}</td>
                  <td>{empleado.sede}</td>
                  <td>{empleado.fechaIngreso ? format(parseISO(empleado.fechaIngreso), "d MMM yyyy", { locale: es }) : "—"}</td>
                  <td><span className="balance-pair"><b>{empleado.saldo.diasDisponibles}</b><span>de</span><b>{empleado.saldo.diasAcumulados}</b></span><span className="table-secondary">disponibles / acumulados</span></td>
                  <td><span className="count-chip">{empleado.saldo.diasTomados} días</span></td>
                  <td>{empleado.curp || empleado.nss ? <span className="secure-label"><ShieldCheck size={14} />Capturada</span> : <span className="muted-label">Pendiente</span>}</td>
                  <td><span className={`status-pill ${empleado.estado}`}>{empleado.estado}</span></td>
                  {mostrarAccesos && <td>{accesoDe(empleado) ? <span className={`status-pill ${accesoDe(empleado)!.activo ? "aprobada" : "rechazada"}`}>{ETIQUETA_ROL[accesoDe(empleado)!.rol]}{accesoDe(empleado)!.activo ? "" : " · inactivo"}</span> : <span className="muted-label">Sin acceso</span>}</td>}
                  <td>
                    <div className="row-actions">
                      {mostrarAccesos && <button className="icon-button subtle" type="button" onClick={() => setGestionAcceso(empleado)} aria-label={`Gestionar acceso de ${empleado.nombre}`} title="Gestionar acceso"><KeyRound size={16} /></button>}
                      <button className="icon-button subtle" type="button" disabled={actualizando} onClick={() => setFormulario(desdeEmpleado(empleado))} aria-label={`Editar ${empleado.nombre}`} title={`Editar ${empleado.nombre}`}><Pencil size={16} /></button>
                      <button className="icon-button subtle" type="button" disabled={actualizando} onClick={() => alternarEstado(empleado)} aria-label={empleado.estado === "activo" ? `Dar de baja a ${empleado.nombre}` : `Reactivar a ${empleado.nombre}`} title={empleado.estado === "activo" ? `Dar de baja a ${empleado.nombre}` : `Reactivar a ${empleado.nombre}`}>{empleado.estado === "activo" ? <UserX size={16} /> : <UserCheck size={16} />}</button>
                      {onDelete && <button className="icon-button subtle danger" type="button" disabled={actualizando} onClick={() => eliminar(empleado)} aria-label={`Eliminar ${empleado.nombre}`} title={`Eliminar ${empleado.nombre}`}><Trash2 size={16} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {formulario && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) setFormulario(null); }}>
          <form className="form-modal employee-form" onSubmit={guardar}>
            <header><div><span className="eyebrow">{formulario.id ? "Modificar registro" : "Nuevo registro"}</span><h2>{formulario.id ? "Editar empleado" : "Alta de empleado"}</h2></div><button className="icon-button" type="button" onClick={() => setFormulario(null)} aria-label="Cerrar" title="Cerrar"><X size={19} /></button></header>
            <div className="form-grid two-columns">
              <label className="span-two"><span>Nombre completo *</span><input required value={formulario.nombre} onChange={(e) => actualizar("nombre", e.target.value)} /></label>
              <label><span>Número de empleado *</span><input required value={formulario.numeroEmpleado} onChange={(e) => actualizar("numeroEmpleado", e.target.value)} /></label>
              <label><span>Correo electrónico</span><input type="email" value={formulario.correo} onChange={(e) => actualizar("correo", e.target.value)} /></label>
              <label><span>WhatsApp (10 dígitos)</span><input inputMode="numeric" maxLength={10} value={formulario.telefonoWhatsapp} onChange={(e) => actualizar("telefonoWhatsapp", e.target.value.replace(/\D/g, ""))} placeholder="9212226747" /></label>
              <label><span>CURP</span><input maxLength={18} value={formulario.curp} onChange={(e) => actualizar("curp", e.target.value.toUpperCase())} placeholder="18 caracteres" /></label>
              <label><span>NSS</span><input inputMode="numeric" maxLength={11} value={formulario.nss} onChange={(e) => actualizar("nss", e.target.value.replace(/\D/g, ""))} placeholder="11 dígitos" /></label>
              <label><span>Sede</span><Select value={formulario.sedeId} onChange={(valor) => actualizar("sedeId", valor)}><option value="">Seleccionar</option>{datos.sedes.map((item) => <option value={item.id} key={item.id}>{item.nombre}</option>)}</Select></label>
              <label><span>Proyecto</span><Select value={formulario.proyectoId} onChange={(valor) => actualizar("proyectoId", valor)}><option value="">Seleccionar</option>{datos.proyectos.map((item) => <option value={item.id} key={item.id}>{item.nombre}</option>)}</Select></label>
              <label><span>Categoría</span><Select value={formulario.categoriaId} onChange={(valor) => actualizar("categoriaId", valor)}><option value="">Seleccionar</option>{datos.categorias.map((item) => <option value={item.id} key={item.id}>{item.nombre}</option>)}</Select></label>
              <label><span>Fecha de ingreso</span><input type="date" value={formulario.fechaIngreso} onChange={(e) => actualizar("fechaIngreso", e.target.value)} /></label>
              <label><span>Jefe inmediato</span><Select value={formulario.jefeInmediatoId} onChange={(valor) => actualizar("jefeInmediatoId", valor)}><option value="">Sin jefe asignado</option>{datos.empleados.filter((item) => item.id !== formulario.id).map((item) => <option value={item.id} key={item.id}>{item.nombre}</option>)}</Select></label>
              <label><span>Día de descanso</span><Select value={formulario.diaDescanso} onChange={(valor) => actualizar("diaDescanso", valor)}><option value="">Sin definir (cuenta todos los días)</option>{DIAS_SEMANA.map((dia, indice) => <option value={String(indice)} key={dia}>{dia}</option>)}</Select></label>
              <label><span>Color en calendario</span><span className="color-input"><input type="color" value={formulario.color} onChange={(e) => actualizar("color", e.target.value)} /><code>{formulario.color}</code></span></label>
            </div>
            <div className="form-section-title"><BadgeCheck size={16} /><span>Saldo vacacional</span><small>Son conceptos diferentes</small></div>
            <div className="form-grid three-columns">
              <label><span>Días por derecho</span><input type="number" min="0" step="0.5" value={formulario.diasPorDerecho} onChange={(e) => actualizar("diasPorDerecho", Number(e.target.value))} /></label>
              <label><span>Acumulados a la fecha</span><input type="number" min="0" step="0.5" value={formulario.diasAcumulados} onChange={(e) => actualizar("diasAcumulados", Number(e.target.value))} /></label>
              <label><span>Disponibles actuales</span><input type="number" min="0" step="0.5" value={formulario.diasDisponibles} onChange={(e) => actualizar("diasDisponibles", Number(e.target.value))} /></label>
            </div>
            <footer><button className="secondary-button" type="button" onClick={() => setFormulario(null)} title="Cancelar">Cancelar</button><button className="primary-button" type="submit" disabled={actualizando} title={actualizando ? "Guardando…" : "Guardar empleado"}>{actualizando ? "Guardando…" : "Guardar empleado"}</button></footer>
          </form>
        </div>
      )}

      {gestionAcceso && (
        <AccessModal
          empleado={gestionAcceso}
          accesos={accesos}
          onClose={() => setGestionAcceso(null)}
          onRefrescar={cargarAccesos}
        />
      )}
    </div>
  );
}
