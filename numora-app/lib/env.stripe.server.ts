/**
 * lib/env.stripe.server.ts
 * Etapa "Stripe 4.1A" — schema de ambiente EXCLUSIVAMENTE server-only para
 * a chave secreta do Stripe. Mesmo padrão de `lib/env.admin.server.ts`
 * (`SUPABASE_SERVICE_ROLE_KEY`): módulo à parte de `lib/env.server.ts`
 * (`clientEnv`, só variáveis `NEXT_PUBLIC_*`) para nunca correr o risco de
 * `STRIPE_SECRET_KEY` entrar no bundle do browser por um import futuro
 * acidental. Só deve ser importado por `lib/stripe/client.ts` — que por sua
 * vez só pode ser importado por código que roda exclusivamente no servidor
 * (Server Actions, Route Handlers, scripts Node).
 *
 * Sem prefixo `NEXT_PUBLIC_` — nunca é substituída no bundle do Next.js,
 * fica só em `process.env` do lado do servidor. NUNCA criar uma
 * `NEXT_PUBLIC_STRIPE_SECRET_KEY` — não existe motivo legítimo para essa
 * chave existir do lado do browser.
 *
 * CONFIGURAÇÃO (etapa "Stripe 4.1A" — preparação, nenhum recurso Stripe é
 * criado ainda):
 *   1. Crie uma chave de API em TEST MODE no Dashboard do Stripe
 *      (Developers → API keys, com o toggle "Test mode" ativado) — a chave
 *      secreta começa com `sk_test_`.
 *   2. Adicione `STRIPE_SECRET_KEY=sk_test_...` em `numora-app/.env.local`
 *      (nunca em nenhum arquivo versionado — `.env.local` já está no
 *      `.gitignore` do projeto).
 *   3. `assertStripeTestMode()` (`lib/stripe/assert-test-mode.ts`) valida o
 *      formato da chave (rejeita `sk_live_`, vazio, ou qualquer coisa que
 *      não pareça uma chave de teste válida) ANTES de qualquer chamada ao
 *      Stripe — chamado automaticamente por `getStripeClient()`.
 *   4. Esta etapa (Stripe 4.1A) NÃO cria nenhum recurso no Stripe — só
 *      prepara a infraestrutura. A execução controlada (criar os 2
 *      Products + 8 Prices reais em TEST MODE) é a Stripe 4.1B, uma etapa
 *      futura separada, só depois de aprovação explícita.
 */
import { z } from 'zod'

const stripeEnvSchema = z.object({
  STRIPE_SECRET_KEY: z.string().min(1),
})

export type StripeEnv = z.infer<typeof stripeEnvSchema>

function parseStripeEnv(): StripeEnv {
  const parsed = stripeEnvSchema.safeParse({
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  })

  if (!parsed.success) {
    throw new Error(
      `Variáveis de ambiente (Stripe/server-only) inválidas ou ausentes:\n${parsed.error.issues
        .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
        .join('\n')}`,
    )
  }

  return parsed.data
}

/**
 * Lazy (não módulo-level) — só valida quando efetivamente chamado, mesmo
 * padrão de `getAdminEnv()`. Nunca lança em nenhum caminho de
 * build/import que não precise de fato da chave do Stripe.
 */
export function getStripeEnv(): StripeEnv {
  return parseStripeEnv()
}
