import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { SupabaseClient, User } from '@supabase/supabase-js';
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

    let usuarioId: string;
    let contrasenaGenerada: string | null = contrasena;

    if (errorCreado || !creado?.user) {
      // Un correo "ya registrado" suele significar que la cuenta se creó antes
      // desde el panel de Supabase (el flujo manual que esta pantalla
      // reemplaza) sin llegar a crearle su fila en perfiles_usuario. En vez de
      // fallar, se busca esa cuenta y se vincula: no se toca su contraseña.
      const yaRegistrado = /already.*registered|already.*exists/i.test(
        errorCreado?.message ?? '',
      );
      if (!yaRegistrado) {
        throw new UnprocessableEntityException(
          errorCreado?.message ?? 'No fue posible crear el acceso.',
        );
      }
      const existente = await this.buscarUsuarioPorCorreo(admin, dto.correo);
      if (!existente) {
        throw new UnprocessableEntityException(
          'El correo ya está registrado en Supabase, pero no se pudo encontrar la cuenta para vincularla. Revisa Authentication > Users en Supabase.',
        );
      }
      usuarioId = existente.id;
      contrasenaGenerada = null;
    } else {
      usuarioId = creado.user.id;
    }

    // upsert (no insert): si por algún motivo ya existía una fila de perfil
    // para este usuario (p. ej. vinculada a otro empleado por error), se
    // corrige en vez de fallar por la llave primaria duplicada.
    const { error: errorPerfil } = await db.from('perfiles_usuario').upsert(
      {
        usuario_id: usuarioId,
        empleado_id: dto.empleadoId,
        nombre_visible: empleado.nombre_completo,
        rol: dto.rol,
        activo: true,
      },
      { onConflict: 'usuario_id' },
    );
    if (errorPerfil) {
      // Solo se limpia la cuenta si la creamos en esta misma llamada; una
      // cuenta preexistente que se intentó vincular no debe borrarse.
      if (contrasenaGenerada) await admin.auth.admin.deleteUser(usuarioId);
      throw new UnprocessableEntityException(errorPerfil.message);
    }

    return {
      usuarioId,
      correo: dto.correo,
      contrasena: contrasenaGenerada,
      rol: dto.rol,
    };
  }

  private generarContrasena(): string {
    return randomBytes(12).toString('base64url');
  }

  private async buscarUsuarioPorCorreo(
    admin: SupabaseClient,
    correo: string,
  ): Promise<User | null> {
    let pagina = 1;
    for (;;) {
      const { data, error } = await admin.auth.admin.listUsers({
        page: pagina,
        perPage: 200,
      });
      if (error || !data) return null;
      const encontrado = data.users.find(
        (usuario) => usuario.email?.toLowerCase() === correo.toLowerCase(),
      );
      if (encontrado) return encontrado;
      if (data.users.length < 200) return null;
      pagina += 1;
    }
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

  async restablecerContrasena(usuarioId: string) {
    const admin = this.supabase.administrador();
    const contrasena = this.generarContrasena();
    const { error } = await admin.auth.admin.updateUserById(usuarioId, {
      password: contrasena,
    });
    if (error) throw new UnprocessableEntityException(error.message);
    return { contrasena };
  }
}
