// =========================================================
// Edge Function: notificar-empleado
// Envia por correo (Microsoft Graph) al empleado que solicito:
//   solicitud_creada  acuse de recibo
//   aprobada          resolucion final
//   rechazada         con el motivo y la invitacion a reagendar
//
// La invoca vacaciones.enviar_correo_empleado() (pg_net), definida en
// 010_avisos_empleado_y_recordatorios.sql. El payload ya trae todos los datos;
// esta funcion no consulta la base. El aviso al grupo de WhatsApp lo hace la
// Edge Function "notificar" (008), no esta.
//
// Diseno: sistema de diseno "ICSI Oil & Gas" (azul marino/azul medio, Arial,
// esquinas rectas, sin barras de acento, logo monocromatico blanco sobre el
// encabezado de color, nombre legal completo). El logo y los iconos de estado
// viajan como adjuntos en linea (imagenes.ts), no como imagenes externas.
//
// Secrets (Edge Functions > Secrets, compartidos por todo el proyecto):
//   WEBHOOK_SECRET  — el mismo de "notificar" (notificaciones_push_config.webhook_secret)
//   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER — Microsoft Graph
//   APP_URL         — opcional, URL del sistema para el boton del correo
//
// Deploy: supabase functions deploy notificar-empleado --no-verify-jwt
// (la autenticacion la hace el header x-webhook-secret)
// =========================================================

import { ICONO_APROBADA_PNG, ICONO_RECHAZADA_PNG, ICONO_RECIBIDA_PNG, LOGO_PNG } from './imagenes.ts'

type Etapa = 'rrhh' | 'jefe_inmediato' | 'mesa_directiva'

interface Payload {
  evento: 'solicitud_creada' | 'aprobada' | 'rechazada'
  solicitud_id: string
  empleado: { nombre: string; correo: string | null }
  tipo_ausencia: string | null
  fecha_inicio: string
  fecha_fin: string
  fecha_reintegro: string | null
  dias: number
  revision: { etapa: Etapa; decision: string; comentario: string | null } | null
}

// Imagen adjunta en linea: el HTML la referencia como src="cid:<cid>"
interface ImagenEnLinea { cid: string; nombre: string; base64: string }

interface Correo { asunto: string; html: string; imagenes: ImagenEnLinea[] }

// ---------- Formato ----------

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

// "lunes 12 de octubre de 2026" (sin la coma que agrega Intl despues del dia)
function fechaLarga(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split('-').map(Number)
  const semana = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay()
  return `${DIAS_SEMANA[semana]} ${dia} de ${MESES[mes - 1]} de ${anio}`
}

function textoDias(dias: number): string {
  const n = Number(dias)
  return `${Number.isInteger(n) ? n : n.toFixed(1)} ${n === 1 ? 'día' : 'días'}`
}

function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

// ---------- Diseno (tokens del sistema ICSI Oil & Gas) ----------
// HTML para correo: tablas y estilos en linea (Outlook ignora <style> y flexbox).

const C = {
  azulMarino: '#0D2E47',
  azulMedio: '#145CA1',
  gris: '#BFBFBF',
  surface: '#FFFFFF',
  surfaceTint: '#F4F7FA',
  ink: '#12181F',
  inkSoft: '#4A545C',
  border: '#D7DEE4',
}
const FUENTE = 'Arial, Helvetica, sans-serif'
const RAZON_SOCIAL = 'Ingeniería, Construcción y Servicios Integrales Oil &amp; Gas S.A. de C.V.'

interface Estado { etiqueta: string; color: string; icono: ImagenEnLinea }

const ESTADOS: Record<Payload['evento'], Estado> = {
  solicitud_creada: {
    etiqueta: 'Solicitud recibida',
    color: C.azulMedio,
    icono: { cid: 'estado-recibida', nombre: 'estado-recibida.png', base64: ICONO_RECIBIDA_PNG },
  },
  aprobada: {
    etiqueta: 'Solicitud aprobada',
    color: '#138A5B',
    icono: { cid: 'estado-aprobada', nombre: 'estado-aprobada.png', base64: ICONO_APROBADA_PNG },
  },
  rechazada: {
    etiqueta: 'Solicitud no aprobada',
    color: '#C63D4F',
    icono: { cid: 'estado-rechazada', nombre: 'estado-rechazada.png', base64: ICONO_RECHAZADA_PNG },
  },
}

const LOGO: ImagenEnLinea = { cid: 'logo-icsi', nombre: 'logo-icsi.png', base64: LOGO_PNG }

const estiloEtiqueta = `font-family:${FUENTE};font-size:12px;line-height:16px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase`

function parrafo(html: string, margen = '0 0 16px'): string {
  return `<p style="margin:${margen};font-family:${FUENTE};font-size:16px;line-height:24px;color:${C.ink}">${html}</p>`
}

