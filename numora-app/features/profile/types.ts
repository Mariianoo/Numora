/**
 * features/profile/types.ts
 * Tipagens de domínio do perfil do colecionador (profiles) — Etapa 8.1
 * (Meu Perfil). `role` fica de fora de propósito: não é exibido nesta
 * etapa (decisão de produto), então não há motivo para trazê-lo do banco.
 *
 * Etapa 15.9.1-R3: `planTier` (profiles.plan_tier, legado/nunca
 * sincronizado) foi REMOVIDO deste tipo — o plano exibido no Perfil agora
 * vem de `EffectivePlan` (ver abaixo), buscado via
 * `ProfileRepository.getOwnEffectivePlan()` → RPC `get_effective_plan()`
 * (Etapa 15.9.1-R2, fonte única courtesy > subscription > free). `Profile`
 * nunca mais referencia `plan_tier`.
 */

export interface Profile {
  id: string
  numoraId: string
  email: string | null
  name: string | null
  username: string | null
  avatarUrl: string | null
  countryCode: string | null
  passportPublic: boolean
  collectorSince: string
  createdAt: string
}

/**
 * Espelha o retorno de `get_effective_plan()` (banco) — três dimensões
 * nunca misturadas (Etapa 15.9.1-R3 §4): `planSlug` (free/pro/premium),
 * `source` (de onde vem esse plano) e `subscriptionStatus` (estado da
 * assinatura, independente do plano — ex.: past_due não rebaixa o plano
 * efetivo, só descreve a saúde do pagamento).
 */
export interface EffectivePlan {
  planSlug: string
  source: 'default' | 'subscription' | 'courtesy'
  subscriptionStatus: string | null
  courtesyType: string | null
  courtesyExpiresAt: string | null
}

/**
 * Somente os campos que o usuário pode editar nesta etapa.
 * `passportPublic` fica de fora de propósito — o toggle está desabilitado
 * na UI (a rota pública e a RLS pública ainda não existem, ver análise da
 * Etapa 8) e o repositório não aceita alterá-lo ainda. `id`, `numoraId`,
 * `role`, `email`, `collectorSince`, `createdAt` nunca aparecem aqui — não
 * é possível montar um payload de update que os inclua através deste tipo.
 */
export interface ProfileUpdateInput {
  name: string | null
  username: string | null
  countryCode: string | null
}
