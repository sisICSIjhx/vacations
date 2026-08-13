import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const origenes = config
    .get<string>('FRONTEND_URLS', 'http://localhost:3000')
    .split(',')
    .map((origen) => origen.trim())
    .filter(Boolean);

  app.enableCors({ origin: origenes, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  const documento = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('ICSI Vacaciones API')
      .setDescription(
        'Operaciones administrativas que no deben ejecutarse desde el navegador.',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('documentacion', app, documento);

  await app.listen(config.get<number>('PORT', 3001), '0.0.0.0');
}

void bootstrap();
