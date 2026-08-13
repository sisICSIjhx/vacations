import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseService } from './supabase.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const solicitud = contexto.switchToHttp().getRequest<Request>();
    const autorizacion = solicitud.headers.authorization;
    const token = autorizacion?.startsWith('Bearer ')
      ? autorizacion.slice(7).trim()
      : '';
    if (!token)
      throw new UnauthorizedException('Se requiere una sesión de Supabase.');

    const usuario = await this.supabase.obtenerUsuario(token);
    if (!usuario)
      throw new UnauthorizedException('La sesión es inválida o expiró.');

    const { data: perfil, error } = await this.supabase
      .administrador()
      .schema('vacaciones')
      .from('perfiles_usuario')
      .select('rol, activo')
      .eq('usuario_id', usuario.id)
      .maybeSingle();

    if (error || !perfil || !perfil.activo || perfil.rol !== 'administrador') {
      throw new ForbiddenException(
        'La operación requiere el rol administrador.',
      );
    }
    return true;
  }
}
