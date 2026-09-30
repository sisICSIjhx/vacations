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
// Secrets (Edge Functions > Secrets, compartidos por todo el proyecto):
//   WEBHOOK_SECRET  — el mismo de "notificar" (notificaciones_push_config.webhook_secret)
//   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER — Microsoft Graph
//   APP_URL         — opcional, URL del sistema para los enlaces
//
// Deploy: supabase functions deploy notificar-empleado --no-verify-jwt
// (la autenticacion la hace el header x-webhook-secret)
// =========================================================

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

// Bloque con el periodo: Del / Al / Dias / Regreso
function detallePeriodo(p: Payload): string {
  const filas: [string, string][] = [
    ['Del', fechaLarga(p.fecha_inicio)],
    ['Al', fechaLarga(p.fecha_fin)],
    ['Días', textoDias(p.dias)],
  ]
  if (p.fecha_reintegro) filas.push(['Regreso', fechaLarga(p.fecha_reintegro)])
  const celdas = filas
    .map(([etiqueta, valor]) =>
      `<tr><td style="padding:4px 16px 4px 0;color:#555555">${etiqueta}:</td>` +
      `<td style="padding:4px 0"><strong>${escapar(valor)}</strong></td></tr>`)
    .join('')
  return `<table role="presentation" style="border-collapse:collapse;margin:12px 0 16px">${celdas}</table>`
}

// ---------- Plantillas ----------

function armarCorreo(p: Payload): { asunto: string; html: string } | null {
  const nombre = escapar(p.empleado.nombre)
  const periodo = detallePeriodo(p)
  const appUrl = Deno.env.get('APP_URL')?.replace(/\/$/, '') ?? null
  const sistema = appUrl ? `<a href="${appUrl}">el sistema de vacaciones</a>` : 'el sistema de vacaciones'
  const firma = '<p style="margin-top:24px">Atentamente,<br><strong>Recursos Humanos</strong><br>ICSI OIL &amp; GAS</p>'
  const envolver = (contenido: string) =>
    `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#222222;max-width:560px">${contenido}${firma}</div>`

  switch (p.evento) {
    case 'solicitud_creada':
      return {
        asunto: 'Recibimos tu solicitud de vacaciones',
        html: envolver(`
          <p>Hola ${nombre}:</p>
          <p>Tu solicitud de vacaciones fue <strong>registrada correctamente</strong> con el siguiente periodo:</p>
          ${periodo}
          <p>A partir de ahora seguirá el proceso de revisión y aprobación. Te avisaremos por este medio
          cuando tenga una resolución; mientras tanto, puedes consultar su avance en ${sistema}.</p>`),
      }

    case 'aprobada':
      return {
        asunto: 'Tu solicitud de vacaciones fue aprobada',
        html: envolver(`
          <p>Hola ${nombre}:</p>
          <p>Nos da gusto informarte que tu solicitud de vacaciones fue <strong>aprobada</strong>:</p>
          ${periodo}
          <p>¡Que las disfrutes!</p>`),
      }

    case 'rechazada': {
      const motivo = p.revision?.comentario?.trim()
      return {
        asunto: 'Tu solicitud de vacaciones no fue aprobada',
        html: envolver(`
          <p>Hola ${nombre}:</p>
          <p>Lamentamos informarte que tu solicitud de vacaciones <strong>no fue aprobada</strong>:</p>
          ${periodo}
          ${motivo ? `<p style="margin:0 0 16px;padding:10px 14px;background:#f6f6f6;border-left:3px solid #c0392b"><strong>Motivo:</strong><br>${escapar(motivo).replace(/\n/g, '<br>')}</p>` : ''}
          <p>Te invitamos cordialmente a <strong>reagendar tus vacaciones</strong> en otras fechas;
          puedes registrar una nueva solicitud en ${sistema}. Si tienes dudas, con gusto te atendemos en RRHH.</p>`),
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
