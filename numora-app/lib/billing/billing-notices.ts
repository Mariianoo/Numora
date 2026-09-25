/**
 * lib/billing/billing-notices.ts
 * Etapa "B1 — Official Launch, código de cobrança" — textos e regras PURAS
 * dos avisos de cobrança do Dashboard (retorno do checkout e pagamento
 * pendente). Separado do componente para ser testável sem renderizar e para
 * nunca duplicar copy entre Dashboard e testes.
 *
 * Nenhuma dessas mensagens concede acesso nem afirma nada que o servidor não
 * tenha confirmado: "confirmado" só existe quando `resolveCheckoutReturn`
 * sincronizou uma subscription realmente `active`/`trialing`.
 */
import type { CheckoutReturnOutcome } from './checkout-return'

export type BillingNoticeTone = 'success' | 'info' | 'warning'

export interface BillingNotice {
  tone: BillingNoticeTone
  title: string
  description: string
}

/** O que a página resolveu a partir da query string — `cancel` não depende de Stripe (só informa, nunca altera nada). */
export type CheckoutReturnNoticeInput = CheckoutReturnOutcome | 'cancel'

const CHECKOUT_RETURN_NOTICES: Record<CheckoutReturnNoticeInput, BillingNotice> = {
  confirmed: {
    tone: 'success',
    title: 'Pagamento confirmado',
    description: 'Seu plano foi atualizado.',
  },
  pending: {
    tone: 'info',
    title: 'Estamos confirmando seu pagamento',
    description: 'Isso pode levar alguns instantes. Atualize a página em alguns segundos.',
  },
  cancel: {
    tone: 'info',
    title: 'Você cancelou a contratação',
    description: 'Nenhuma cobrança foi concluída.',
  },
  invalid: {
    tone: 'warning',
    title: 'Não foi possível verificar esta contratação',
    description: 'Se você concluiu um pagamento, seu plano será atualizado assim que ele for confirmado.',
  },
  unavailable: {
    tone: 'info',
    title: 'Não foi possível confirmar o pagamento agora',
    description: 'Se você concluiu a contratação, seu plano será atualizado em instantes.',
  },
}

export function getCheckoutReturnNotice(input: CheckoutReturnNoticeInput): BillingNotice {
  return CHECKOUT_RETURN_NOTICES[input]
}

/** `past_due` é o único estado de cobrança que mantém acesso E precisa de ação do usuário (política inalterada: o acesso é decidido por `effective_plans()`, não por este aviso). */
export function isPaymentPendingStatus(status: string | null | undefined): boolean {
  return status === 'past_due'
}

export const PAYMENT_PENDING_NOTICE: BillingNotice = {
  tone: 'warning',
  title: 'Pagamento pendente',
  description: 'Não conseguimos processar sua última cobrança. Seu acesso continua ativo por enquanto — atualize sua forma de pagamento para evitar a interrupção do plano.',
}
