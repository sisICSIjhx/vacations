export type VistaId =
  | "resumen"
  | "calendario"
  | "personal"
  | "solicitudes"
  | "catalogos";

export type EstadoSolicitud =
  | "planeada"
  | "pendiente"
  | "aprobada"
  | "rechazada"
  | "cancelada";

// Etapa granular del flujo de aprobacion mientras estado permanece en
// "pendiente". Una vez decidida, converge con estado: 'aprobada' solo se
// alcanza tras la aprobacion de Mesa Directiva; 'rechazada' puede ocurrir en
// cualquiera de las tres etapas (ver etapaRechazo para saber cual).
export type EtapaAprobacion =
  | "rrhh"
  | "jefe_inmediato"
  | "mesa_directiva"
  | "aprobada"
  | "rechazada";

export type RolUsuario = "administrador" | "rrhh" | "mesa_directiva" | "empleado";

export type DecisionRevision = "aprobado" | "rechazado";

export interface RevisionSolicitud {
  id: string;
  solicitudId: string;
  etapa: Exclude<EtapaAprobacion, "aprobada" | "rechazada">;
  decision: DecisionRevision;
  estadoResultante: string;
  nombreRevisor?: string;
  comentario?: string;
  creadoEn: string;
}

export interface PerfilUsuario {
  usuarioId: string;
  empleadoId?: string;
  nombreVisible: string;
  rol: RolUsuario;
  activo: boolean;
  esJefeInmediato: boolean;
}

export interface Catalogo {
  id: string;
  nombre: string;
  codigo?: string;
  color?: string;
}

export interface SaldoVacaciones {
  anio: number;
  diasPorDerecho: number;
  diasAcumulados: number;
  diasDisponibles: number;
  diasTomados: number;
  diasPlaneados: number;
  diasPendientes: number;
  fechaCorte: string;
}

export interface Empleado {
  id: string;
  organizacionId?: string;
  numeroEmpleado: string;
  nombre: string;
  correo?: string;
  telefonoWhatsapp?: string;
  curp?: string;
  nss?: string;
  color: string;
  sedeId?: string;
  sede: string;
  proyectoId?: string;
  proyecto: string;
  categoriaId?: string;
  categoria: string;
  fechaIngreso?: string;
  estado: "activo" | "inactivo";
  jefeInmediatoId?: string;
  jefeInmediato?: string;
  saldo: SaldoVacaciones;
}

export interface SolicitudAusencia {
  id: string;
  organizacionId?: string;
  empleadoId: string;
  tipoAusenciaId?: string;
  nombreEmpleado: string;
  colorEmpleado: string;
  fechaSolicitud?: string;
  fechaInicio: string;
  fechaFin: string;
  fechaReintegro?: string;
  estado: EstadoSolicitud;
  etapaAprobacion: EtapaAprobacion;
  etapaRechazo?: Exclude<EtapaAprobacion, "aprobada" | "rechazada">;
  dias: number;
  comentarios?: string;
  origen: "administrador" | "csv" | "formulario" | "empleado" | "integracion";
}

export interface DiaFestivo {
  id: string;
  fecha: string;
  nombre: string;
  sedeId?: string;
}

export interface DatosVacaciones {
  empleados: Empleado[];
  solicitudes: SolicitudAusencia[];
  diasFestivos: DiaFestivo[];
  sedes: Catalogo[];
  proyectos: Catalogo[];
  categorias: Catalogo[];
  tiposAusencia: Catalogo[];
}

export interface FiltrosCalendario {
  empleadoId: string;
  sedeId: string;
  proyectoId: string;
  categoriaId: string;
  estado: string;
}

export interface EmpleadoFormulario {
  id?: string;
  numeroEmpleado: string;
  nombre: string;
  correo: string;
  telefonoWhatsapp: string;
  curp: string;
  nss: string;
  color: string;
  sedeId: string;
  proyectoId: string;
  categoriaId: string;
  fechaIngreso: string;
  jefeInmediatoId: string;
  diasPorDerecho: number;
  diasAcumulados: number;
  diasDisponibles: number;
}

export interface SolicitudFormulario {
  id?: string;
  empleadoId: string;
  fechaInicio: string;
  fechaFin: string;
  fechaReintegro: string;
  comentarios: string;
  urgente?: boolean;
}
