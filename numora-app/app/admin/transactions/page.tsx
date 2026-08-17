import { Receipt } from 'lucide-react'

import { AdminComingSoon } from '@/components/admin/AdminComingSoon'

export default function AdminTransactionsPage() {
  return (
    <AdminComingSoon
      title="Transações"
      pageDescription="Histórico de pagamentos processados pela plataforma."
      icon={Receipt}
      emptyDescription="Depende do Stripe Billing/Connect, que não foram integrados nesta etapa. Nenhuma transação é simulada."
    />
  )
}
