import { Bell } from 'lucide-react'

import { AdminComingSoon } from '@/components/admin/AdminComingSoon'

export default function AdminAlertsPage() {
  return (
    <AdminComingSoon
      title="Alertas"
      pageDescription="Avisos operacionais derivados de dados reais."
      icon={Bell}
      emptyDescription="Nenhum alerta é inventado. Candidatos reais para uma próxima etapa: cortesias próximas do vencimento (já derivável de benefit_grants.expires_at) e falhas de pagamento (dependem do Stripe)."
    />
  )
}
