"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Bell, Calendar, ChartPie, ChevronDown, ChevronLeft, ChevronRight,
  ClipboardList, LogOut, Menu, Moon, Plus, Settings2, ShieldCheck,
  PanelLeftClose, PanelLeftOpen, Sun, UserCog, UsersRound, X,
} from "lucide-react";
import { CatalogsView } from "./components/CatalogsView";
import { DashboardView } from "./components/DashboardView";
import { EmployeeFocus } from "./components/EmployeeFocus";
import { EmployeesView } from "./components/EmployeesView";
import { RequestsView } from "./components/RequestsView";
import { Select } from "./components/Select";
import { YearCalendar } from "./components/YearCalendar";
import { useVacationSystem } from "./hooks/useVacationSystem";
import { obtenerSupabase, supabaseConfigurado } from "./lib/supabase";
import type { DatosVacaciones, FiltrosCalendario, PerfilUsuario, RolUsuario, SolicitudFormulario, VistaId } from "./types";

const filtrosIniciales: FiltrosCalendario = { empleadoId: "", sedeId: "", proyectoId: "", categoriaId: "", estado: "" };
const navegacionPrincipal = [
  { id: "resumen" as VistaId, etiqueta: "Resumen", icono: ChartPie },
  { id: "calendario" as VistaId, etiqueta: "Calendario", icono: Calendar },
];
const navegacionAdministrativa = [
  { id: "personal" as VistaId, etiqueta: "Personal", icono: UsersRound, soloGestion: true },
  { id: "solicitudes" as VistaId, etiqueta: "Solicitudes", icono: ClipboardList, soloGestion: false },
  { id: "catalogos" as VistaId, etiqueta: "Catálogos", icono: Settings2, soloGestion: true },
];

// "empleado" no tiene una sola etiqueta fija: puede ser un empleado raso
// (autoservicio) o, ademas, jefe inmediato de otros (ver esJefeInmediato).
function etiquetaPerfil(perfil: PerfilUsuario): string {
  if (perfil.rol === "administrador") return "Administración";
  if (perfil.rol === "rrhh") return "RRHH";
  if (perfil.rol === "mesa_directiva") return "Mesa Directiva";
  return perfil.esJefeInmediato ? "Jefe inmediato" : "Empleado";
}

// Convención mexicana de nombre_completo: "Nombre(s) ApellidoPaterno
// ApellidoMaterno". Sin un campo separado para nombre de pila, se asume que
// las últimas dos palabras son apellidos (o la última, si solo hay tres) y
// se muestra el resto; con una o dos palabras no hay nada que recortar.
function nombresDePila(nombreCompleto: string): string {
  const partes = nombreCompleto.trim().split(/\s+/);
  if (partes.length <= 2) return partes[0] ?? nombreCompleto;
  return partes.slice(0, partes.length - 2).join(" ");
}

// Cualquier perfil activo entra al panel: administrador/rrhh/mesa_directiva
// como revisores, y "empleado" (jefe inmediato o no) como autoservicio para
// crear y consultar sus propias solicitudes.
function puedeAccederPanel(perfil: PerfilUsuario | null): boolean {
  return Boolean(perfil?.activo);
}

async function obtenerPerfilAcceso(usuarioId: string): Promise<PerfilUsuario | null> {
  const supabase = obtenerSupabase();
  if (!supabase) return null;
  const db = supabase.schema("vacaciones");
  const { data, error } = await db
    .from("perfiles_usuario")
    .select("usuario_id,empleado_id,nombre_visible,rol,activo")
    .eq("usuario_id", usuarioId)
    .maybeSingle();
  if (error || !data) return null;

  let esJefeInmediato = false;
  if (data.rol === "empleado" && data.empleado_id) {
    const { data: reporte } = await db
      .from("empleados")
      .select("id")
      .eq("jefe_inmediato_id", data.empleado_id)
      .is("eliminado_en", null)
      .limit(1)
      .maybeSingle();
    esJefeInmediato = Boolean(reporte);
  }

  return {
    usuarioId: data.usuario_id,
    empleadoId: data.empleado_id ?? undefined,
    nombreVisible: data.nombre_visible,
    rol: data.rol as RolUsuario,
    activo: data.activo,
    esJefeInmediato,
  };
}

