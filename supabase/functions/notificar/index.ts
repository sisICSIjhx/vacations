interface NotificacionPayload {
  id: string
  tipo: string
  titulo: string
  mensaje: string | null
  referencia_id: string | null
  created_at: string
}

// Acepta un telefono o un chatId ya armado (@c.us / @g.us)
function toChatId(valor: string): string {
  return valor.includes('@') ? valor : `${valor.replace(/\D/g, '')}@c.us`
}

// El SQL guarda el mensaje como "Clave: valor | Clave: valor" -> mapa clave/valor
function parseCampos(mensaje: string | null): Record<string, string> {
  const campos: Record<string, string> = {}
  for (const parte of (mensaje ?? '').split(' | ')) {
    const i = parte.indexOf(':')
    if (i > 0) campos[parte.slice(0, i).trim()] = parte.slice(i + 1).trim()
  }
  return campos
}

// Dias naturales entre dos fechas DD/MM/YYYY (inclusive); null si no se pueden leer
function diasNaturales(del?: string, al?: string): number | null {
  const f = (s?: string) => {
    const m = s?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : NaN
  }
  const dias = (f(al) - f(del)) / 86_400_000 + 1
  return Number.isFinite(dias) && dias > 0 ? dias : null
}

// Plantillas por tipo de evento. Formato WhatsApp: *negrita*, _cursiva_.
// SALTO separa los datos de la solicitud de la parte del flujo de aprobacion (linea en blanco).
const SALTO = '\u0000'
function armarTexto(n: NotificacionPayload, appUrl: string | null): string {
  const c = parseCampos(n.mensaje)
  const empleado = c['Empleado'] ?? 'N/D'
  const tipo = c['Tipo'] ?? 'N/D'
  const del = c['Del'] ?? 'N/D'
  const al = c['Al'] ?? 'N/D'
  // Desde 016 el SQL manda los dias que descuenta (sin el dia de descanso del
  // empleado); los avisos anteriores no lo traen y se cuentan dias naturales.
  const diasSql = Number(c['Días'])
  const dias = c['Días'] && Number.isFinite(diasSql) ? diasSql : diasNaturales(c['Del'], c['Al'])
  const periodo = `📅 *Periodo:* ${del} al ${al}${dias ? ` (${dias} ${dias === 1 ? 'día' : 'días'})` : ''}`
  const jefe = c['Jefe inmediato']
  // La app marca las solicitudes extraordinarias con el prefijo [URGENTE] en el comentario
  const urgente = (c['Comentarios'] ?? '').startsWith('[URGENTE]')
  const motivo = (c['Comentarios'] ?? '').replace(/^\[URGENTE\]\s*/, '')
  const datos = [
    urgente ? '🚨 *SOLICITUD EXTRAORDINARIA / URGENTE* (no planeada)' : '',
    `👤 *Empleado:* ${empleado}`,
    // En la etapa del jefe su nombre va en la linea de "Accion requerida"
    jefe && n.tipo !== 'solicitud_jefe' ? `👔 *Jefe inmediato:* ${jefe}` : '',
    `📝 *Tipo:* ${tipo}`,
    periodo,
  ]
  // Quien decidio la etapa y su comentario (015); solo en avisos de decision
  const revisor = c['Revisó']
  const comentarioRevision = c['Comentario revisión']
  const lineaComentario = (etiqueta: string) =>
    comentarioRevision ? `💬 *${etiqueta}${revisor ? ` (${revisor})` : ''}:* ${comentarioRevision}` : ''
  const enlace = appUrl ? `🔗 ${appUrl.replace(/\/$/, '')}` : ''

  let cuerpo: string[]
  switch (n.tipo) {
    case 'solicitud_nueva':
      cuerpo = [
        '🏖️ *NUEVA SOLICITUD DE VACACIONES*',
        ...datos,
        motivo ? `💬 *${urgente ? 'Motivo de la urgencia' : 'Comentarios'}:* ${motivo}` : '',
        SALTO,
        '📍 *Etapa:* 1 de 3 · RRHH',
        '⏳ *Acción requerida:* RRHH debe revisar la solicitud.',
      ]
      break
    case 'solicitud_jefe':
      cuerpo = [
        '✅ *RRHH APROBÓ LA SOLICITUD*',
        ...datos,
        lineaComentario('Comentario'),
        SALTO,
        '📍 *Etapa:* 2 de 3 · Jefe inmediato',
        `⏳ *Acción requerida:* ${jefe ? `*${jefe}* (jefe inmediato de ${empleado})` : 'el jefe inmediato'} debe aprobar o rechazar.`,
      ]
      break
    case 'solicitud_mesa':
      cuerpo = [
        '✅ *JEFE INMEDIATO APROBÓ LA SOLICITUD*',
        ...datos,
        lineaComentario('Comentario'),
        SALTO,
        '📍 *Etapa:* 3 de 3 · Mesa directiva',
        '⏳ *Acción requerida:* la mesa directiva debe dar la aprobación final.',
      ]
      break
    case 'solicitud_aprobada':
      cuerpo = [
        '🎉 *SOLICITUD APROBADA · PROCESO CONCLUIDO*',
        ...datos,
        lineaComentario('Comentario'),
        SALTO,
        '📍 *Resultado:* aprobada por RRHH, jefe inmediato y mesa directiva.',
        '_No se requiere ninguna acción adicional._',
      ]
      break
    case 'solicitud_rechazada':
      cuerpo = [
        '❌ *SOLICITUD RECHAZADA*',
        ...datos,
        SALTO,
        c['Rechazó'] ? `🚫 *Rechazada en la etapa de:* ${c['Rechazó']}` : '',
        lineaComentario('Motivo del rechazo'),
        '📍 *Resultado:* el flujo se detiene, no continúa a las siguientes etapas.',
        '_Consulta el sistema para ver el detalle._',
      ]
      break
    case 'recordatorio': {
      // Generado por vacaciones.enviar_recordatorios_pendientes() (010, pg_cron)
      const espera = Number(c['Días en espera'])
      cuerpo = [
        '⏰ *RECORDATORIO DE APROBACIÓN*',
        ...datos,
        SALTO,
        Number.isFinite(espera) ? `⌛ *En espera:* ${espera} ${espera === 1 ? 'día' : 'días'} sin respuesta` : '',
        `⏳ *Acción requerida:* ${c['Pendiente de'] ? `*${c['Pendiente de']}*` : 'la etapa correspondiente'} debe aprobar o rechazar.`,
      ]
      break
    }
    // Solicitudes de edicion (017): Del/Al/Días son el periodo vigente de la solicitud
    case 'edicion_solicitada':
      cuerpo = [
        '✏️ *SOLICITUD DE EDICIÓN*',
        ...datos,
        `🆕 *Periodo solicitado:* ${c['Nuevo del'] ?? 'N/D'} al ${c['Nuevo al'] ?? 'N/D'}`,
        c['Motivo'] ? `💬 *Motivo:* ${c['Motivo']}` : '',
        c['Registró'] ? `🗂️ *Registró:* ${c['Registró']}` : '',
        SALTO,
        '⏳ *Acción requerida:* el administrador debe revisar y aplicar o rechazar la edición.',
      ]
      break
    case 'edicion_aplicada':
      cuerpo = [
        '✏️ *EDICIÓN APLICADA*',
        `👤 *Empleado:* ${empleado}`,
        `📝 *Tipo:* ${tipo}`,
        `↩️ *Periodo anterior:* ${c['Antes del'] ?? 'N/D'} al ${c['Antes al'] ?? 'N/D'}${c['Días antes'] ? ` (${c['Días antes']} ${c['Días antes'] === '1' ? 'día' : 'días'})` : ''}`,
        periodo.replace('*Periodo:*', '*Nuevo periodo:*'),
        c['Motivo'] ? `💬 *Motivo del empleado:* ${c['Motivo']}` : '',
        c['Nota'] ? `🛠️ *Nota del administrador${c['Editó'] ? ` (${c['Editó']})` : ''}:* ${c['Nota']}` : '',
        SALTO,
        '_Se notificó al empleado por correo. La solicitud conserva su etapa de aprobación._',
      ]
      break
    case 'edicion_rechazada':
      cuerpo = [
        '🚫 *EDICIÓN RECHAZADA*',
        ...datos,
        `🆕 *Periodo solicitado:* ${c['Nuevo del'] ?? 'N/D'} al ${c['Nuevo al'] ?? 'N/D'}`,
        c['Motivo'] ? `💬 *Motivo del empleado:* ${c['Motivo']}` : '',
        c['Nota'] ? `🛠️ *Motivo del rechazo${c['Revisó'] ? ` (${c['Revisó']})` : ''}:* ${c['Nota']}` : '',
        SALTO,
        '_La solicitud se queda como estaba. Se notificó al empleado por correo._',
      ]
      break
    default:
      // Tipo desconocido: titulo + campos tal cual llegaron
      cuerpo = [`*${n.titulo}*`, (n.mensaje ?? '').split(' | ').filter((p) => !p.startsWith('Tel jefe:')).join('\n')]
  }

  return [cuerpo.filter(Boolean).join('\n').replaceAll(`\n${SALTO}\n`, '\n\n'), enlace].filter(Boolean).join('\n\n')
}

