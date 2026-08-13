import { Module } from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import { SupabaseService } from '../common/supabase.service';
import { ImportacionesController } from './importaciones.controller';
import { ImportacionesService } from './importaciones.service';

@Module({
  controllers: [ImportacionesController],
  providers: [ImportacionesService, SupabaseService, AuthGuard],
})
export class ImportacionesModule {}