// Perfiles sintéticos para recorrer el panel en modo demostración desde el
// punto de vista de cada rol, sin necesitar una sesión real de Supabase.
const PERFILES_DEMOSTRACION: Record<string, PerfilUsuario> = {
  administrador: { usuarioId: "demo-admin", nombreVisible: "Administración ICSI", rol: "administrador", activo: true, esJefeInmediato: false },
  rrhh: { usuarioId: "demo-rrhh", nombreVisible: "RRHH ICSI", rol: "rrhh", activo: true, esJefeInmediato: false },
  mesa_directiva: { usuarioId: "demo-mesa", nombreVisible: "Mesa Directiva ICSI", rol: "mesa_directiva", activo: true, esJefeInmediato: false },
  jefe_inmediato: { usuarioId: "demo-jefe", empleadoId: "emp-luis", nombreVisible: "Luis Alberto Santiago Toledo", rol: "empleado", activo: true, esJefeInmediato: true },
  empleado: { usuarioId: "demo-empleado", empleadoId: "emp-nathanael", nombreVisible: "Nathanael Vitelio Gutierrez Alvarado", rol: "empleado", activo: true, esJefeInmediato: false },
};

function LoginScreen({ onDemo }: { onDemo: () => void }) {
  const [correo, setCorreo] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entrar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    const supabase = obtenerSupabase();
    if (!supabase) return onDemo();
    setCargando(true);
    setError(null);
    const { data, error: loginError } = await supabase.auth.signInWithPassword({ email: correo, password: contrasena });
    if (loginError) setError(loginError.message);
    else if (data.user && !puedeAccederPanel(await obtenerPerfilAcceso(data.user.id))) {
      await supabase.auth.signOut();
      setError("Esta cuenta no tiene acceso al panel administrativo.");
    }
    setCargando(false);
  };
  return (
    <main className="login-page">
      <section className="login-brand-panel">
        <div className="brand-lockup light"><span className="brand-mark">I</span><div><strong>ICSI</strong><span>People Operations</span></div></div>
        <div className="login-message"><span className="eyebrow light-text">Disponibilidad del equipo</span><h1>Decisiones claras,<br />equipos coordinados.</h1><p>Consulta vacaciones, anticipa ausencias y protege la continuidad operativa desde un solo calendario.</p></div>
        <div className="login-preview"><div className="preview-top"><span>Septiembre 2026</span><i /><i /></div><div className="preview-grid">{Array.from({ length: 28 }, (_, index) => <span key={index} className={[10, 11, 12, 17, 18, 24].includes(index) ? "active" : index === 16 ? "multiple" : ""}>{index + 1}</span>)}</div></div>
        <small>Administración de vacaciones · ICSI OIL & GAS</small>
      </section>
      <section className="login-form-panel">
        <form className="login-card" onSubmit={entrar}>
          <span className="mobile-login-brand"><span className="brand-mark">I</span>ICSI</span>
          <div><span className="eyebrow">Acceso administrativo</span><h2>Inicia sesión</h2><p>Usa tu cuenta registrada en Supabase: Administración, RRHH, Mesa Directiva, jefatura o empleado.</p></div>
          <label><span>Correo electrónico</span><input required={supabaseConfigurado} type="email" autoComplete="email" value={correo} onChange={(e) => setCorreo(e.target.value)} placeholder="administracion@icsi.com" /></label>
          <label><span>Contraseña</span><input required={supabaseConfigurado} type="password" autoComplete="current-password" value={contrasena} onChange={(e) => setContrasena(e.target.value)} placeholder="••••••••••••" /></label>
          {error && <div className="inline-alert error">{error}</div>}
          <button className="primary-button login-button" type={supabaseConfigurado ? "submit" : "button"} onClick={supabaseConfigurado ? undefined : onDemo} disabled={cargando} title={cargando ? "Verificando…" : supabaseConfigurado ? "Entrar al panel" : "Entrar a demostración"}>{cargando ? "Verificando…" : supabaseConfigurado ? "Entrar al panel" : "Entrar a demostración"}<ChevronRight size={17} /></button>
          {!supabaseConfigurado && <div className="demo-message"><ShieldCheck size={16} /><span><strong>Modo demostración activo</strong>No hay credenciales configuradas; puedes recorrer todas las vistas y cambiar de rol desde la barra superior.</span></div>}
        </form>
      </section>
    </main>
  );
}