// Panel del periodo en dos columnas: Del | Al, Dias | Regreso
function panelPeriodo(p: Payload): string {
  const celda = (etiqueta: string, valor: string) => `
    <td width="50%" valign="top" style="padding:12px 16px">
      <div style="${estiloEtiqueta};color:${C.inkSoft}">${etiqueta}</div>
      <div style="margin-top:4px;font-family:${FUENTE};font-size:16px;line-height:22px;font-weight:bold;color:${C.ink}">${escapar(valor)}</div>
    </td>`
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.surfaceTint}"
      style="margin:8px 0 24px;background:${C.surfaceTint};border:1px solid ${C.border};border-collapse:separate">
      <tr>${celda('Del', fechaLarga(p.fecha_inicio))}${celda('Al', fechaLarga(p.fecha_fin))}</tr>
      <tr>${celda('Días', textoDias(p.dias))}${p.fecha_reintegro ? celda('Regreso', fechaLarga(p.fecha_reintegro)) : '<td></td>'}</tr>
    </table>`
}

function panelMotivo(motivo: string, estado: Estado): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="margin:0 0 24px;border:1px solid ${C.border};border-collapse:separate">
      <tr><td style="padding:16px">
        <div style="${estiloEtiqueta};color:${estado.color}">Motivo</div>
        <div style="margin-top:6px;font-family:${FUENTE};font-size:16px;line-height:24px;color:${C.ink}">${escapar(motivo).replace(/\n/g, '<br>')}</div>
      </td></tr>
    </table>`
}

function boton(url: string, texto: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 8px">
      <tr><td bgcolor="${C.azulMedio}" style="background:${C.azulMedio}">
        <a href="${url}" style="display:inline-block;padding:14px 28px;font-family:${FUENTE};font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none">${texto}</a>
      </td></tr>
    </table>`
}

// Estructura comun: encabezado institucional, bloque de estado, cuerpo, firma y pie.
function plantilla(estado: Estado, titulo: string, cuerpo: string): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapar(titulo)}</title></head>
<body style="margin:0;padding:0;background:${C.surfaceTint}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.surfaceTint}" style="background:${C.surfaceTint}">
<tr><td align="center" style="padding:32px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" bgcolor="${C.surface}"
    style="width:100%;max-width:600px;background:${C.surface};border:1px solid ${C.border}">

    <tr><td bgcolor="${C.azulMarino}" style="background:${C.azulMarino};padding:24px 32px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td valign="middle" style="padding-right:16px">
          <img src="cid:${LOGO.cid}" width="47" height="48" alt="" style="display:block;border:0;width:47px;height:48px">
        </td>
        <td valign="middle">
          <div style="font-family:${FUENTE};font-size:14px;line-height:19px;font-weight:bold;color:#FFFFFF">${RAZON_SOCIAL}</div>
          <div style="margin-top:4px;${estiloEtiqueta};font-size:11px;color:${C.gris}">Recursos Humanos · Vacaciones</div>
        </td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:36px 40px 8px">
      <img src="cid:${estado.icono.cid}" width="56" height="56" alt="" style="display:block;border:0;width:56px;height:56px">
      <div style="margin-top:20px;${estiloEtiqueta};color:${estado.color}">${estado.etiqueta}</div>
      <h1 style="margin:8px 0 24px;font-family:${FUENTE};font-size:24px;line-height:30px;font-weight:bold;color:${C.azulMarino}">${escapar(titulo)}</h1>
      ${cuerpo}
    </td></tr>

    <tr><td style="padding:16px 40px 36px">
      ${parrafo('Atentamente,', '0')}
      ${parrafo('<strong>Recursos Humanos</strong>', '0')}
      <p style="margin:0;font-family:${FUENTE};font-size:14px;line-height:20px;color:${C.inkSoft}">${RAZON_SOCIAL}</p>
    </td></tr>

    <tr><td bgcolor="${C.surfaceTint}" style="background:${C.surfaceTint};border-top:1px solid ${C.border};padding:18px 40px">
      <p style="margin:0;font-family:${FUENTE};font-size:12px;line-height:17px;color:${C.inkSoft}">
        Este mensaje fue generado automáticamente por el Sistema de Vacaciones.
      </p>
    </td></tr>

  </table>
</td></tr>
</table>
</body></html>`
}

// ---------- Plantillas ----------

