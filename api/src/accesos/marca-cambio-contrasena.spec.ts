import type { ConfigService } from '@nestjs/config';
import type { SupabaseService } from '../common/supabase.service';
import { AccesosService } from './accesos.service';

// Cliente de Supabase mínimo para `listar` y `actualizar`.
function crearServicio(metadatos: Record<string, Record<string, unknown>>) {
  const perfiles = Object.keys(metadatos).map((id) => ({
    usuario_id: id,
    empleado_id: null,
    nombre_visible: id,
    rol: 'empleado',
    activo: true,
  }));
  const consulta = {
    select: () => consulta,
    is: () => consulta,
    order: () => Promise.resolve({ data: perfiles, error: null }),
  };
  const updateUserById = jest.fn().mockResolvedValue({ error: null });
  const rpc = jest.fn().mockResolvedValue({ error: null });
  const cliente = {
    schema: () => ({ from: () => consulta, rpc }),
    auth: {
      admin: {
        listUsers: () =>
          Promise.resolve({
            data: {
              users: Object.entries(metadatos).map(([id, app_metadata]) => ({
                id,
                email: `${id}@example.test`,
                app_metadata,
              })),
            },
            error: null,
          }),
        updateUserById,
      },
    },
  };
  const supabase = { administrador: () => cliente };
  const servicio = new AccesosService(
    supabase as unknown as SupabaseService,
    {} as ConfigService,
  );
  return { servicio, updateUserById, rpc };
}

describe('Marca de cambio obligatorio de contraseña', () => {
  it('el listado informa qué cuentas deben cambiar su contraseña', async () => {
    const { servicio } = crearServicio({
      pendiente: { debe_cambiar_contrasena: true },
      quitada: {
        debe_cambiar_contrasena: false,
        puede_cambiar_contrasena: true,
      },
      sinMarca: {},
    });
    const accesos = await servicio.listar();
    expect(
      Object.fromEntries(
        accesos.map((a) => [a.usuarioId, a.debeCambiarContrasena]),
      ),
    ).toEqual({ pendiente: true, quitada: false, sinMarca: false });
  });

  it('el administrador puede quitar la marca sin cambiar la contraseña', async () => {
    const { servicio, updateUserById, rpc } = crearServicio({
      pendiente: { debe_cambiar_contrasena: true },
    });
    await servicio.actualizar(
      'pendiente',
      { forzarCambioContrasena: false },
      'admin',
    );
    expect(updateUserById).toHaveBeenCalledWith('pendiente', {
      app_metadata: { debe_cambiar_contrasena: false },
    });
    expect(rpc).toHaveBeenCalledWith('registrar_cambio_acceso', {
      p_usuario: 'pendiente',
      p_accion: 'acceso_actualizado',
      p_cambios: { forzarCambioContrasena: false },
    });
  });
});
