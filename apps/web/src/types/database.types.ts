/**
 * lib/supabase/database.types.ts
 * PLACEHOLDER — este arquivo deve ser substituído pelo output real de:
 *
 *   supabase gen types typescript --project-id <id> > database.types.ts
 *
 * A estrutura completa do schema está especificada em
 * DATABASE_ARCHITECTURE.md. Nesta Sprint (Authentication Foundation), apenas
 * o suficiente para tipar os clients Supabase (client.ts/server.ts/admin.ts)
 * está incluído — cobrindo `profiles`, a única tabela que a camada de auth
 * desta sprint referencia (via auth-repository.ts).
 *
 * NÃO adicionar tabelas de outros domínios aqui manualmente — o arquivo
 * inteiro é substituído pela geração oficial assim que o schema estiver
 * migrado no ambiente correspondente.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          username: string
          display_name: string
          avatar_path: string | null
          bio: string | null
          country_code: string | null
          role: 'visitor' | 'user' | 'verified_seller' | 'moderator' | 'admin' | 'system' | 'ai'
          plan_tier: 'free' | 'premium' | 'pro'
          is_verified_seller: boolean
          locale: string
          last_active_at: string | null
          deleted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['profiles']['Row']> & {
          id: string
          username: string
          display_name: string
        }
        Update: Partial<Database['public']['Tables']['profiles']['Row']>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      user_role: 'visitor' | 'user' | 'verified_seller' | 'moderator' | 'admin' | 'system' | 'ai'
      subscription_tier: 'free' | 'premium' | 'pro'
    }
  }
}
