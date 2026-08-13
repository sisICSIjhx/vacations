import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AuthGuard } from './common/auth.guard';
import { SupabaseService } from './common/supabase.service';
import { ImportacionesModule } from './importaciones/importaciones.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ImportacionesModule],
  controllers: [AppController],
  providers: [SupabaseService, AuthGuard],
  exports: [SupabaseService, AuthGuard],
})
export class AppModule {}
