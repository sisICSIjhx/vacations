"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Bell, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ClipboardList,
  FileUp, LayoutDashboard, LogOut, Menu, Moon, Plus, Settings2, ShieldCheck,
  PanelLeftClose, PanelLeftOpen, Sun, UserCog, UsersRound, X,
} from "lucide-react";
import { CatalogsView } from "./components/CatalogsView";
import { DashboardView } from "./components/DashboardView";
import { EmployeeFocus } from "./components/EmployeeFocus";
import { EmployeesView } from "./components/EmployeesView";
import { ImportView } from "./components/ImportView";
import { RequestsView } from "./components/RequestsView";
import { YearCalendar } from "./components/YearCalendar";
import { useVacationSystem } from "./hooks/useVacationSystem";
import { obtenerSupabase, supabaseConfigurado } from "./lib/supabase";
import type { DatosVacaciones, FiltrosCalendario, SolicitudFormulario, VistaId } from "./types";

const filtrosIniciales: FiltrosCalendario = { empleadoId: "", sedeId: "", proyectoId: "", categoriaId: "", estado: "" };
const navegacionPrincipal = [
  { id: "resumen" as VistaId, etiqueta: "Resumen", icono: LayoutDashboard },
  { id: "calendario" as VistaId, etiqueta: "Calendario", icono: CalendarDays },
];
const navegacionAdministrativa = [
  { id: "personal" as VistaId, etiqueta: "Personal", icono: UsersRound },
  { id: "solicitudes" as VistaId, etiqueta: "Solicitudes", icono: ClipboardList },
  { id: "catalogos" as VistaId, etiqueta: "Catálogos", icono: Settings2 },
  { id: "importaciones" as VistaId, etiqueta: "Importar CSV", icono: FileUp },
];

async function esAdministrador(usuarioId: string) {
  const supabase = obtenerSupabase();
  if (!supabase) return true;
  const { data, error } = await supabase
    .schema("vacaciones")
    .from("perfiles_usuario")
    .select("rol,activo")
    .eq("usuario_id", usuarioId)
    .maybeSingle();
  return !error && data?.activo === true && data.rol === "administrador";
}

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
    else if (data.user && !(await esAdministrador(data.user.id))) {
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
          <div><span className="eyebrow">Acceso administrativo</span><h2>Inicia sesión</h2><p>Usa la cuenta de administrador registrada en Supabase.</p></div>
          <label><span>Correo electrónico</span><input required={supabaseConfigurado} type="email" autoComplete="email" value={correo} onChange={(e) => setCorreo(e.target.value)} placeholder="administracion@icsi.com" /></label>
          <label><span>Contraseña</span><input required={supabaseConfigurado} type="password" autoComplete="current-password" value={contrasena} onChange={(e) => setContrasena(e.target.value)} placeholder="••••••••••••" /></label>
          {error && <div className="inline-alert error">{error}</div>}
          <button className="primary-button login-button" type={supabaseConfigurado ? "submit" : "button"} onClick={supabaseConfigurado ? undefined : onDemo} disabled={cargando}>{cargando ? "Verificando…" : supabaseConfigurado ? "Entrar al panel" : "Entrar a demostración"}<ChevronRight size={17} /></button>
          {!supabaseConfigurado && <div className="demo-message"><ShieldCheck size={16} /><span><strong>Modo demostración activo</strong>No hay credenciales configuradas; puedes recorrer todas las vistas.</span></div>}
        </form>
      </section>
    </main>
  );
}

function Sidebar({ vista, abierta, colapsada, administracionAbierta, onAdminToggle, onCollapseToggle, onNavigate, onClose }: { vista: VistaId; abierta: boolean; colapsada: boolean; administracionAbierta: boolean; onAdminToggle: () => void; onCollapseToggle: () => void; onNavigate: (vista: VistaId) => void; onClose: () => void }) {
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
        <button className="icon-button mobile-only" type="button" onClick={onClose} aria-label="Cerrar menú"><X size={19} /></button>
      </header>
      <nav aria-label="Navegación principal">
        <span className="nav-label">Operación</span>
        {navegacionPrincipal.map(({ id, etiqueta, icono: Icono }) => <button key={id} className={vista === id ? "active" : ""} type="button" title={colapsada ? etiqueta : undefined} aria-label={etiqueta} onClick={() => navegar(id)}><Icono size={18} /><span>{etiqueta}</span>{vista === id && <i />}</button>)}
        <span className="nav-label admin-label">Gestión</span>
        <button className={`nav-parent ${navegacionAdministrativa.some((item) => item.id === vista) ? "active-parent" : ""}`} type="button" title={colapsada ? "Administrar" : undefined} aria-label="Administrar" onClick={alternarAdministracion}><UserCog size={18} /><span>Administrar</span><ChevronDown size={15} className={administracionAbierta ? "rotated" : ""} /></button>
        <div className={`nav-submenu ${administracionAbierta ? "expanded" : ""}`}>{navegacionAdministrativa.map(({ id, etiqueta, icono: Icono }) => <button key={id} className={vista === id ? "active" : ""} type="button" aria-label={etiqueta} onClick={() => navegar(id)}><Icono size={16} /><span>{etiqueta}</span>{vista === id && <i />}</button>)}</div>
      </nav>
      <footer><div className="sidebar-help"><span className="icon-tile amber"><ShieldCheck size={17} /></span><div><strong>Datos protegidos</strong><span>Acceso mediante Supabase RLS</span></div></div><span className="version-label">ICSI People · v1.0</span></footer>
    </aside>
  );
}

