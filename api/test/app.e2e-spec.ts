import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('API ICSI Vacaciones (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const modulo: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication();
    await app.init();
  });

  it('/salud (GET)', () =>
    request(app.getHttpServer())
      .get('/salud')
      .expect(200)
      .expect((respuesta) => {
        const body = respuesta.body as unknown as { estado?: string };
        expect(body.estado).toBe('disponible');
      }));

  it('/importaciones/vacaciones exige autenticación', () =>
    request(app.getHttpServer()).post('/importaciones/vacaciones').expect(401));

  afterEach(async () => app.close());
});
