import { AccesosController } from './accesos.controller';
import { AccesosService } from './accesos.service';
import type { SolicitudAutenticada } from '../common/auth.guard';
import { ImportacionesController } from '../importaciones/importaciones.controller';
import { ImportacionesService } from '../importaciones/importaciones.service';

describe('Autor del historial desde la sesión verificada', () => {
  const solicitud = {
    sesion: { usuarioId: 'actor-verificado' },
  } as SolicitudAutenticada;
  it('propaga el actor en crear, actualizar y restablecer accesos', () => {
    const servicio = {
      crear: jest.fn(),
      actualizar: jest.fn(),
      restablecerContrasena: jest.fn(),
    };
    const controlador = new AccesosController(
      servicio as unknown as AccesosService,
    );
    const alta = {
      empleadoId: 'empleado',
      correo: 'prueba@example.test',
      rol: 'empleado' as const,
    };
    void controlador.crear(alta, solicitud);
    void controlador.actualizar('destino', { activo: false }, solicitud);
    void controlador.restablecerContrasena(
      'destino',
      { permitirCambio: true },
      solicitud,
    );
    expect(servicio.crear).toHaveBeenCalledWith(alta, 'actor-verificado');
    expect(servicio.actualizar).toHaveBeenCalledWith(
      'destino',
      { activo: false },
      'actor-verificado',
    );
    expect(servicio.restablecerContrasena).toHaveBeenCalledWith(
      'destino',
      true,
      undefined,
      'actor-verificado',
    );
  });
  it('identifica al usuario que realiza una importación', () => {
    const servicio = { importar: jest.fn() };
    const controlador = new ImportacionesController(
      servicio as unknown as ImportacionesService,
    );
    const archivo = { originalname: 'prueba.csv' } as Express.Multer.File;
    void controlador.importarVacaciones(solicitud, archivo);
    expect(servicio.importar).toHaveBeenCalledWith(archivo, 'actor-verificado');
  });
});
