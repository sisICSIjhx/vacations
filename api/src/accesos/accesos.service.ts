import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { SupabaseService } from '../common/supabase.service';
import { ActualizarAccesoDto, CrearAccesoDto } from './dto';

interface FilaPerfil {
  usuario_id: string;
  empleado_id: string | null;
  nombre_visible: string;
  rol: string;
  activo: boolean;
}

@Injectable()
export class AccesosService {
  constructor(private readonly supabase: SupabaseService) {}

  async listar() {
    const admin = this.supabase.administrador();
    const db = admin.schema('vacaciones');

    const { data: perfiles, error } = await db
      .from('perfiles_usuario')
      .select('usuario_id, empleado_id, nombre_visible, rol, activo')
      .is('eliminado_en', null)
      .order('nombre_visible');
    if (error) throw new UnprocessableEntityException(error.message);

    // El correo vive en auth.users, no en perfiles_usuario: se cruza aquí para
    // poder identificar cuentas ya creadas (p. ej. desde el panel de Supabase)
    // y ofrecer vincularlas en vez de invitar un correo duplicado.
    const correoPorUsuario = new Map<string, string>();
    let pagina = 1;
    for (;;) {
      const { data: listado, error: errorListado } =
        await admin.auth.admin.listUsers({ page: pagina, perPage: 200 });
      if (errorListado || !listado) break;
      for (const usuario of listado.users) {
        if (usuario.email) correoPorUsuario.set(usuario.id, usuario.email);
      }
      if (listado.users.length < 200) break;
      pagina += 1;
    }

    return ((perfiles ?? []) as FilaPerfil[]).map((perfil) => ({
      usuarioId: perfil.usuario_id,
      empleadoId: perfil.empleado_id,
      nombreVisible: perfil.nombre_visible,
      rol: perfil.rol,
      activo: perfil.activo,
      correo: correoPorUsuario.get(perfil.usuario_id) ?? null,
    }));
  }

  async crear(dto: CrearAccesoDto) {
    const admin = this.supabase.administrador();
    const db = admin.schema('vacaciones');

    const { data: empleado, error: errorEmpleado } = await db
      .from('empleados')
      .select('id, nombre_completo')
      .eq('id', dto.empleadoId)
      .is('eliminado_en', null)
      .maybeSingle();
    if (errorEmpleado || !empleado) {
      throw new NotFoundException('El empleado no existe.');
    }

    const { data: existente } = await db
      .from('perfiles_usuario')
      .select('usuario_id')
      .eq('empleado_id', dto.empleadoId)
      .is('eliminado_en', null)
      .maybeSingle();
    if (existente) {
      throw new ConflictException(
        'Este empleado ya tiene acceso a la plataforma.',
      );
    }

    // No se envía invitación por correo: se crea la cuenta ya confirmada con
    // una contraseña temporal, y es el administrador quien la comparte con el
    // empleado por el medio que prefiera (no queda registrada en ningún lado
    // más que en esta respuesta, que solo se muestra una vez).
    const contrasena = this.generarContrasena();
    const { data: creado, error: errorCreado } =
      await admin.auth.admin.createUser({
        email: dto.correo,
        password: contrasena,
        email_confirm: true,
      });
    if (errorCreado || !creado?.user) {
      throw new UnprocessableEntityException(
        errorCreado?.message ??
          'No fue posible crear el acceso. Si el correo ya está registrado, vincula la cuenta existente en vez de crear una nueva.',
      );
    }

    const { error: errorPerfil } = await db.from('perfiles_usuario').insert({
      usuario_id: creado.user.id,
      empleado_id: dto.empleadoId,
      nombre_visible: empleado.nombre_completo,
      rol: dto.rol,
      activo: true,
    });
    if (errorPerfil) {
      await admin.auth.admin.deleteUser(creado.user.id);
      throw new UnprocessableEntityException(errorPerfil.message);
    }

    return {
      usuarioId: creado.user.id,
      correo: dto.correo,
      contrasena,
      rol: dto.rol,
    };
  }

  private generarContrasena(): string {
    return randomBytes(12).toString('base64url');
  }

  async actualizar(usuarioId: string, dto: ActualizarAccesoDto) {
    const db = this.supabase.administrador().schema('vacaciones');
    const cambios: Record<string, unknown> = {};
    if (dto.rol) cambios.rol = dto.rol;
    if (dto.activo !== undefined) cambios.activo = dto.activo;
    if (dto.empleadoId) cambios.empleado_id = dto.empleadoId;
    if (!Object.keys(cambios).length) return { actualizado: false };

    const { error } = await db
      .from('perfiles_usuario')
      .update(cambios)
      .eq('usuario_id', usuarioId);
    if (error) throw new UnprocessableEntityException(error.message);
    return { actualizado: true };
  }
}
