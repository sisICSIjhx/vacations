// Exportación de tablas a Excel (.xlsx) y PDF desde el navegador.
// El .xlsx se arma aquí mismo (Office Open XML dentro de un ZIP sin
// compresión) para no depender de librerías de hojas de cálculo; el PDF usa
// jsPDF + jspdf-autotable cargados bajo demanda para no engordar la carga
// inicial de la aplicación.

export type ValorCelda = string | number | null | undefined;

export interface TablaExportable {
  // Nombre de la hoja de Excel y título del PDF.
  titulo: string;
  // Línea secundaria del PDF (año, filtros aplicados, fecha de generación…).
  subtitulo?: string;
  encabezados: string[];
  filas: ValorCelda[][];
}

const codificador = new TextEncoder();

function escaparXml(texto: string) {
  return texto
    // Caracteres de control no permitidos en XML 1.0 (salvo tab y saltos de línea).
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function letraColumna(indice: number) {
  let letra = "";
  for (let n = indice + 1; n > 0; n = Math.floor((n - 1) / 26)) letra = String.fromCharCode(65 + ((n - 1) % 26)) + letra;
  return letra;
}

// Nombre de hoja válido para Excel: máximo 31 caracteres y sin : \ / ? * [ ].
function nombreHoja(titulo: string) {
  return titulo.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "Hoja1";
}

function celda(valor: ValorCelda, referencia: string, estilo?: number) {
  const s = estilo ? ` s="${estilo}"` : "";
  if (typeof valor === "number" && Number.isFinite(valor)) return `<c r="${referencia}"${s}><v>${valor}</v></c>`;
  const texto = valor === null || valor === undefined ? "" : String(valor);
  return `<c r="${referencia}"${s} t="inlineStr"><is><t xml:space="preserve">${escaparXml(texto)}</t></is></c>`;
}

function hojaXml({ encabezados, filas }: TablaExportable) {
  const ultimaColumna = letraColumna(Math.max(encabezados.length - 1, 0));
  const rango = `A1:${ultimaColumna}${filas.length + 1}`;
  // Ancho aproximado por columna según el texto más largo (con límites razonables).
  const anchos = encabezados.map((encabezado, indice) => {
    const largo = Math.max(encabezado.length, ...filas.map((fila) => String(fila[indice] ?? "").length));
    return Math.min(Math.max(largo + 2, 8), 48);
  });
  const columnas = anchos.map((ancho, indice) => `<col min="${indice + 1}" max="${indice + 1}" width="${ancho}" customWidth="1"/>`).join("");
  const filaEncabezado = `<row r="1">${encabezados.map((texto, indice) => celda(texto, `${letraColumna(indice)}1`, 1)).join("")}</row>`;
  const filasDatos = filas.map((fila, numero) => {
    const r = numero + 2;
    return `<row r="${r}">${encabezados.map((_, indice) => celda(fila[indice], `${letraColumna(indice)}${r}`)).join("")}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `<cols>${columnas}</cols>`
    + `<sheetData>${filaEncabezado}${filasDatos}</sheetData>`
    + `<autoFilter ref="${rango}"/>`
    + `</worksheet>`;
}

const ESTILOS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
  + `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>`
  + `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF163A5F"/><bgColor indexed="64"/></patternFill></fill></fills>`
  + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
  + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
  + `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>`
  + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`
  + `</styleSheet>`;

function archivosXlsx(tabla: TablaExportable): [string, string][] {
  const hoja = escaparXml(nombreHoja(tabla.titulo));
  const ultimaColumna = letraColumna(Math.max(tabla.encabezados.length - 1, 0));
  return [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${hoja}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${hoja.replace(/'/g, "''")}'!$A$1:$${ultimaColumna}$${tabla.filas.length + 1}</definedName></definedNames></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/worksheets/sheet1.xml", hojaXml(tabla)],
    ["xl/styles.xml", ESTILOS_XML],
  ];
}

const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c >>> 0;
  }
  return tabla;
})();

export function crc32(datos: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of datos) crc = TABLA_CRC[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ZIP con entradas almacenadas (sin compresión): suficiente para un .xlsx
// pequeño y compatible con Excel, LibreOffice y Google Sheets.
export function crearZip(archivos: [string, string | Uint8Array][], fecha = new Date()) {
  const horaDos = (fecha.getHours() << 11) | (fecha.getMinutes() << 5) | Math.floor(fecha.getSeconds() / 2);
  const fechaDos = ((Math.max(fecha.getFullYear(), 1980) - 1980) << 9) | ((fecha.getMonth() + 1) << 5) | fecha.getDate();
  const locales: Uint8Array[] = [];
  const centrales: Uint8Array[] = [];
  let desplazamiento = 0;
  for (const [nombre, contenido] of archivos) {
    const nombreBytes = codificador.encode(nombre);
    const datos = typeof contenido === "string" ? codificador.encode(contenido) : contenido;
    const crc = crc32(datos);
    const local = new Uint8Array(30 + nombreBytes.length + datos.length);
    const vl = new DataView(local.buffer);
    vl.setUint32(0, 0x04034b50, true);
    vl.setUint16(4, 20, true);
    vl.setUint16(6, 0x0800, true); // nombres en UTF-8
    vl.setUint16(8, 0, true); // sin compresión
    vl.setUint16(10, horaDos, true);
    vl.setUint16(12, fechaDos, true);
    vl.setUint32(14, crc, true);
    vl.setUint32(18, datos.length, true);
    vl.setUint32(22, datos.length, true);
    vl.setUint16(26, nombreBytes.length, true);
    vl.setUint16(28, 0, true);
    local.set(nombreBytes, 30);
    local.set(datos, 30 + nombreBytes.length);
    locales.push(local);

    const central = new Uint8Array(46 + nombreBytes.length);
    const vc = new DataView(central.buffer);
    vc.setUint32(0, 0x02014b50, true);
    vc.setUint16(4, 20, true);
    vc.setUint16(6, 20, true);
    vc.setUint16(8, 0x0800, true);
    vc.setUint16(10, 0, true);
    vc.setUint16(12, horaDos, true);
    vc.setUint16(14, fechaDos, true);
    vc.setUint32(16, crc, true);
    vc.setUint32(20, datos.length, true);
    vc.setUint32(24, datos.length, true);
    vc.setUint16(28, nombreBytes.length, true);
    vc.setUint32(42, desplazamiento, true);
    central.set(nombreBytes, 46);
    centrales.push(central);
    desplazamiento += local.length;
  }
  const tamanoCentral = centrales.reduce((total, parte) => total + parte.length, 0);
  const fin = new Uint8Array(22);
  const vf = new DataView(fin.buffer);
  vf.setUint32(0, 0x06054b50, true);
  vf.setUint16(8, archivos.length, true);
  vf.setUint16(10, archivos.length, true);
  vf.setUint32(12, tamanoCentral, true);
  vf.setUint32(16, desplazamiento, true);
  const partes = [...locales, ...centrales, fin];
  const zip = new Uint8Array(partes.reduce((total, parte) => total + parte.length, 0));
  let posicion = 0;
  for (const parte of partes) {
    zip.set(parte, posicion);
    posicion += parte.length;
  }
  return zip;
}

export function construirXlsx(tabla: TablaExportable) {
  return crearZip(archivosXlsx(tabla));
}

function descargarBlob(blob: Blob, nombreArchivo: string) {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function descargarExcel(tabla: TablaExportable, nombreArchivo: string) {
  const datos = construirXlsx(tabla);
  descargarBlob(new Blob([datos.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${nombreArchivo}.xlsx`);
}

export async function descargarPdf(tabla: TablaExportable, nombreArchivo: string) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const documento = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const margen = 32;
  documento.setFont("helvetica", "bold");
  documento.setFontSize(15);
  documento.setTextColor(24, 34, 48);
  documento.text(tabla.titulo, margen, margen + 8);
  if (tabla.subtitulo) {
    documento.setFont("helvetica", "normal");
    documento.setFontSize(9);
    documento.setTextColor(102, 112, 133);
    documento.text(tabla.subtitulo, margen, margen + 24);
  }
  autoTable(documento, {
    head: [tabla.encabezados],
    body: tabla.filas.map((fila) => tabla.encabezados.map((_, indice) => {
      const valor = fila[indice];
      return valor === null || valor === undefined || valor === "" ? "-" : String(valor);
    })),
    startY: margen + (tabla.subtitulo ? 36 : 22),
    margin: { left: margen, right: margen, bottom: margen + 8 },
    styles: { font: "helvetica", fontSize: 8, cellPadding: 5, textColor: [52, 64, 84], lineColor: [228, 231, 236], lineWidth: { bottom: 0.5 } },
    headStyles: { fillColor: [22, 58, 95], textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 251] },
  });
  const paginas = documento.getNumberOfPages();
  for (let pagina = 1; pagina <= paginas; pagina++) {
    documento.setPage(pagina);
    documento.setFont("helvetica", "normal");
    documento.setFontSize(8);
    documento.setTextColor(152, 162, 179);
    const ancho = documento.internal.pageSize.getWidth();
    const alto = documento.internal.pageSize.getHeight();
    documento.text(`Página ${pagina} de ${paginas}`, ancho - margen, alto - margen / 2, { align: "right" });
  }
  documento.save(`${nombreArchivo}.pdf`);
}
