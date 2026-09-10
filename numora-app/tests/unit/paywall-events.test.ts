/**
 * tests/unit/paywall-events.test.ts
 * Etapa "5.9E — Analytics" — testa a camada de eventos do funil de
 * monetização (lib/analytics/events/paywall-events.ts): nome do evento,
 * propriedades, contexto/trigger e o contrato de propagação de erro que
 * sustenta o padrão fail-safe usado em todo call site (try/catch →
 * Sentry.captureException, ver UpgradeToProDialog.tsx/collection/page.tsx/
 * trash/page.tsx/LabelGeneratorModal.tsx/DashboardAdvancedLockedTracker.tsx).
 *
 * `pushToDataLayer()` é mockado (nunca a implementação real): o ambiente
 * de `tests/unit` roda em Node puro, sem `window`/`jsdom` (ver
 * vitest.config.mts, `environment: 'node'`) — a implementação real de
 * `pushToDataLayer` já faz `if (typeof window === 'undefined') return`
 * ANTES de checar consentimento, então rodar contra a implementação real
 * aqui só provaria "não existe window", não o comportamento de
 * consentimento. O consentimento (`getConsent().analytics`) já é
 * responsabilidade exclusiva de `pushToDataLayer` (lib/analytics/gtm.ts) —
 * nenhuma das funções abaixo acessa `window`/`localStorage`/`dataLayer`
 * diretamente, então não têm COMO reimplementar ou contornar esse gate:
 * a garantia de "nunca criar bypass de consentimento" é estrutural (só
 * existe um único caminho para `window.dataLayer`, e é sempre
 * `pushToDataLayer`), não algo que precise ser reprovado em runtime aqui.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/analytics/gtm', () => ({
  pushToDataLayer: vi.fn(),
}))

const { pushToDataLayer } = await import('@/lib/analytics/gtm')
const { trackCollectionLimitReached, trackFeatureLocked, trackUpgradeViewed, trackCheckoutStarted } = await import(
  '@/lib/analytics/events/paywall-events'
)

beforeEach(() => {
  vi.mocked(pushToDataLayer).mockReset()
})

describe('trackCollectionLimitReached', () => {
  it('dispara "collection_limit_reached" com as 4 propriedades exigidas, sem alteração de forma', () => {
    trackCollectionLimitReached({ current_count: 50, limit: 50, plan_slug: 'free', context: 'new_item' })

    expect(pushToDataLayer).toHaveBeenCalledTimes(1)
    expect(pushToDataLayer).toHaveBeenCalledWith({
      event: 'collection_limit_reached',
      current_count: 50,
      limit: 50,
      plan_slug: 'free',
      context: 'new_item',
    })
  })

  it.each(['collection_page', 'new_item', 'restore'] as const)('aceita o context válido "%s"', (context) => {
    trackCollectionLimitReached({ current_count: 12, limit: 50, plan_slug: 'free', context })

    expect(pushToDataLayer).toHaveBeenCalledWith(expect.objectContaining({ context }))
  })
})

describe('trackFeatureLocked', () => {
  it('dispara "feature_locked" com feature_key/plan_slug/context — nunca infere plan_slug sozinho (só repassa o que o chamador já resolveu)', () => {
    trackFeatureLocked({ feature_key: 'dashboard_advanced', plan_slug: 'free', context: 'dashboard_advanced' })

    expect(pushToDataLayer).toHaveBeenCalledTimes(1)
    expect(pushToDataLayer).toHaveBeenCalledWith({
      event: 'feature_locked',
      feature_key: 'dashboard_advanced',
      plan_slug: 'free',
      context: 'dashboard_advanced',
    })
  })

  it('não colapsa feature_key/context mesmo quando o mesmo valor de plan_slug muda entre chamadas (nenhum estado interno compartilhado)', () => {
    trackFeatureLocked({ feature_key: 'labels', plan_slug: 'free', context: 'labels' })
    trackFeatureLocked({ feature_key: 'labels', plan_slug: 'premium', context: 'labels' })

    expect(pushToDataLayer).toHaveBeenNthCalledWith(1, expect.objectContaining({ plan_slug: 'free' }))
    expect(pushToDataLayer).toHaveBeenNthCalledWith(2, expect.objectContaining({ plan_slug: 'premium' }))
  })
})

describe('trackUpgradeViewed', () => {
  it('inclui current_count/limit quando informados', () => {
    trackUpgradeViewed({ trigger: 'collection_limit', plan_slug: 'free', current_count: 50, limit: 50 })

    expect(pushToDataLayer).toHaveBeenCalledWith({
      event: 'upgrade_viewed',
      trigger: 'collection_limit',
      plan_slug: 'free',
      current_count: 50,
      limit: 50,
    })
  })

  it('OMITE current_count/limit quando não aplicáveis (ex.: trigger "dashboard") — nunca envia undefined explícito', () => {
    trackUpgradeViewed({ trigger: 'dashboard', plan_slug: 'free' })

    const [payload] = vi.mocked(pushToDataLayer).mock.calls[0]
    expect(payload).toEqual({ event: 'upgrade_viewed', trigger: 'dashboard', plan_slug: 'free' })
    expect('current_count' in payload).toBe(false)
    expect('limit' in payload).toBe(false)
  })

  it.each(['collection_limit', 'restore_limit', 'dashboard', 'labels', 'future_feature'] as const)(
    'aceita o trigger válido "%s"',
    (trigger) => {
      trackUpgradeViewed({ trigger, plan_slug: 'free' })
      expect(pushToDataLayer).toHaveBeenCalledWith(expect.objectContaining({ trigger }))
    },
  )
})

describe('trackCheckoutStarted', () => {
  const FUNNEL_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

  it('dispara "checkout_started" com plan_slug/interval/currency/funnel_id — nunca priceId/customerId/segredos', () => {
    trackCheckoutStarted({ plan_slug: 'pro', interval: 'month', currency: 'BRL', funnel_id: FUNNEL_ID })

    const [payload] = vi.mocked(pushToDataLayer).mock.calls[0]
    expect(payload).toEqual({ event: 'checkout_started', plan_slug: 'pro', interval: 'month', currency: 'BRL', funnel_id: FUNNEL_ID })
    expect(payload).not.toHaveProperty('priceId')
    expect(payload).not.toHaveProperty('customerId')
  })

  it('Etapa 5.9G — NUNCA contém o Stripe Checkout Session ID, user_id, ou qualquer outro identificador além de funnel_id', () => {
    trackCheckoutStarted({ plan_slug: 'pro', interval: 'month', currency: 'BRL', funnel_id: FUNNEL_ID })

    const [payload] = vi.mocked(pushToDataLayer).mock.calls[0]
    expect(payload).not.toHaveProperty('sessionId')
    expect(payload).not.toHaveProperty('session_id')
    expect(payload).not.toHaveProperty('user_id')
    expect(payload).not.toHaveProperty('customer_id')
    expect(payload).not.toHaveProperty('subscription_id')
    expect(payload).not.toHaveProperty('payment_intent_id')
    expect(payload).not.toHaveProperty('amount')
    expect(Object.keys(payload as object).sort()).toEqual(['currency', 'event', 'funnel_id', 'interval', 'plan_slug'])
  })
})

describe('propagação de erro (sustenta o padrão fail-safe dos call sites)', () => {
  // Nenhuma das 4 funções acima tem try/catch interno — de propósito: o
  // padrão estabelecido pelo projeto (ver CollectionRepository.create(),
  // Etapa 15.10.4) é o CALL SITE envolver a chamada em
  // try { trackX() } catch (err) { Sentry.captureException(err) }. Se
  // trackX() engolisse o erro sozinha, o call site nunca teria a chance de
  // reportar a falha ao Sentry — por isso o comportamento correto aqui é
  // PROPAGAR, nunca mascarar.
  it('uma falha em pushToDataLayer propaga através de trackX() (nunca é engolida na própria função de evento)', () => {
    vi.mocked(pushToDataLayer).mockImplementation(() => {
      throw new Error('dataLayer indisponível (simulado)')
    })

    expect(() => trackUpgradeViewed({ trigger: 'dashboard', plan_slug: 'free' })).toThrow('dataLayer indisponível')
  })

  it('o padrão try/catch usado em todo call site real absorve essa falha sem deixar escapar (prova do contrato, não duplica o teste de UI)', () => {
    vi.mocked(pushToDataLayer).mockImplementation(() => {
      throw new Error('dataLayer indisponível (simulado)')
    })

    expect(() => {
      try {
        trackCheckoutStarted({ plan_slug: 'pro', interval: 'month', currency: 'BRL', funnel_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
      } catch {
        // mesmo formato usado em UpgradeToProDialog.tsx/collection/page.tsx/etc.
      }
    }).not.toThrow()
  })
})
