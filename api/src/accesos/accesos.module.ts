import { Module } from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import { SupabaseService } from '../common/supabase.service';
import { AccesosController } from './accesos.controller';
import { AccesosService } from './accesos.service';

@Module({
  controllers: [AccesosController],
  providers: [AccesosService, SupabaseService, AuthGuard],
})
export class AccesosModule {}
