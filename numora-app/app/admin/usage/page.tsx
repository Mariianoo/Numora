import { BarChart3 } from 'lucide-react'

import { AdminComingSoon } from '@/components/admin/AdminComingSoon'

export default function AdminUsagePage() {
  return (
    <AdminComingSoon
      title="Utilização"
      pageDescription="Tendências de uso ao longo do tempo."
      icon={BarChart3}
      emptyDescription="As métricas agregadas atuais (membros, moedas, exemplares, compras, Passports, imagens) já estão na Visão geral (/admin). Esta página é reservada para séries históricas/tendências, quando houver um mecanismo de coleta ao longo do tempo."
    />
  )
}