function RequestModal({ datos, actualizando, onClose, onCreate }: { datos: DatosVacaciones; actualizando: boolean; onClose: () => void; onCreate: (formulario: SolicitudFormulario) => Promise<boolean> }) {
  const [formulario, setFormulario] = useState<SolicitudFormulario>({ empleadoId: "", fechaInicio: "", fechaFin: "", fechaReintegro: "", estado: "planeada", comentarios: "" });
  const actualizar = (campo: keyof SolicitudFormulario, valor: string) => setFormulario((actual) => ({ ...actual, [campo]: valor }));
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) onClose(); }}>
      <form className="form-modal request-form" onSubmit={(e) => { e.preventDefault(); void onCreate(formulario); }}>
        <header><div><span className="eyebrow">Calendario</span><h2>Crear solicitud</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar"><X size={19} /></button></header>
        <div className="form-grid two-columns"><label className="span-two"><span>Empleado *</span><select required value={formulario.empleadoId} onChange={(e) => actualizar("empleadoId", e.target.value)}><option value="">Seleccionar</option>{datos.empleados.map((emp) => <option value={emp.id} key={emp.id}>{emp.nombre} · {emp.saldo.diasDisponibles} disponibles</option>)}</select></label><label><span>Inicio *</span><input required type="date" value={formulario.fechaInicio} onChange={(e) => actualizar("fechaInicio", e.target.value)} /></label><label><span>Fin *</span><input required type="date" min={formulario.fechaInicio} value={formulario.fechaFin} onChange={(e) => actualizar("fechaFin", e.target.value)} /></label><label><span>Reintegro</span><input type="date" value={formulario.fechaReintegro} onChange={(e) => actualizar("fechaReintegro", e.target.value)} /></label><label><span>Estado</span><select value={formulario.estado} onChange={(e) => actualizar("estado", e.target.value)}><option value="planeada">Planeada</option><option value="pendiente">Pendiente</option></select></label><label className="span-two"><span>Comentarios</span><textarea rows={3} value={formulario.comentarios} onChange={(e) => actualizar("comentarios", e.target.value)} /></label></div>
        <footer><button className="secondary-button" type="button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={actualizando} type="submit">{actualizando ? "Guardando…" : "Guardar solicitud"}</button></footer>
      </form>
    </div>
  );
}

