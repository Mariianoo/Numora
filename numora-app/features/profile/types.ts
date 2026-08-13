/**
 * features/profile/types.ts
 * Tipagens de domínio do perfil do colecionador (profiles) — Etapa 8.1
 * (Meu Perfil). `role` fica de fora de propósito: não é exibido nesta
 * etapa (decisão de produto), então não há motivo para trazê-lo do banco.
 */

export interface Profile {
  id: string
  numoraId: string
  email: string | null
  name: string | null
  username: string | null
  avatarUrl: string | null
  countryCode: string | null
  planTier: 'free' | 'premium'
  passportPublic: boolean
  collectorSince: string
  createdAt: string
}

/**
 * Somente os campos que o usuário pode editar nesta etapa.
 * `passportPublic` fica de fora de propósito — o toggle está desabilitado
 * na UI (a rota pública e a RLS pública ainda não existem, ver análise da
 * Etapa 8) e o repositório não aceita alterá-lo ainda. `id`, `numoraId`,
 * `role`, `planTier`, `email`, `collectorSince`, `createdAt` nunca
 * aparecem aqui — não é possível montar um payload de update que os
 * inclua através deste tipo.
 */
export interface ProfileUpdateInput {
  name: string | null
  username: string | null
  countryCode: string | null
}
