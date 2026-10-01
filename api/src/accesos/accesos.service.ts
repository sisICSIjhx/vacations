import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { ConfigService } from '@nestjs/config';
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
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

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
    const puedeCambiar = new Set<string>();
    let pagina = 1;
    for (;;) {
      const { data: listado, error: errorListado } =
        await admin.auth.admin.listUsers({ page: pagina, perPage: 200 });
      if (errorListado || !listado) break;
      for (const usuario of listado.users) {
        if (usuario.email) correoPorUsuario.set(usuario.id, usuario.email);
        if (usuario.app_metadata?.puede_cambiar_contrasena === true) {
          puedeCambiar.add(usuario.id);
        }
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
      puedeCambiarContrasena: puedeCambiar.has(perfil.usuario_id),
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
    // una contraseña temporal y es el administrador quien la comparte con el
    // empleado. Queda guardada cifrada para poder consultarla con MFA.
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
      if (dto.permitirCambioContrasena !== undefined) {
        await admin.auth.admin.updateUserById(usuarioId, {
          app_metadata: {
            puede_cambiar_contrasena: dto.permitirCambioContrasena,
          },
        });
      }
    } else {
      usuarioId = creado.user.id;
      await this.guardarContrasena(admin, usuarioId, contrasena, {
        permitirCambio: dto.permitirCambioContrasena ?? false,
        forzarCambio: dto.forzarCambioContrasena ?? false,
      });
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

    if (dto.correo) await this.cambiarCorreo(usuarioId, dto.correo);

    const meta: Record<string, boolean> = {};
    if (dto.permitirCambioContrasena !== undefined) {
      meta.puede_cambiar_contrasena = dto.permitirCambioContrasena;
    }
    if (dto.forzarCambioContrasena !== undefined) {
      meta.debe_cambiar_contrasena = dto.forzarCambioContrasena;
    }
    if (Object.keys(meta).length) {
      const { error: errorMeta } = await this.supabase
        .administrador()
        .auth.admin.updateUserById(usuarioId, { app_metadata: meta });
      if (errorMeta) throw new UnprocessableEntityException(errorMeta.message);
    }
    if (!Object.keys(cambios).length) {
      return { actualizado: Object.keys(meta).length > 0 || !!dto.correo };
    }

    const { error } = await db
      .from('perfiles_usuario')
      .update(cambios)
      .eq('usuario_id', usuarioId);
    if (error) throw new UnprocessableEntityException(error.message);
    return { actualizado: true };
  }

  // Cambia el correo de inicio de sesión sin enviar confirmación: el
  // administrador ya lo validó. La contraseña no cambia. Si el correo de
  // avisos del empleado era el mismo, se actualiza también.
  private async cambiarCorreo(usuarioId: string, correoNuevo: string) {
    const admin = this.supabase.administrador();
    const correo = correoNuevo.trim().toLowerCase();

    const { data: actual, error: errorActual } =
      await admin.auth.admin.getUserById(usuarioId);
    if (errorActual || !actual.user) {
      throw new NotFoundException('El usuario no existe.');
    }
    const correoAnterior = actual.user.email?.toLowerCase() ?? null;
    if (correoAnterior === correo) return;

    const otro = await this.buscarUsuarioPorCorreo(admin, correo);
    if (otro && otro.id !== usuarioId) {
      throw new ConflictException(
        'Ese correo ya lo usa otra cuenta de la plataforma.',
      );
    }

    const { error } = await admin.auth.admin.updateUserById(usuarioId, {
      email: correo,
      email_confirm: true,
    });
    if (error) throw new UnprocessableEntityException(error.message);

    if (correoAnterior) {
      const db = admin.schema('vacaciones');
      const { data: perfil } = await db
        .from('perfiles_usuario')
        .select('empleado_id')
        .eq('usuario_id', usuarioId)
        .maybeSingle();
      if (perfil?.empleado_id) {
        await db
          .from('empleados')
          .update({ correo_electronico: correo })
          .eq('id', perfil.empleado_id)
          .ilike('correo_electronico', correoAnterior);
      }
    }
  }

  async restablecerContrasena(
    usuarioId: string,
    permitirCambio?: boolean,
    forzarCambio?: boolean,
  ) {
    const admin = this.supabase.administrador();
    const contrasena = this.generarContrasena();
    const { error } = await admin.auth.admin.updateUserById(usuarioId, {
      password: contrasena,
    });
    if (error) throw new UnprocessableEntityException(error.message);
    await this.guardarContrasena(admin, usuarioId, contrasena, {
      permitirCambio,
      forzarCambio: forzarCambio ?? false,
    });
    return { contrasena };
  }

  async cambiarContrasenaPropia(
    usuarioId: string,
    correo: string | null,
    contrasenaActual: string,
    contrasenaNueva: string,
  ) {
    const admin = this.supabase.administrador();
    const { data, error } = await admin.auth.admin.getUserById(usuarioId);
    if (error || !data.user)
      throw new NotFoundException('El usuario no existe.');
    // Con «cambio obligatorio» activo el usuario puede cambiarla aunque el
    // permiso general esté apagado: es justo lo que se le está pidiendo.
    if (
      data.user.app_metadata?.puede_cambiar_contrasena !== true &&
      data.user.app_metadata?.debe_cambiar_contrasena !== true
    ) {
      throw new ForbiddenException(
        'El administrador no habilitó el cambio de contraseña para tu cuenta.',
      );
    }
    if (
      !correo ||
      !(await this.supabase.verificarContrasena(correo, contrasenaActual))
    ) {
      throw new UnprocessableEntityException(
        'La contraseña actual no es correcta.',
      );
    }
    const { error: errorCambio } = await admin.auth.admin.updateUserById(
      usuarioId,
      { password: contrasenaNueva },
    );
    if (errorCambio)
      throw new UnprocessableEntityException(errorCambio.message);
    // Se conserva cifrada para que el administrador pueda consultarla con MFA.
    await this.guardarContrasena(admin, usuarioId, contrasenaNueva, {
      forzarCambio: false,
    });
    return { actualizado: true };
  }

  async verContrasena(usuarioId: string) {
    const { data, error } = await this.supabase
      .administrador()
      .auth.admin.getUserById(usuarioId);
    if (error || !data.user) {
      throw new NotFoundException('El usuario no existe.');
    }
    const cifrada = data.user.app_metadata?.contrasena_cifrada as
      string | undefined;
    if (!cifrada) return { contrasena: null };
    try {
      return { contrasena: this.descifrar(cifrada) };
    } catch {
      return { contrasena: null };
    }
  }

  // Supabase solo guarda un hash de la contraseña, así que no se puede leer.
  // Para que el administrador pueda consultarla se conserva, cifrada, la
  // contraseña generada por el sistema en app_metadata (solo editable con la
  // clave secreta). Si el usuario la cambia por su cuenta, deja de coincidir.
  private async guardarContrasena(
    admin: SupabaseClient,
    usuarioId: string,
    contrasena: string,
    opciones: { permitirCambio?: boolean; forzarCambio?: boolean } = {},
  ) {
    const { error } = await admin.auth.admin.updateUserById(usuarioId, {
      app_metadata: {
        contrasena_cifrada: this.cifrar(contrasena),
        ...(opciones.permitirCambio === undefined
          ? {}
          : { puede_cambiar_contrasena: opciones.permitirCambio }),
        ...(opciones.forzarCambio === undefined
          ? {}
          : { debe_cambiar_contrasena: opciones.forzarCambio }),
      },
    });
    if (error) throw new UnprocessableEntityException(error.message);
  }

  private clave(): Buffer {
    const semilla =
      this.config.get<string>('CREDENCIALES_CLAVE') ??
      this.config.get<string>('SUPABASE_SECRET_KEY') ??
      '';
    return createHash('sha256').update(semilla).digest();
  }

  private cifrar(texto: string): string {
    const iv = randomBytes(12);
    const cifrador = createCipheriv('aes-256-gcm', this.clave(), iv);
    const datos = Buffer.concat([
      cifrador.update(texto, 'utf8'),
      cifrador.final(),
    ]);
    return [iv, cifrador.getAuthTag(), datos]
      .map((parte) => parte.toString('base64url'))
      .join('.');
  }

  private descifrar(valor: string): string {
    const [iv, etiqueta, datos] = valor
      .split('.')
      .map((parte) => Buffer.from(parte, 'base64url'));
    const descifrador = createDecipheriv('aes-256-gcm', this.clave(), iv);
    descifrador.setAuthTag(etiqueta);
    return Buffer.concat([
      descifrador.update(datos),
      descifrador.final(),
    ]).toString('utf8');
  }
}
