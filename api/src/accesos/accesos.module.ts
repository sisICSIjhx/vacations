import { Module } from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import { SupabaseService } from '../common/supabase.service';
import { SesionGuard } from '../common/auth.guard';
import { AccesosController, CuentaController } from './accesos.controller';
import { AccesosService } from './accesos.service';

@Module({
  controllers: [AccesosController, CuentaController],
  providers: [AccesosService, SupabaseService, AuthGuard, SesionGuard],
})
export class AccesosModule {}