export default function VacationApp() {
  const [sesion, setSesion] = useState<Session | null>(null);
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
      const valida = data.session && await esAdministrador(data.session.user.id);
      setSesion(valida ? data.session : null);
      if (data.session && !valida) await supabase.auth.signOut();
      setVerificandoSesion(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_evento, nuevaSesion) => {
      if (!nuevaSesion) {
        setSesion(null);
        return;
      }
      void esAdministrador(nuevaSesion.user.id).then(async (valida) => {
        setSesion(valida ? nuevaSesion : null);
        if (!valida) await supabase.auth.signOut();
      });
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const autorizado = supabaseConfigurado ? Boolean(sesion) : demoAutorizada;
  const sistema = useVacationSystem(autorizado, anio);
  const empleadoSeleccionado = sistema.datos.empleados.find((empleado) => empleado.id === filtros.empleadoId);
  const solicitudesFiltradas = useMemo(() => sistema.datos.solicitudes.filter((solicitud) => {
    const empleado = sistema.datos.empleados.find((item) => item.id === solicitud.empleadoId);
    return (!filtros.empleadoId || solicitud.empleadoId === filtros.empleadoId)
      && (!filtros.sedeId || empleado?.sedeId === filtros.sedeId)
      && (!filtros.proyectoId || empleado?.proyectoId === filtros.proyectoId)
      && (!filtros.categoriaId || empleado?.categoriaId === filtros.categoriaId)
      && (!filtros.estado || solicitud.estado === filtros.estado);
  }), [filtros, sistema.datos.empleados, sistema.datos.solicitudes]);

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
      <Sidebar vista={vista} abierta={menuAbierto} colapsada={sidebarColapsada} administracionAbierta={adminAbierto} onAdminToggle={() => setAdminAbierto((actual) => !actual)} onCollapseToggle={() => setSidebarColapsada((actual) => !actual)} onNavigate={setVista} onClose={() => setMenuAbierto(false)} />
      <div className="app-workspace">
        <header className="app-topbar">
          <div className="topbar-left"><button className="icon-button mobile-menu" type="button" onClick={() => setMenuAbierto(true)} aria-label="Abrir menú"><Menu size={20} /></button><button className="icon-button sidebar-topbar-toggle desktop-only" type="button" onClick={() => setSidebarColapsada((actual) => !actual)} aria-label={sidebarColapsada ? "Expandir panel lateral" : "Colapsar panel lateral"} title={sidebarColapsada ? "Expandir panel" : "Colapsar panel"}>{sidebarColapsada ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button><div><span className="eyebrow">ICSI OIL & GAS</span><strong>{vista === "calendario" ? "Calendario del equipo" : [...navegacionPrincipal, ...navegacionAdministrativa].find((item) => item.id === vista)?.etiqueta}</strong></div></div>
          <div className="topbar-actions"><button className="icon-button" type="button" onClick={() => setTemaOscuro((actual) => !actual)} aria-label={temaOscuro ? "Activar modo claro" : "Activar modo oscuro"}>{temaOscuro ? <Sun size={18} /> : <Moon size={18} />}</button><button className="icon-button notification-button" type="button" aria-label="Notificaciones"><Bell size={18} /><i /></button><span className="topbar-divider" /><div className="profile-chip"><span className="avatar small">AD</span><div><strong>Administración</strong><span>{sesion?.user.email ?? "Modo demostración"}</span></div></div><button className="icon-button" type="button" onClick={cerrarSesion} aria-label="Cerrar sesión"><LogOut size={18} /></button></div>
        </header>
        {sistema.modoDemostracion && <div className="demo-banner"><span><ShieldCheck size={15} /><strong>Demostración</strong> Los cambios son temporales hasta conectar Supabase.</span><button type="button" onClick={() => setVista("importaciones")}>Ver configuración</button></div>}
        {sistema.error && <div className="global-error">{sistema.error}</div>}
        <main className="app-main">
          {vista === "resumen" && <DashboardView datos={sistema.datos} onNavigate={setVista} />}
          {vista === "calendario" && <div className="calendar-page page-stack"><section className="calendar-toolbar"><div><h1>Vacaciones del equipo</h1><p>Identifica ausencias simultáneas y consulta el detalle de cada día.</p></div><div className="calendar-actions"><div className="year-switch"><button type="button" onClick={() => setAnio((actual) => actual - 1)} aria-label="Año anterior"><ChevronLeft size={17} /></button><strong>{anio}</strong><button type="button" onClick={() => setAnio((actual) => actual + 1)} aria-label="Año siguiente"><ChevronRight size={17} /></button></div><button className="primary-button" type="button" onClick={() => setCrearSolicitud(true)}><Plus size={17} />Crear solicitud</button></div></section><div className="calendar-content"><EmployeeFocus datos={sistema.datos} filtros={filtros} empleadoSeleccionado={empleadoSeleccionado} onChange={setFiltros} /><section className="calendar-surface content-card">{sistema.cargando ? <div className="calendar-loading"><span className="loader" /><p>Cargando calendario…</p></div> : <YearCalendar anio={anio} solicitudes={solicitudesFiltradas} diasFestivos={sistema.datos.diasFestivos} />}</section></div></div>}
          {vista === "personal" && <EmployeesView datos={sistema.datos} actualizando={sistema.actualizando} onSave={sistema.guardarEmpleado} />}
          {vista === "solicitudes" && <RequestsView datos={sistema.datos} actualizando={sistema.actualizando} onCreate={sistema.guardarSolicitud} onStatus={sistema.cambiarEstadoSolicitud} />}
          {vista === "catalogos" && <CatalogsView datos={sistema.datos} actualizando={sistema.actualizando} onSave={sistema.guardarCatalogo} onDelete={sistema.eliminarCatalogo} />}
          {vista === "importaciones" && <ImportView incidencias={sistema.datos.incidencias} onImport={sistema.importarCsv} />}
        </main>
      </div>
      {crearSolicitud && <RequestModal datos={sistema.datos} actualizando={sistema.actualizando} onClose={() => setCrearSolicitud(false)} onCreate={crearSolicitudRapida} />}
    </div>
  );
}