function Sidebar({ vista, opcionesPrincipales, opciones, solicitudesActivas, abierta, colapsada, administracionAbierta, onAdminToggle, onCollapseToggle, onNavigate, onClose }: { vista: VistaId; opcionesPrincipales: typeof navegacionPrincipal; opciones: typeof navegacionAdministrativa; solicitudesActivas: number; abierta: boolean; colapsada: boolean; administracionAbierta: boolean; onAdminToggle: () => void; onCollapseToggle: () => void; onNavigate: (vista: VistaId) => void; onClose: () => void }) {
  const navegar = (destino: VistaId) => { onNavigate(destino); onClose(); };
  const alternarAdministracion = () => {
    if (colapsada) {
      onCollapseToggle();
      if (!administracionAbierta) onAdminToggle();
      return;
    }
    onAdminToggle();
  };
  return (
    <aside className={`app-sidebar ${abierta ? "open" : ""} ${colapsada ? "collapsed" : ""}`}>
      <header>
        <div className="brand-lockup"><span className="brand-mark">I</span><div><strong>ICSI</strong><span>Vacaciones</span></div></div>
        <button className="icon-button mobile-only" type="button" onClick={onClose} aria-label="Cerrar menú" title="Cerrar menú"><X size={19} /></button>
      </header>
      <nav aria-label="Navegación principal">
        <span className="nav-label">Operación</span>
        {opcionesPrincipales.map(({ id, etiqueta, icono: Icono }) => <button key={id} className={vista === id ? "active" : ""} type="button" title={etiqueta} aria-label={etiqueta} onClick={() => navegar(id)}><Icono size={18} /><span>{etiqueta}</span>{vista === id && <i />}</button>)}
        {opciones.length > 0 && (
          <>
            <span className="nav-label admin-label">Gestión</span>
            <button className={`nav-parent ${opciones.some((item) => item.id === vista) ? "active-parent" : ""}`} type="button" title="Administrar" aria-label="Administrar" onClick={alternarAdministracion}><UserCog size={18} /><span>Administrar</span>{solicitudesActivas > 0 && <span className="nav-count">{solicitudesActivas}</span>}<ChevronDown size={15} className={administracionAbierta ? "rotated" : ""} /></button>
            <div className={`nav-submenu ${administracionAbierta ? "expanded" : ""}`}>{opciones.map(({ id, etiqueta, icono: Icono }) => <button key={id} className={vista === id ? "active" : ""} type="button" title={etiqueta} aria-label={etiqueta} onClick={() => navegar(id)}><Icono size={16} /><span>{etiqueta}</span>{id === "solicitudes" && solicitudesActivas > 0 && <span className="nav-count">{solicitudesActivas}</span>}{vista === id && <i />}</button>)}</div>
          </>
        )}
      </nav>
      <footer><div className="sidebar-help"><span className="icon-tile amber"><ShieldCheck size={17} /></span><div><strong>Datos protegidos</strong><span>Acceso mediante Supabase RLS</span></div></div><span className="version-label">ICSI People · v1.0</span></footer>
    </aside>
  );
}

