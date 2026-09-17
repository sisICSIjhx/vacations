import { IsBoolean, IsEmail, IsIn, IsOptional, IsUUID } from 'class-validator';

export const ROLES_VALIDOS = [
  'administrador',
  'rrhh',
  'mesa_directiva',
  'empleado',
] as const;

export class CrearAccesoDto {
  @IsUUID()
  empleadoId!: string;

  @IsEmail()
  correo!: string;

  @IsIn(ROLES_VALIDOS)
  rol!: (typeof ROLES_VALIDOS)[number];
}

export class ActualizarAccesoDto {
  @IsOptional()
  @IsIn(ROLES_VALIDOS)
  rol?: (typeof ROLES_VALIDOS)[number];

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsUUID()
  empleadoId?: string;
}
