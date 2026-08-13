import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let controlador: AppController;

  beforeEach(async () => {
    const modulo: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();
    controlador = modulo.get<AppController>(AppController);
  });

  it('informa que la API está disponible', () => {
    const respuesta = controlador.obtenerSalud();
    expect(respuesta.estado).toBe('disponible');
    expect(respuesta.servicio).toBe('icsi-vacaciones-api');
    expect(Date.parse(respuesta.fecha)).not.toBeNaN();
  });
});
