import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthGuard,
  SesionGuard,
  type SolicitudAutenticada,
} from '../common/auth.guard';
import { AccesosService } from './accesos.service';
import {
  ActualizarAccesoDto,
  CambiarContrasenaDto,
  CrearAccesoDto,
  RestablecerContrasenaDto,
} from './dto';

@ApiTags('accesos')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('accesos')
export class AccesosController {
  constructor(private readonly accesos: AccesosService) {}

  @Get()
  @ApiOperation({ summary: 'Lista los accesos a la plataforma' })
  listar() {
    return this.accesos.listar();
  }

  @Post()
  @ApiOperation({
    summary: 'Crea el acceso de un empleado (invitación de Supabase Auth)',
  })
  crear(@Body() dto: CrearAccesoDto) {
    return this.accesos.crear(dto);
  }

  @Patch(':usuarioId')
  @ApiOperation({
    summary: 'Actualiza rol, estado o vínculo con empleado de un acceso',
  })
  actualizar(
    @Param('usuarioId') usuarioId: string,
    @Body() dto: ActualizarAccesoDto,
  ) {
    return this.accesos.actualizar(usuarioId, dto);
  }

  @Get(':usuarioId/contrasena')
  @ApiOperation({
    summary:
      'Consulta la contraseña guardada; exige una sesión verificada con MFA',
  })
  verContrasena(
    @Param('usuarioId') usuarioId: string,
    @Req() solicitud: SolicitudAutenticada,
  ) {
    if (solicitud.sesion?.aal !== 'aal2') {
      throw new ForbiddenException({
        message: 'Verifica tu código de autenticación para ver contraseñas.',
        codigo: 'MFA_REQUERIDO',
      });
    }
    return this.accesos.verContrasena(usuarioId);
  }

  @Post(':usuarioId/restablecer-contrasena')
  @ApiOperation({
    summary: 'Genera una nueva contraseña temporal para un acceso existente',
  })
  restablecerContrasena(
    @Param('usuarioId') usuarioId: string,
    @Body() dto: RestablecerContrasenaDto,
  ) {
    return this.accesos.restablecerContrasena(usuarioId, dto.permitirCambio);
  }
}

@ApiTags('cuenta')
@ApiBearerAuth()
@UseGuards(SesionGuard)
@Controller('cuenta')
export class CuentaController {
  constructor(private readonly accesos: AccesosService) {}

  @Post('contrasena')
  @ApiOperation({
    summary:
      'El usuario cambia su propia contraseña (si el administrador lo permitió)',
  })
  cambiarContrasena(
    @Body() dto: CambiarContrasenaDto,
    @Req() solicitud: SolicitudAutenticada,
  ) {
    const sesion = solicitud.sesion!;
    return this.accesos.cambiarContrasenaPropia(
      sesion.usuarioId,
      sesion.correo,
      dto.contrasenaActual,
      dto.contrasenaNueva,
    );
  }
}