function RequestModal({ datos, perfil, actualizando, onClose, onCreate }: { datos: DatosVacaciones; perfil: PerfilUsuario | null; actualizando: boolean; onClose: () => void; onCreate: (formulario: SolicitudFormulario) => Promise<boolean> }) {
  const esAutoservicio = perfil?.rol === "empleado";
  const [formulario, setFormulario] = useState<SolicitudFormulario>({ empleadoId: esAutoservicio ? perfil?.empleadoId ?? "" : "", fechaInicio: "", fechaFin: "", fechaReintegro: "", comentarios: "" });
  const actualizar = (campo: keyof SolicitudFormulario, valor: string) => setFormulario((actual) => ({ ...actual, [campo]: valor }));
  const opcionesEmpleado = esAutoservicio ? datos.empleados.filter((emp) => emp.id === perfil?.empleadoId) : datos.empleados;
  const empleadoElegido = datos.empleados.find((emp) => emp.id === formulario.empleadoId);
  // Una cuenta de autoservicio sin empleado_id vinculado en perfiles_usuario
  // se topaba con un desplegable vacío y deshabilitado sin explicación (y el
  // guardado fallaba silenciosamente con "Selecciona un empleado válido").
  const sinEmpleadoVinculado = esAutoservicio && !perfil?.empleadoId;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) onClose(); }}>
      <form className="form-modal request-form" onSubmit={(e) => { e.preventDefault(); if (!sinEmpleadoVinculado) void onCreate(formulario); }}>
        <header><div><span className="eyebrow">Calendario</span><h2>Crear solicitud</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar" title="Cerrar"><X size={19} /></button></header>
        {sinEmpleadoVinculado ? (
          <div className="inline-alert error">Tu cuenta todavía no está vinculada a un registro de empleado, así que no puedes crear solicitudes. Contacta a RRHH o a Administración para que la asocien.</div>
        ) : (
          <>
            <div className="form-grid two-columns">
              {esAutoservicio ? (
                <div className="span-two stat-grid">
                  <div className="mini-stat"><span>Disponibles</span><strong>{empleadoElegido?.saldo.diasDisponibles ?? 0}</strong></div>
                  <div className="mini-stat"><span>Tomados</span><strong>{empleadoElegido?.saldo.diasTomados ?? 0}</strong></div>
                </div>
              ) : (
                <>
                  <label className="span-two"><span>Empleado *</span><Select value={formulario.empleadoId} onChange={(valor) => actualizar("empleadoId", valor)}><option value="">Seleccionar</option>{opcionesEmpleado.map((emp) => <option value={emp.id} key={emp.id}>{emp.nombre}</option>)}</Select></label>
                  {empleadoElegido && (
                    <div className="span-two stat-grid">
                      <div className="mini-stat"><span>Disponibles</span><strong>{empleadoElegido.saldo.diasDisponibles}</strong></div>
                      <div className="mini-stat"><span>Tomados</span><strong>{empleadoElegido.saldo.diasTomados}</strong></div>
                    </div>
                  )}
                </>
              )}
              <label><span>Inicio *</span><input required type="date" value={formulario.fechaInicio} onChange={(e) => actualizar("fechaInicio", e.target.value)} /></label><label><span>Fin *</span><input required type="date" min={formulario.fechaInicio} value={formulario.fechaFin} onChange={(e) => actualizar("fechaFin", e.target.value)} /></label><label><span>Reintegro</span><input type="date" value={formulario.fechaReintegro} onChange={(e) => actualizar("fechaReintegro", e.target.value)} /></label><label className="span-two"><span>Comentarios</span><textarea rows={3} value={formulario.comentarios} onChange={(e) => actualizar("comentarios", e.target.value)} /></label>
            </div>
            <p className="empty-note">La solicitud entra al flujo de aprobación: RRHH → Jefe inmediato → Mesa Directiva.</p>
          </>
        )}
        <footer><button className="secondary-button" type="button" onClick={onClose} title="Cancelar">Cancelar</button>{!sinEmpleadoVinculado && <button className="primary-button" disabled={actualizando} type="submit" title={actualizando ? "Guardando…" : "Guardar solicitud"}>{actualizando ? "Guardando…" : "Guardar solicitud"}</button>}</footer>
      </form>
    </div>
  );
}