function armarCorreo(p: Payload): Correo | null {
  const estado = ESTADOS[p.evento]
  if (!estado) return null
  const nombre = escapar(p.empleado.nombre)
  const appUrl = Deno.env.get('APP_URL')?.replace(/\/$/, '') ?? null
  const imagenes = [LOGO, estado.icono]
  const saludo = parrafo(`Hola <strong>${nombre}</strong>:`)

  switch (p.evento) {
    case 'solicitud_creada':
      return {
        asunto: 'Recibimos tu solicitud de vacaciones',
        imagenes,
        html: plantilla(estado, 'Recibimos tu solicitud de vacaciones', `
          ${saludo}
          ${parrafo('Tu solicitud quedó registrada con el siguiente periodo:', '0 0 8px')}
          ${panelPeriodo(p)}
          ${parrafo('A partir de este momento inicia el proceso de revisión y aprobación. Te notificaremos por este medio cuando se emita una resolución.')}
          ${appUrl ? boton(appUrl, 'Consultar mi solicitud') : ''}`),
      }

    case 'aprobada':
      return {
        asunto: 'Tu solicitud de vacaciones fue aprobada',
        imagenes,
        html: plantilla(estado, 'Tu solicitud de vacaciones fue aprobada', `
          ${saludo}
          ${parrafo('Tu solicitud concluyó el proceso de revisión y fue <strong>aprobada</strong> para el siguiente periodo:', '0 0 8px')}
          ${panelPeriodo(p)}
          ${parrafo('Antes de tu salida, te pedimos dejar tus pendientes documentados y coordinados con tu jefe inmediato.')}`),
      }

    case 'rechazada': {
      const motivo = p.revision?.comentario?.trim()
      return {
        asunto: 'Tu solicitud de vacaciones no fue aprobada',
        imagenes,
        html: plantilla(estado, 'Tu solicitud de vacaciones no fue aprobada', `
          ${saludo}
          ${parrafo('Te informamos que tu solicitud para el siguiente periodo <strong>no fue aprobada</strong>:', '0 0 8px')}
          ${panelPeriodo(p)}
          ${motivo ? panelMotivo(motivo, estado) : ''}
          ${parrafo('Te invitamos cordialmente a <strong>reagendar tus vacaciones</strong> en otras fechas. Para cualquier aclaración, el área de Recursos Humanos está a tu disposición.')}
          ${appUrl ? boton(appUrl, 'Registrar nueva solicitud') : ''}`),
      }
    }

    default:
      return null
  }
}

// ---------- Microsoft Graph ----------

let tokenCache: { valor: string; expira: number } | null = null

async function tokenGraph(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expira) return tokenCache.valor
  const res = await fetch(`https://login.microsoftonline.com/${Deno.env.get('MS_TENANT_ID')}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: Deno.env.get('MS_CLIENT_ID')!,
      client_secret: Deno.env.get('MS_CLIENT_SECRET')!,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  })
  if (!res.ok) throw new Error(`Token Graph ${res.status}: ${await res.text()}`)
  const data = await res.json()
  // Se renueva 5 minutos antes de que expire (dura ~60 min)
  tokenCache = { valor: data.access_token, expira: Date.now() + (data.expires_in - 300) * 1000 }
  return tokenCache.valor
}

async function enviarCorreo(p: Payload) {
  const correo = armarCorreo(p)
  if (!correo) return { canal: 'email', enviado: false, razon: `evento no soportado: ${p.evento}` }

  const remitente = Deno.env.get('MS_SENDER')
  if (!remitente || !Deno.env.get('MS_TENANT_ID') || !Deno.env.get('MS_CLIENT_ID') || !Deno.env.get('MS_CLIENT_SECRET')) {
    return { canal: 'email', enviado: false, razon: 'sin configurar' }
  }
  if (!p.empleado.correo) return { canal: 'email', enviado: false, razon: 'empleado sin correo' }

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(remitente)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await tokenGraph()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: correo.asunto,
        body: { contentType: 'HTML', content: correo.html },
        toRecipients: [{ emailAddress: { address: p.empleado.correo } }],
        // Logo e icono como adjuntos en linea: el HTML los referencia con cid:
        attachments: correo.imagenes.map((img) => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: img.nombre,
          contentType: 'image/png',
          contentBytes: img.base64,
          contentId: img.cid,
          isInline: true,
        })),
      },
      saveToSentItems: true,
    }),
  })
  if (res.status !== 202) return { canal: 'email', enviado: false, razon: `Graph ${res.status}: ${await res.text()}` }
  return { canal: 'email', enviado: true }
}

// ---------- Handler ----------

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const secret = Deno.env.get('WEBHOOK_SECRET')
  if (!secret || req.headers.get('x-webhook-secret') !== secret) {
    return new Response('Unauthorized', { status: 401 })
  }

  let payload: Payload
  try {
    payload = await req.json()
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  const resultado = await enviarCorreo(payload).catch((e) => ({ canal: 'email', enviado: false, razon: String(e) }))
  console.log('notificar-empleado', payload.evento, payload.solicitud_id, JSON.stringify(resultado))

  return new Response(JSON.stringify({ ok: true, resultado }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
