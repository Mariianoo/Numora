/**
 * app/dashboard/BillingNotices.tsx
 * Etapa "B1 — Official Launch, código de cobrança" — avisos de cobrança do
 * Dashboard (retorno do checkout + pagamento pendente). Server Component
 * puramente apresentacional: recebe avisos JÁ resolvidos no servidor
 * (`lib/billing/billing-notices.ts`, `lib/billing/checkout-return.ts`) —
 * nunca decide nada sobre pagamento nem lê a URL sozinho.
 */
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'

import { Card } from '@/components/ui/Card'
import { cn } from '@/components/ui/utils'
import type { BillingNotice } from '@/lib/billing/billing-notices'

const NOTICE_STYLES: Record<BillingNotice['tone'], { icon: typeof Info; iconClass: string }> = {
  success: { icon: CheckCircle2, iconClass: 'text-success' },
  info: { icon: Info, iconClass: 'text-accent' },
  warning: { icon: AlertTriangle, iconClass: 'text-danger' },
}

const ACTION_LINK_CLASSES =
  'inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface-hover px-3 text-xs font-medium text-text-primary transition-colors hover:bg-surface'

export interface BillingNoticeItem {
  key: string
  notice: BillingNotice
  action?: { href: string; label: string }
}

export function BillingNotices({ items }: { items: BillingNoticeItem[] }) {
  if (items.length === 0) return null

  return (
    <div className="flex flex-col gap-3" data-testid="billing-notices">
      {items.map(({ key, notice, action }) => {
        const { icon: Icon, iconClass } = NOTICE_STYLES[notice.tone]

        return (
          <Card key={key} className={cn('flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between')} role="status">
            <div className="flex items-start gap-3">
              <Icon className={cn('mt-0.5 size-5 shrink-0', iconClass)} aria-hidden />
              <div>
                <p className="text-sm font-semibold text-text-primary">{notice.title}</p>
                <p className="mt-0.5 text-sm text-text-secondary">{notice.description}</p>
              </div>
            </div>
            {action && (
              <Link href={action.href} className={ACTION_LINK_CLASSES}>
                {action.label}
              </Link>
            )}
          </Card>
        )
      })}
    </div>
  )
}
