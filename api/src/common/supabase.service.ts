import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly url?: string;
  private readonly clavePublica?: string;
  private readonly claveSecreta?: string;
  private clienteAdministrador?: SupabaseClient;

  constructor(private readonly config: ConfigService) {
    this.url = this.config.get<string>('SUPABASE_URL');
    this.clavePublica = this.config.get<string>('SUPABASE_PUBLISHABLE_KEY');
    this.claveSecreta = this.config.get<string>('SUPABASE_SECRET_KEY');
  }

  administrador(): SupabaseClient {
    if (!this.url || !this.claveSecreta) {
      throw new ServiceUnavailableException(
        'Faltan SUPABASE_URL o SUPABASE_SECRET_KEY en el servidor.',
      );
    }
    this.clienteAdministrador ??= createClient(this.url, this.claveSecreta, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return this.clienteAdministrador;
  }

  async obtenerUsuario(token: string) {
    if (!this.url || !this.clavePublica) {
      throw new ServiceUnavailableException(
        'Faltan SUPABASE_URL o SUPABASE_PUBLISHABLE_KEY en el servidor.',
      );
    }
    const cliente = createClient(this.url, this.clavePublica, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await cliente.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user;
  }
}
