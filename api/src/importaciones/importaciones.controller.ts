import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Express } from 'express';
import { AuthGuard } from '../common/auth.guard';
import { ImportacionesService } from './importaciones.service';

@ApiTags('importaciones')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('importaciones')
export class ImportacionesController {
  constructor(private readonly importaciones: ImportacionesService) {}

  @Post('vacaciones')
  @UseInterceptors(
    FileInterceptor('archivo', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['archivo'],
      properties: { archivo: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Valida e importa el CSV histórico de vacaciones' })
  importarVacaciones(@UploadedFile() archivo?: Express.Multer.File) {
    if (!archivo)
      throw new BadRequestException(
        'Adjunta un archivo en el campo "archivo".',
      );
    if (!archivo.originalname.toLowerCase().endsWith('.csv')) {
      throw new BadRequestException('El archivo debe tener extensión .csv.');
    }
    return this.importaciones.importar(archivo);
  }
}
