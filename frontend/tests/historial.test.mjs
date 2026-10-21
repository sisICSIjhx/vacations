import test from 'node:test';
import assert from 'node:assert/strict';
import { historialSolicitudExistente, cambiosDemo, puedeVerEvento, filtrarHistorial, TAMANO_PAGINA, valorLegible, detalleActividad } from '../app/lib/historial.ts';

const solicitud = { id: 's1', empleadoId: 'e1', nombreEmpleado: 'Persona de prueba', fechaInicio: '2026-10-20', fechaFin: '2026-10-22', fechaSolicitud: '2026-09-01T12:00:00Z', estado: 'aprobada', dias: 3 };
const datos = { empleados: [{ id: 'e1', nombre: 'Persona de prueba', jefeInmediatoId: 'j1' }], solicitudes: [solicitud], ediciones: [], sedes: [], proyectos: [], categorias: [], tiposAusencia: [], diasFestivos: [] };
test('aprobación recuperada muestra datos de la decisión sin comparaciones ficticias ni campos vacíos', () => {
  const detalle = detalleActividad({ accion: 'aprobacion', anteriores: {}, nuevos: { etapa: 'rrhh', decision: 'aprobado', comentario: null, estado_resultante: 'jefe_inmediato' }, recuperado: true });
  assert.equal(detalle.titulo, 'Datos de la aprobación');
  assert.equal(detalle.campos.length, 3);
  assert.ok(detalle.campos.every(campo => campo.anterior === undefined));
  assert.equal(detalle.campos.find(campo => campo.clave === 'estado_resultante').valor, 'Pendiente de revisión por Jefe inmediato');
  assert.doesNotMatch(JSON.stringify(detalle), /Sin dato/);
});
test('una modificación con evidencia distingue vacío conocido de valor anterior desconocido', () => {
  const detalle = detalleActividad({ accion: 'actualizacion', anteriores: { nombre: 'Anterior', correo: null, estado: 'activo' }, nuevos: { nombre: 'Nuevo', correo: 'prueba@example.test', estado: 'activo', sede: 'Sede asignada' } });
  assert.equal(detalle.titulo, 'Qué cambió');
  assert.equal(detalle.campos.find(campo => campo.clave === 'nombre').anterior, 'Anterior');
  assert.equal(detalle.campos.find(campo => campo.clave === 'correo').anterior, 'Sin asignar');
  assert.equal(detalle.campos.find(campo => campo.clave === 'sede').anterior, undefined);
  assert.equal(detalle.campos.find(campo => campo.clave === 'estado'), undefined);
});
test('la edición aplicada compara sus periodos y evita repetir el motivo del encabezado', () => {
  const detalle = detalleActividad({ accion: 'edicion_aplicada', motivo: 'Cambio solicitado', anteriores: {}, nuevos: { respuesta: 'Cambio solicitado', valores_anteriores: { fecha_inicio: '2026-10-19', fecha_fin: '2026-10-23' }, valores_nuevos: { fecha_inicio: '2026-10-26', fecha_fin: '2026-10-30' } } });
  assert.equal(detalle.titulo, 'Qué cambió');
  assert.deepEqual(detalle.campos.map(campo => [campo.etiqueta, campo.anterior, campo.valor]), [['Inicio', '19/10/2026', '26/10/2026'], ['Fin', '23/10/2026', '30/10/2026']]);
});
test('una actualización histórica sin valor anterior lo explica sin inventar una comparación', () => {
  const detalle = detalleActividad({ accion: 'actualizacion', anteriores: {}, nuevos: { estado: 'pendiente' }, recuperado: true });
  assert.match(detalle.nota, /no un valor anterior/);
  assert.equal(detalle.campos[0].anterior, undefined);
});
test('una cancelación conserva aprobación, autor, motivo y orden cronológico', () => {
  const eventos = historialSolicitudExistente({ ...solicitud, estado: 'cancelada', cancelacion: { motivo: 'Cambio de fechas', canceladoPor: 'Administradora de prueba', canceladoEn: '2026-10-15T18:00:00Z' } }, [{ id: 'r1', creadoEn: '2026-09-05T12:00:00Z', etapa: 'mesa_directiva', decision: 'aprobado', nombreRevisor: 'Revisor de prueba' }], []);
  assert.deepEqual(eventos.map(e => e.accion), ['cancelacion','aprobacion','creacion']);
  assert.equal(eventos[0].actor, 'Administradora de prueba');
  assert.equal(eventos[0].motivo, 'Cambio de fechas');
});
test('cancelación antigua sin datos no inventa autor o fecha', () => {
  const evento = historialSolicitudExistente({ ...solicitud, estado: 'cancelada' }, [], []).find(e => e.accion === 'cancelacion');
  assert.equal(evento.actor, 'Autor no registrado');
  assert.equal(evento.ocurridoEn, '');
});
test('demo registra eliminación sin perder la evidencia ni copiar identificadores sensibles', () => {
  const base = { ...datos, empleados: [{ ...datos.empleados[0], curp: 'NO-COPIAR', nss: 'NO-COPIAR' }] };
  const eventos = cambiosDemo(base, { ...base, empleados: [] }, 'Autora verificada', '2026-10-15T18:00:00Z');
  assert.equal(eventos[0].accion, 'eliminacion');
  assert.equal(eventos[0].actor, 'Autora verificada');
  assert.doesNotMatch(JSON.stringify(eventos), /NO-COPIAR/);
});
test('permisos de demo separan acceso propio, jefatura, Mesa, RRHH y administración', () => {
  const evento = { modulo: 'solicitudes', empleadoId: 'e1' };
  const perfil = { activo: true, rol: 'empleado', empleadoId: 'otro', esJefeInmediato: false };
  assert.equal(puedeVerEvento(evento, perfil, datos), false);
  assert.equal(puedeVerEvento(evento, { ...perfil, empleadoId: 'e1' }, datos), true);
  assert.equal(puedeVerEvento(evento, { ...perfil, empleadoId: 'j1', esJefeInmediato: true }, datos), true);
  assert.equal(puedeVerEvento({ ...evento, modulo: 'accesos' }, { ...perfil, rol: 'rrhh' }, datos), false);
  assert.equal(puedeVerEvento({ ...evento, modulo: 'personal' }, { ...perfil, rol: 'mesa_directiva' }, datos), false);
  assert.equal(puedeVerEvento(evento, { ...perfil, activo: false, rol: 'administrador' }, datos), false);
});
test('filtros preceden paginación y respetan el día de Ciudad de México', () => {
  const base = { anteriores: { estado: 'aprobada' }, nuevos: {}, actor: 'Persona', sujeto: 'Solicitud', accion: 'cancelacion', modulo: 'solicitudes', ocurridoEn: '2026-10-16T02:00:00Z' };
  const eventos = Array.from({ length: TAMANO_PAGINA + 2 }, (_,i) => ({ ...base, id: String(i) }));
  const primera = filtrarHistorial(eventos, { texto: 'cancelados', desde: '2026-10-15', hasta: '2026-10-15' });
  assert.equal(primera.eventos.length, TAMANO_PAGINA);
  assert.equal(primera.hayMas, true);
  assert.equal(filtrarHistorial(eventos, { pagina: 1 }).eventos.length, 2);
  assert.equal(filtrarHistorial(eventos, { desde: '2026-10-16' }).eventos.length, 0);
  assert.equal(valorLegible({ fecha_inicio: '2026-10-15' }), 'Inicio: 15/10/2026');
});