export default function VacationApp() {
  const [sesion, setSesion] = useState<Session | null>(null);
  const [perfilSesion, setPerfilSesion] = useState<PerfilUsuario | null>(null);
  const [rolDemo, setRolDemo] = useState<keyof typeof PERFILES_DEMOSTRACION>("administrador");
  const [demoAutorizada, setDemoAutorizada] = useState(false);
  const [verificandoSesion, setVerificandoSesion] = useState(supabaseConfigurado);
  const [vista, setVista] = useState<VistaId>("resumen");
  const [anio, setAnio] = useState(2026);
  const [temaOscuro, setTemaOscuro] = useState(false);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [sidebarColapsada, setSidebarColapsada] = useState(false);
  const [adminAbierto, setAdminAbierto] = useState(true);
  const [filtros, setFiltros] = useState<FiltrosCalendario>(filtrosIniciales);
  const [crearSolicitud, setCrearSolicitud] = useState(false);

  useEffect(() => {
    const temaGuardado = window.localStorage.getItem("icsi-tema");
    const temporizador = window.setTimeout(() => {
      setTemaOscuro(temaGuardado ? temaGuardado === "oscuro" : window.matchMedia("(prefers-color-scheme: dark)").matches);
    }, 0);
    return () => window.clearTimeout(temporizador);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = temaOscuro ? "dark" : "light";
    window.localStorage.setItem("icsi-tema", temaOscuro ? "oscuro" : "claro");
  }, [temaOscuro]);
  useEffect(() => {
    const supabase = obtenerSupabase();
    if (!supabase) return;
    void supabase.auth.getSession().then(async ({ data }) => {
      const perfil = data.session ? await obtenerPerfilAcceso(data.session.user.id) : null;
      const valida = puedeAccederPanel(perfil);
      setSesion(valida ? data.session : null);
      setPerfilSesion(valida ? perfil : null);
      if (data.session && !valida) await supabase.auth.signOut();
      setVerificandoSesion(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_evento, nuevaSesion) => {
      if (!nuevaSesion) {
        setSesion(null);
        setPerfilSesion(null);
        return;
      }
      void obtenerPerfilAcceso(nuevaSesion.user.id).then(async (perfil) => {
        const valida = puedeAccederPanel(perfil);
        setSesion(valida ? nuevaSesion : null);
        setPerfilSesion(valida ? perfil : null);
        if (!valida) await supabase.auth.signOut();
      });
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const autorizado = supabaseConfigurado ? Boolean(sesion) : demoAutorizada;
  const perfil = supabaseConfigurado ? perfilSesion : PERFILES_DEMOSTRACION[rolDemo];
  const sinEmpleadoVinculado = perfil?.rol === "empleado" && !perfil.empleadoId;
  // Personal y Catálogos: alta y edición para administrador y RRHH. Por ahora
  // RRHH tiene permisos muy parecidos a los del administrador; la diferencia
  // vigente es que solo el administrador elimina registros y gestiona accesos.
  const esAdministrador = perfil?.rol === "administrador";
  const puedeGestionar = esAdministrador || perfil?.rol === "rrhh";
  const sistema = useVacationSystem(autorizado, anio);
  // Un "empleado" en autoservicio no tiene filtros (ver EmployeeFocus): su
  // panel de enfoque siempre muestra su propio registro, no el de los filtros
  // de equipo (que ni siquiera se le muestran).
  const empleadoSeleccionado = perfil?.rol === "empleado"
    ? sistema.datos.empleados.find((empleado) => empleado.id === perfil.empleadoId)
    : sistema.datos.empleados.find((empleado) => empleado.id === filtros.empleadoId);
  const solicitudesFiltradas = useMemo(() => sistema.datos.solicitudes.filter((solicitud) => {
    const empleado = sistema.datos.empleados.find((item) => item.id === solicitud.empleadoId);
    return (!filtros.empleadoId || solicitud.empleadoId === filtros.empleadoId)
      && (!filtros.sedeId || empleado?.sedeId === filtros.sedeId)
      && (!filtros.proyectoId || empleado?.proyectoId === filtros.proyectoId)
      && (!filtros.categoriaId || empleado?.categoriaId === filtros.categoriaId)
      && (!filtros.estado || solicitud.estado === filtros.estado);
  }), [filtros, sistema.datos.empleados, sistema.datos.solicitudes]);

  const solicitudesActivas = useMemo(
    () => sistema.datos.solicitudes.filter((solicitud) => solicitud.estado === "pendiente").length,
    [sistema.datos.solicitudes],
  );
  const opcionesAdministrativas = useMemo(
    () => navegacionAdministrativa.filter((item) => !item.soloGestion || puedeGestionar),
    [puedeGestionar],
  );
  // El resumen agregado (saldos bajos, ausencias de todo el equipo) es
  // informacion de revision, no de autoservicio: se oculta para "empleado"
  // (raso o jefe inmediato), que entra directo a Calendario/Solicitudes.
  const opcionesPrincipales = useMemo(
    () => navegacionPrincipal.filter((item) => item.id !== "resumen" || perfil?.rol !== "empleado"),
    [perfil?.rol],
  );
  // Deriva la vista visible en vez de sincronizarla con un efecto: si el rol
  // actual pierde acceso a la vista seleccionada (p. ej. al cambiar de rol en
  // modo demostración), se muestra el calendario (o solicitudes) sin
  // descartar la seleccion guardada en el estado.
  const vistaPorDefecto: VistaId = opcionesPrincipales.some((item) => item.id === "resumen") ? "resumen" : "calendario";
  const vistaEfectiva = [...opcionesPrincipales, ...opcionesAdministrativas].some((item) => item.id === vista) ? vista : vistaPorDefecto;

  const cerrarSesion = async () => {
    if (supabaseConfigurado) await obtenerSupabase()?.auth.signOut();
    else setDemoAutorizada(false);
  };
  const crearSolicitudRapida = async (formulario: SolicitudFormulario) => {
    const correcto = await sistema.guardarSolicitud(formulario);
    if (correcto) setCrearSolicitud(false);
    return correcto;
  };

  if (verificandoSesion) return <main className="loading-screen"><span className="brand-mark pulse">I</span><p>Preparando el panel…</p></main>;
  if (!autorizado) return <LoginScreen onDemo={() => setDemoAutorizada(true)} />;

  return (
    <div className={`app-shell ${sidebarColapsada ? "sidebar-collapsed" : ""}`}>
      {menuAbierto && <button className="sidebar-scrim" type="button" onClick={() => setMenuAbierto(false)} aria-label="Cerrar menú" />}
      <Sidebar vista={vistaEfectiva} opcionesPrincipales={opcionesPrincipales} opciones={opcionesAdministrativas} solicitudesActivas={solicitudesActivas} abierta={menuAbierto} colapsada={sidebarColapsada} administracionAbierta={adminAbierto} onAdminToggle={() => setAdminAbierto((actual) => !actual)} onCollapseToggle={() => setSidebarColapsada((actual) => !actual)} onNavigate={setVista} onClose={() => setMenuAbierto(false)} />
      <div className="app-workspace">
        <header className="app-topbar">
          <div className="topbar-left"><button className="icon-button mobile-menu" type="button" onClick={() => setMenuAbierto(true)} aria-label="Abrir menú" title="Abrir menú"><Menu size={20} /></button><button className="icon-button sidebar-topbar-toggle desktop-only" type="button" onClick={() => setSidebarColapsada((actual) => !actual)} aria-label={sidebarColapsada ? "Expandir panel lateral" : "Colapsar panel lateral"} title={sidebarColapsada ? "Expandir panel" : "Colapsar panel"}>{sidebarColapsada ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button><div><span className="eyebrow">ICSI OIL & GAS</span><strong>{vistaEfectiva === "calendario" ? "Calendario del equipo" : [...navegacionPrincipal, ...navegacionAdministrativa].find((item) => item.id === vistaEfectiva)?.etiqueta}</strong></div></div>
          <div className="topbar-actions">
            {sistema.modoDemostracion && (
              <label className="compact-select" title="Cambiar de rol en modo demostración">
                <span>Rol</span>
                <Select value={rolDemo} onChange={(valor) => setRolDemo(valor as keyof typeof PERFILES_DEMOSTRACION)}>
                  <option value="administrador">Administración</option>
                  <option value="rrhh">RRHH</option>
                  <option value="jefe_inmediato">Jefe inmediato (Luis)</option>
                  <option value="mesa_directiva">Mesa Directiva</option>
                  <option value="empleado">Empleado (Nathanael)</option>
                </Select>
              </label>
            )}
            <button className="icon-button" type="button" onClick={() => setTemaOscuro((actual) => !actual)} aria-label={temaOscuro ? "Activar modo claro" : "Activar modo oscuro"} title={temaOscuro ? "Activar modo claro" : "Activar modo oscuro"}>{temaOscuro ? <Sun size={18} /> : <Moon size={18} />}</button>
            <button className="icon-button notification-button" type="button" aria-label="Notificaciones" title="Notificaciones"><Bell size={18} /><i /></button>
            <span className="topbar-divider" />
            <div className="profile-chip" title={sesion?.user.email ?? perfil?.nombreVisible ?? "Modo demostración"}><span className="avatar small">{(perfil?.nombreVisible ?? "AD").split(" ").slice(0, 2).map((p) => p[0]).join("")}</span><div><strong>{perfil ? nombresDePila(perfil.nombreVisible) : "Administración"}</strong><span>{perfil ? etiquetaPerfil(perfil) : "Administración"}</span></div></div>
            <button className="icon-button" type="button" onClick={cerrarSesion} aria-label="Cerrar sesión" title="Cerrar sesión"><LogOut size={18} /></button>
          </div>
        </header>
        {sistema.modoDemostracion && <div className="demo-banner"><span><ShieldCheck size={15} /><strong>Demostración</strong> Los cambios son temporales hasta conectar Supabase.</span></div>}
        {sistema.error && <div className="global-error">{sistema.error}</div>}
        <main className="app-main">
          {vistaEfectiva === "resumen" && <DashboardView datos={sistema.datos} onNavigate={setVista} />}
          {vistaEfectiva === "calendario" && <div className="calendar-page page-stack"><section className="calendar-toolbar"><div><h1>Vacaciones del equipo</h1><p>Identifica ausencias simultáneas y consulta el detalle de cada día.</p></div><div className="calendar-actions"><div className="year-switch"><button type="button" onClick={() => setAnio((actual) => actual - 1)} aria-label="Año anterior" title="Año anterior"><ChevronLeft size={17} /></button><strong>{anio}</strong><button type="button" onClick={() => setAnio((actual) => actual + 1)} aria-label="Año siguiente" title="Año siguiente"><ChevronRight size={17} /></button></div>{(perfil?.rol === "administrador" || perfil?.rol === "empleado") && <button className="primary-button" type="button" disabled={sinEmpleadoVinculado} onClick={() => setCrearSolicitud(true)} title={sinEmpleadoVinculado ? "Tu cuenta no está vinculada a un empleado; contacta a RRHH o Administración" : "Crear solicitud"}><Plus size={17} />Crear solicitud</button>}</div></section><div className="calendar-content"><EmployeeFocus datos={sistema.datos} filtros={filtros} empleadoSeleccionado={empleadoSeleccionado} perfil={perfil} onChange={setFiltros} /><section className="calendar-surface content-card">{sistema.cargando ? <div className="calendar-loading"><span className="loader" /><p>Cargando calendario…</p></div> : <YearCalendar anio={anio} solicitudes={solicitudesFiltradas} diasFestivos={sistema.datos.diasFestivos} compacto={perfil?.rol === "empleado"} />}</section></div></div>}
          {vistaEfectiva === "personal" && puedeGestionar && <EmployeesView datos={sistema.datos} actualizando={sistema.actualizando} onSave={sistema.guardarEmpleado} onToggleEstado={sistema.cambiarEstadoEmpleado} onDelete={esAdministrador ? sistema.eliminarEmpleado : undefined} puedeGestionarAccesos={esAdministrador} />}
          {vistaEfectiva === "solicitudes" && (
            <RequestsView
              datos={sistema.datos}
              perfil={perfil}
              actualizando={sistema.actualizando}
              onCreate={perfil?.rol === "administrador" || perfil?.rol === "empleado" ? sistema.guardarSolicitud : undefined}
              onRevisar={sistema.revisarSolicitud}
              onObtenerRevisiones={sistema.obtenerRevisiones}
              onCancelar={perfil?.rol === "administrador" ? sistema.cambiarEstadoSolicitud : undefined}
              onDelete={perfil?.rol === "administrador" ? sistema.eliminarSolicitud : undefined}
            />
          )}
          {vistaEfectiva === "catalogos" && puedeGestionar && <CatalogsView datos={sistema.datos} actualizando={sistema.actualizando} onSave={sistema.guardarCatalogo} onDelete={esAdministrador ? sistema.eliminarCatalogo : undefined} onSaveFestivo={sistema.guardarFestivo} onDeleteFestivo={esAdministrador ? sistema.eliminarFestivo : undefined} />}
        </main>
      </div>
      {crearSolicitud && <RequestModal datos={sistema.datos} perfil={perfil} actualizando={sistema.actualizando} onClose={() => setCrearSolicitud(false)} onCreate={crearSolicitudRapida} />}
    </div>
  );
}
