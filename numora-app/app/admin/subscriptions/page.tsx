import { CreditCard } from 'lucide-react'

import { AdminComingSoon } from '@/components/admin/AdminComingSoon'

export default function AdminSubscriptionsPage() {
  return (
    <AdminComingSoon
      title="Assinaturas"
      pageDescription="Gestão de assinaturas ativas, canceladas e em trial."
      icon={CreditCard}
      emptyDescription="Depende do Stripe Billing, que não foi integrado nesta etapa (Etapa 15.3 — Admin Control Center). A fundação de planos (plans/plan_features) já existe."
    />
  )
}
