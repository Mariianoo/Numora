import { Settings } from 'lucide-react'

import { AdminComingSoon } from '@/components/admin/AdminComingSoon'

export default function AdminSettingsPage() {
  return (
    <AdminComingSoon
      title="Configurações"
      pageDescription="Parâmetros administrativos da plataforma."
      icon={Settings}
      emptyDescription="Reservado para configurações administrativas futuras (ex.: feature flags, quando houver um consumidor real no código)."
    />
  )
}
