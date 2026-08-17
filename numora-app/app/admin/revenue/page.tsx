import { TrendingUp } from 'lucide-react'

import { AdminComingSoon } from '@/components/admin/AdminComingSoon'

export default function AdminRevenuePage() {
  return (
    <AdminComingSoon
      title="Receita"
      pageDescription="Receita bruta/líquida, MRR e churn."
      icon={TrendingUp}
      emptyDescription="Sem fonte financeira real ainda — o resumo em /admin já mostra 'Stripe não configurado' em vez de um número fabricado. Esta página ganha conteúdo quando o billing existir."
    />
  )
}
