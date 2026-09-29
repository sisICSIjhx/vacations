// La urgencia se guarda como prefijo del comentario para no requerir cambios de esquema:
// viaja por la RPC, la vista y el trigger de WhatsApp sin tocar la base de datos.
export const PREFIJO_URGENTE = "[URGENTE] ";

export function comentarioConUrgencia(comentarios: string, urgente?: boolean): string {
  const texto = comentarios.trim();
  return urgente ? `${PREFIJO_URGENTE}${texto}` : texto;
}

export function separarUrgencia(comentarios?: string): { urgente: boolean; texto: string } {
  const c = comentarios ?? "";
  return c.startsWith(PREFIJO_URGENTE) ? { urgente: true, texto: c.slice(PREFIJO_URGENTE.length) } : { urgente: false, texto: c };
}
