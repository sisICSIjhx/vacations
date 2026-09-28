import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseService } from './supabase.service';

export interface SesionSolicitud {
  usuarioId: string;
  correo: string | null;
  // Nivel de garantía de la sesión: 'aal2' solo tras verificar un factor MFA.
  aal: string;
}

export type SolicitudAutenticada = Request & { sesion?: SesionSolicitud };

// El JWT ya lo validó Supabase (getUser); aquí solo se lee el claim `aal`.
function nivelDeGarantia(token: string): string {
  try {
    const carga = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
    ) as { aal?: string };
    return carga.aal ?? 'aal1';
  } catch {
    return 'aal1';
  }
}

async function autenticar(
  supabase: SupabaseService,
  solicitud: SolicitudAutenticada,
) {
  const autorizacion = solicitud.headers.authorization;
  const token = autorizacion?.startsWith('Bearer ')
    ? autorizacion.slice(7).trim()
    : '';
  if (!token)
    throw new UnauthorizedException('Se requiere una sesión de Supabase.');

  const usuario = await supabase.obtenerUsuario(token);
  if (!usuario)
    throw new UnauthorizedException('La sesión es inválida o expiró.');

  const { data: perfil, error } = await supabase
    .administrador()
    .schema('vacaciones')
    .from('perfiles_usuario')
    .select('rol, activo')
    .eq('usuario_id', usuario.id)
    .maybeSingle();

  solicitud.sesion = {
    usuarioId: usuario.id,
    correo: usuario.email ?? null,
    aal: nivelDeGarantia(token),
  };
  return { perfil, error };
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const solicitud = contexto
      .switchToHttp()
      .getRequest<SolicitudAutenticada>();
    const { perfil, error } = await autenticar(this.supabase, solicitud);

    if (error || !perfil || !perfil.activo || perfil.rol !== 'administrador') {
      throw new ForbiddenException(
        'La operación requiere el rol administrador.',
      );
    }
    return true;
  }
}

// Cualquier usuario con sesión válida y perfil activo (no solo administradores).
@Injectable()
export class SesionGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const solicitud = contexto
      .switchToHttp()
      .getRequest<SolicitudAutenticada>();
    const { perfil, error } = await autenticar(this.supabase, solicitud);
    if (error || !perfil || !perfil.activo) {
      throw new ForbiddenException('Tu acceso no está activo.');
    }
    return true;
  }
}
