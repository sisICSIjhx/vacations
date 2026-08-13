import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

export const supabaseConfigurado = Boolean(supabaseUrl && supabasePublishableKey);

let cliente: SupabaseClient | null = null;

export function obtenerSupabase(): SupabaseClient | null {
  if (!supabaseConfigurado) return null;

  if (!cliente) {
    cliente = createClient(supabaseUrl!, supabasePublishableKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return cliente;
}
