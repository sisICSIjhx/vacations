import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('sistema')
@Controller()
export class AppController {
  @Get('salud')
  @ApiOperation({ summary: 'Confirma que la API está disponible' })
  obtenerSalud() {
    return {
      estado: 'disponible',
      servicio: 'icsi-vacaciones-api',
      fecha: new Date().toISOString(),
    };
  }
}
