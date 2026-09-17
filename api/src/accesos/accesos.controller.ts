import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../common/auth.guard';
import { AccesosService } from './accesos.service';
import { ActualizarAccesoDto, CrearAccesoDto } from './dto';

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
}
