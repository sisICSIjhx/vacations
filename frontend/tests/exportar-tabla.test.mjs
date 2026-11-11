import assert from 'node:assert/strict';
import test from 'node:test';
import { construirXlsx, crc32, letraColumna } from '../app/lib/exportarTabla.ts';

// Lee las entradas de un ZIP sin compresión a partir de su directorio central.
function leerZip(zip) {
  const vista = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const fin = zip.byteLength - 22;
  assert.equal(vista.getUint32(fin, true), 0x06054b50, 'falta el fin del directorio central');
  const total = vista.getUint16(fin + 10, true);
  let posicion = vista.getUint32(fin + 16, true);
  const entradas = new Map();
  for (let i = 0; i < total; i++) {
    assert.equal(vista.getUint32(posicion, true), 0x02014b50);
    const crc = vista.getUint32(posicion + 16, true);
    const tamano = vista.getUint32(posicion + 24, true);
    const largoNombre = vista.getUint16(posicion + 28, true);
    const local = vista.getUint32(posicion + 42, true);
    const nombre = new TextDecoder().decode(zip.subarray(posicion + 46, posicion + 46 + largoNombre));
    assert.equal(vista.getUint32(local, true), 0x04034b50);
    const inicio = local + 30 + vista.getUint16(local + 26, true) + vista.getUint16(local + 28, true);
    const datos = zip.subarray(inicio, inicio + tamano);
    assert.equal(crc32(datos), crc, `CRC incorrecto en ${nombre}`);
    entradas.set(nombre, new TextDecoder().decode(datos));
    posicion += 46 + largoNombre;
  }
  return entradas;
}

test('crc32 coincide con el valor de referencia', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('letras de columna estilo Excel', () => {
  assert.deepEqual([0, 25, 26, 27, 51, 52, 701, 702].map(letraColumna), ['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
});

test('genera un .xlsx válido con encabezados, números, acentos y texto escapado', () => {
  const zip = construirXlsx({
    titulo: 'Personal 2026',
    encabezados: ['Número', 'Nombre', 'Disponibles'],
    filas: [['E-001', 'Peña & <Núñez>', 12.5], ['E-002', null, 0]],
  });
  const entradas = leerZip(zip);
  assert.deepEqual([...entradas.keys()].sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
  const hoja = entradas.get('xl/worksheets/sheet1.xml');
  assert.match(hoja, /<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Número<\/t>/);
  assert.match(hoja, /Peña &amp; &lt;Núñez&gt;/);
  assert.match(hoja, /<c r="C2"><v>12.5<\/v><\/c>/);
  assert.match(hoja, /<c r="C3"><v>0<\/v><\/c>/);
  assert.match(hoja, /<autoFilter ref="A1:C3"\/>/);
  assert.match(entradas.get('xl/workbook.xml'), /<sheet name="Personal 2026"/);
});
