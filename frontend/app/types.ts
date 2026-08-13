export type VistaId =
  | "resumen"
  | "calendario"
  | "personal"
  | "solicitudes"
  | "catalogos"
  | "importaciones";

export type EstadoSolicitud =
  | "planeada"
  | "pendiente"
  | "aprobada"
  | "rechazada"
  | "cancelada";

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
  saldo: SaldoVacaciones;
}

export interface SolicitudAusencia {
  id: string;
  organizacionId?: string;
  empleadoId: string;
  tipoAusenciaId?: string;
  nombreEmpleado: string;
  colorEmpleado: string;
  fechaInicio: string;
  fechaFin: string;
  fechaReintegro?: string;
  estado: EstadoSolicitud;
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

export interface IncidenciaImportacion {
  id: string;
  fila: number;
  gravedad: "advertencia" | "error";
  mensaje: string;
}

export interface DatosVacaciones {
  empleados: Empleado[];
  solicitudes: SolicitudAusencia[];
  diasFestivos: DiaFestivo[];
  sedes: Catalogo[];
  proyectos: Catalogo[];
  categorias: Catalogo[];
  tiposAusencia: Catalogo[];
  incidencias: IncidenciaImportacion[];
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
  curp: string;
  nss: string;
  color: string;
  sedeId: string;
  proyectoId: string;
  categoriaId: string;
  fechaIngreso: string;
  diasPorDerecho: number;
  diasAcumulados: number;
  diasDisponibles: number;
}

export interface SolicitudFormulario {
  empleadoId: string;
  fechaInicio: string;
  fechaFin: string;
  fechaReintegro: string;
  estado: EstadoSolicitud;
  comentarios: string;
}