async function enviarWhatsApp(n: NotificacionPayload, appUrl: string | null) {
  const apiUrl = Deno.env.get('GREENAPI_API_URL')
  const idInstance = Deno.env.get('GREENAPI_ID_INSTANCE')
  const token = Deno.env.get('GREENAPI_API_TOKEN_INSTANCE')
  const destino = Deno.env.get('GREENAPI_CHAT_ID') // id del grupo, termina en @g.us
  if (!apiUrl || !idInstance || !token || !destino) {
    return { canal: 'whatsapp', enviado: false, razon: 'sin configurar' }
  }

  const texto = armarTexto(n, appUrl)

  const res = await fetch(
    `${apiUrl.replace(/\/$/, '')}/waInstance${idInstance}/sendMessage/${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Green API rechaza (400) parametros desconocidos; sendMessage no tiene parametro de menciones
      body: JSON.stringify({ chatId: toChatId(destino), message: texto }),
    },
  )
  if (!res.ok) {
    return { canal: 'whatsapp', enviado: false, razon: `GreenAPI ${res.status}: ${await res.text()}` }
  }
  return { canal: 'whatsapp', enviado: true }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const secret = Deno.env.get('WEBHOOK_SECRET')
  if (!secret || req.headers.get('x-webhook-secret') !== secret) {
    return new Response('Unauthorized', { status: 401 })
  }

  let n: NotificacionPayload
  try {
    n = await req.json()
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  const resultado = await enviarWhatsApp(n, Deno.env.get('APP_URL') ?? null).catch((e) => ({
    canal: 'whatsapp',
    enviado: false,
    razon: String(e),
  }))

  console.log('notificar', n.id, JSON.stringify(resultado))
  return new Response(JSON.stringify({ ok: true, resultado }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
