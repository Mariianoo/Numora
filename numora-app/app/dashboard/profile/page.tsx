/**
 * app/dashboard/profile/page.tsx
 * "Meu Perfil" (Etapa 8.1) — identidade do colecionador. Client Component
 * (mesmo padrão de app/dashboard/collection/page.tsx): busca dados via
 * ProfileRepository/ReferenceRepository no mount, nunca chama Supabase
 * diretamente. Protegida pelo mesmo proxy/layout que cobre
 * /dashboard/:path*.
 *
 * Passport público (Etapa 8.2): o toggle agora é real — ativa/desativa
 * `passport_public` via `profileRepository.setPassportPublic()`. A rota
 * pública é `/passport/[username]`, que nunca consulta `profiles`
 * diretamente: só a RPC `get_public_passport` (`SECURITY DEFINER`,
 * migration `create_get_public_passport_rpc`), testada isoladamente
 * contra o banco antes desta UI existir. Exigir `username` antes de
 * ativar é reforçado em 3 camadas: aqui (UX imediata), no repositório
 * (`setPassportPublic`), e no banco (`CHECK
 * chk_profiles_passport_requires_username`, a garantia real).
 *
 * Etapa 15.9.1-R3: o card "Plano" não lê mais `profile.planTier`
 * (`profiles.plan_tier`, removido de `Profile` — legado, nunca
 * sincronizado). Busca `effectivePlan` via
 * `profileRepository.getOwnEffectivePlan()` (RPC `get_effective_plan()`,
 * Etapa 15.9.1-R2, fonte única courtesy > subscription > free) em paralelo
 * com o resto do carregamento. Mostra o plano (Free/Pro/Premium) sempre
 * pela fonte efetiva e, quando a origem não é o default, um rótulo
 * discreto ("Cortesia"/"Assinatura") — nunca reimplementa a prioridade
 * aqui, só formata (`lib/plans/plan-display.ts`).
 *
 * Etapa "Stripe 5.6 — Customer Portal / Gestão da Assinatura": novo card
 * "Assinatura", inteiramente separado do card "Plano" acima —
 * `ownSubscription` (`getOwnSubscription()` → RPC `get_my_subscription()`)
 * é a assinatura Stripe REAL do usuário, nunca a mesma coisa que
 * `effectivePlan` (que pode estar mostrando uma cortesia sobrepondo essa
 * assinatura real — os dois blocos nunca se confundem, de propósito).
 * Todas as ações (Portal/cancelar/upgrade/downgrade) chamam as rotas
 * próprias do Numora (nunca Supabase direto, nunca o Stripe do browser) e,
 * depois de qualquer uma delas, SEMPRE recarregam `effectivePlan` +
 * `ownSubscription` do zero — a resposta da rota nunca é tratada como
 * definitiva, só o estado canônico recarregado (mesmo princípio de
 * `handleDeleteAccount` abaixo, que também nunca confia em otimismo local).
 */
'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Coins,
  Layers,
  Globe,
  Globe2,
  Gem,
  Wallet,
  Loader2,
  Check,
  Copy,
  TriangleAlert,
  ExternalLink,
  QrCode,
  Lock,
  CreditCard,
  Ban,
  ArrowUpCircle,
  ArrowDownCircle,
} from 'lucide-react'

import { createSupabaseProfileRepository } from '@/features/profile/repositories/profile.repository'
import { createSupabaseReferenceRepository } from '@/features/collection/repositories/reference.repository'
import { createSupabaseAuthRepository } from '@/features/auth/repositories/auth.repository'
import { createSupabaseAdminRepository } from '@/features/admin/repositories/admin.repository'
import type { Profile, EffectivePlan, OwnSubscription, PassportCollectionVisibility } from '@/features/profile/types'
import type { Country } from '@/features/collection/types'
import type { AdminRole } from '@/features/admin/types'
import type { CollectionStats } from '@/lib/stats/collection-stats'
import { formatDateOnly, formatTimestampDate } from '@/lib/format/date'
import { getUserFriendlyErrorMessage } from '@/lib/errors/get-user-friendly-error-message'
import { planLabel, planBadgeTone, planSourceLabel } from '@/lib/plans/plan-display'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { StatCard } from '@/components/ui/StatCard'
import { Avatar } from '@/components/ui/Avatar'
import { ErrorState } from '@/components/ui/ErrorState'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { cn } from '@/components/ui/utils'
import { ConsentPreferencesModal } from '@/components/analytics/ConsentPreferencesModal'
import { PassportShareModal } from '@/components/passport/PassportShareModal'

const PASSPORT_VISIBILITY_LABELS: Record<PassportCollectionVisibility, string> = {
  none: 'Nenhuma moeda individual (só os números-resumo)',
  all: 'Toda a minha coleção',
  selected: 'Somente as moedas que eu marcar',
}

const profileRepository = createSupabaseProfileRepository()
const referenceRepository = createSupabaseReferenceRepository()
const authRepository = createSupabaseAuthRepository()
const adminRepository = createSupabaseAdminRepository()

const DELETE_CONFIRMATION_WORD = 'EXCLUIR'

const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** Etapa "Stripe 5.6" — `ownSubscription.currency` pode ser BRL ou USD (nunca outra, Stripe 5.5/5.6). */
function formatSubscriptionAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat(currency === 'USD' ? 'en-US' : 'pt-BR', { style: 'currency', currency }).format(amount)
}

const INTERVAL_LABELS: Record<string, string> = { month: 'mês', year: 'ano' }

/** Rótulo/tom de badge do status da assinatura — nunca a mesma coisa que o plano efetivo (que já tem seu próprio `planBadgeTone`). */
const SUBSCRIPTION_STATUS_LABELS: Record<string, { label: string; tone: 'neutral' | 'accent' | 'success' | 'danger' }> = {
  trialing: { label: 'Em teste', tone: 'accent' },
  active: { label: 'Ativa', tone: 'success' },
  past_due: { label: 'Pagamento pendente', tone: 'danger' },
  canceled: { label: 'Cancelada', tone: 'neutral' },
  incomplete: { label: 'Pagamento incompleto', tone: 'danger' },
  incomplete_expired: { label: 'Expirada', tone: 'neutral' },
  unpaid: { label: 'Não paga', tone: 'danger' },
  paused: { label: 'Pausada', tone: 'neutral' },
}

const ELIGIBLE_SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due']

export default function ProfilePage() {
  const router = useRouter()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [effectivePlan, setEffectivePlan] = useState<EffectivePlan | null>(null)
  /** Etapa "Stripe 5.6" — nunca a mesma coisa que `effectivePlan` (ver comentário do topo do arquivo). */
  const [ownSubscription, setOwnSubscription] = useState<OwnSubscription | null>(null)
  const [stats, setStats] = useState<CollectionStats | null>(null)
  const [countries, setCountries] = useState<Country[]>([])
  /** Etapa 15.10.18 — mesma fonte de verdade já usada pela Sidebar (`adminRepository.getOwnRole()`), nunca uma segunda definição de owner. Só decide o que a UI mostra; a proteção real continua no servidor (route.ts + RPC). */
  const [ownRole, setOwnRole] = useState<AdminRole | null>(null)

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const [isTogglingPassport, setIsTogglingPassport] = useState(false)
  const [passportError, setPassportError] = useState<string | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [isShareModalOpen, setIsShareModalOpen] = useState(false)
  const [isSavingVisibility, setIsSavingVisibility] = useState(false)
  const [visibilityError, setVisibilityError] = useState<string | null>(null)
  /** F7 (Beta Readiness Audit) — "all" publica toda a coleção ativa de uma vez, então exige confirmação explícita antes da mutação; "none"/"selected" continuam imediatos, como já eram. */
  const [isAllVisibilityConfirmOpen, setIsAllVisibilityConfirmOpen] = useState(false)

  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false)

  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [countryCode, setCountryCode] = useState('')

  /**
   * Etapa 15.10.18 — Zona de perigo (exclusão de conta). `isDeleteDialogOpen`
   * só existe depois que `ownRole` já está resolvido (mesmo gate de
   * `isLoading` da página inteira) — nunca há uma janela em que o botão
   * aparece habilitado antes de saber se o usuário é owner.
   */
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  /** Etapa "Stripe 5.6" — Gerenciar pagamento (Customer Portal). */
  const [isOpeningPortal, setIsOpeningPortal] = useState(false)
  const [portalError, setPortalError] = useState<string | null>(null)

  /** Etapa "Stripe 5.6" — cancelamento (cancel_at_period_end, nunca imediato). */
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false)
  const [isCanceling, setIsCanceling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  /** Etapa "Stripe 5.6" — upgrade Pro→Premium (imediato, com proration). */
  const [isUpgradeDialogOpen, setIsUpgradeDialogOpen] = useState(false)
  const [isUpgrading, setIsUpgrading] = useState(false)
  const [upgradeError, setUpgradeError] = useState<string | null>(null)

  /** Etapa "Stripe 5.6" — downgrade Premium→Pro (agendado via Subscription Schedule). */
  const [isDowngradeDialogOpen, setIsDowngradeDialogOpen] = useState(false)
  const [isDowngrading, setIsDowngrading] = useState(false)
  const [downgradeError, setDowngradeError] = useState<string | null>(null)

  // `isLoading`/`loadError` não são resetados no início de propósito
  // (evita setState síncrono dentro do efeito de montagem abaixo —
  // react-hooks/set-state-in-effect); ver mesmo comentário em
  // app/dashboard/collection/page.tsx.
  const loadProfileData = useCallback(() => {
    return Promise.all([
      profileRepository.getOwnProfile(),
      profileRepository.getOwnEffectivePlan(),
      profileRepository.getOwnSubscription(),
      profileRepository.getOwnStats(),
      referenceRepository.listResidenceCountries(),
      adminRepository.getOwnRole(),
    ])
      .then(([profileResult, effectivePlanResult, ownSubscriptionResult, statsResult, countriesResult, roleResult]) => {
        setProfile(profileResult)
        setEffectivePlan(effectivePlanResult)
        setOwnSubscription(ownSubscriptionResult)
        setStats(statsResult)
        setCountries(countriesResult)
        setOwnRole(roleResult)
        setName(profileResult.name ?? '')
        setUsername(profileResult.username ?? '')
        setCountryCode(profileResult.countryCode ?? '')
        setLoadError(null)
      })
      .catch((err) => setLoadError(getUserFriendlyErrorMessage(err)))
      .finally(() => setIsLoading(false))
  }, [])

  useEffect(() => {
    loadProfileData()
  }, [loadProfileData])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSuccessMessage(null)
    setIsSaving(true)

    try {
      const updated = await profileRepository.updateOwnProfile({
        name: name.trim() === '' ? null : name.trim(),
        username: username.trim() === '' ? null : username,
        countryCode: countryCode === '' ? null : countryCode,
      })
      setProfile(updated)
      setName(updated.name ?? '')
      setUsername(updated.username ?? '')
      setCountryCode(updated.countryCode ?? '')
      setSuccessMessage('Perfil atualizado com sucesso.')
    } catch (err) {
      setError(getUserFriendlyErrorMessage(err))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleTogglePassport() {
    if (!profile) return

    setPassportError(null)
    setLinkCopied(false)

    const nextValue = !profile.passportPublic

    if (nextValue && !profile.username) {
      setPassportError('Defina um nome de usuário antes de ativar seu Passport público.')
      return
    }

    setIsTogglingPassport(true)

    try {
      const updated = await profileRepository.setPassportPublic(nextValue)
      setProfile(updated)
    } catch (err) {
      setPassportError(getUserFriendlyErrorMessage(err))
    } finally {
      setIsTogglingPassport(false)
    }
  }

  function getPassportUrl() {
    if (!profile?.username) return null
    return `${window.location.origin}/passport/${profile.username}`
  }

  function handleCopyPassportLink() {
    const url = getPassportUrl()
    if (!url) return

    navigator.clipboard.writeText(url)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  async function handleChangeCollectionVisibility(value: PassportCollectionVisibility) {
    setVisibilityError(null)
    setIsSavingVisibility(true)

    try {
      const updated = await profileRepository.setPassportCollectionVisibility(value)
      setProfile(updated)
    } catch (err) {
      setVisibilityError(getUserFriendlyErrorMessage(err))
    } finally {
      setIsSavingVisibility(false)
    }
  }

  /**
   * F7 — selecionar "all" no <Select> nunca chama a mutação direto: só
   * abre a confirmação. "none"/"selected" continuam imediatos (não
   * representam publicação ampla — auditoria não encontrou necessidade de
   * confirmação para eles).
   */
  function handleSelectCollectionVisibility(value: PassportCollectionVisibility) {
    if (value === 'all') {
      setVisibilityError(null)
      setIsAllVisibilityConfirmOpen(true)
      return
    }
    handleChangeCollectionVisibility(value)
  }

  function closeAllVisibilityConfirm() {
    if (isSavingVisibility) return
    setIsAllVisibilityConfirmOpen(false)
    setVisibilityError(null)
  }

  /** Mesmo critério de "só fecha ao suceder" já usado por `confirmPublishPhoto` — em erro, o dialog continua aberto mostrando `visibilityError`. */
  async function confirmPublishAllCollection() {
    setVisibilityError(null)
    setIsSavingVisibility(true)

    try {
      const updated = await profileRepository.setPassportCollectionVisibility('all')
      setProfile(updated)
      setIsAllVisibilityConfirmOpen(false)
    } catch (err) {
      setVisibilityError(getUserFriendlyErrorMessage(err))
    } finally {
      setIsSavingVisibility(false)
    }
  }

  /**
   * Etapa 15.10.18 — nunca fecha durante `isDeleting`: a única forma de
   * fechar o Modal compartilhado é via `onClose` (Escape, clique no
   * overlay, botão "Fechar", ou o botão "Cancelar" do footer aqui montado)
   * — todos passam por esta função, então bloquear aqui bloqueia todos,
   * sem precisar alterar `components/ui/Modal.tsx`.
   */
  function closeDeleteDialog() {
    if (isDeleting) return
    setIsDeleteDialogOpen(false)
    setDeleteConfirmationText('')
    setDeleteError(null)
  }

  /**
   * Etapa 15.10.18 — chama exclusivamente POST /api/account/delete, sem
   * body e sem `user_id` (o endpoint identifica o usuário só pela sessão).
   * Depois de um 200 confirmado, a exclusão já aconteceu no servidor —
   * uma falha de `signOut()` local NUNCA é tratada como falha da exclusão
   * (o `catch` é intencionalmente silencioso) e o redirect acontece de
   * qualquer forma, sem espera artificial.
   */
  async function handleDeleteAccount() {
    setDeleteError(null)
    setIsDeleting(true)

    let response: Response
    try {
      response = await fetch('/api/account/delete', { method: 'POST' })
    } catch {
      setDeleteError('Não foi possível excluir sua conta agora. Tente novamente.')
      setIsDeleting(false)
      return
    }

    const body: { success?: boolean; error?: string } | null = await response.json().catch(() => null)

    if (!response.ok || !body?.success) {
      if (response.status === 401) {
        setIsDeleteDialogOpen(false)
        router.replace('/login')
        router.refresh()
        return
      }

      setDeleteError(body?.error ?? 'Não foi possível excluir sua conta agora. Tente novamente.')
      setIsDeleting(false)
      return
    }

    try {
      await authRepository.signOut()
    } catch {
      // Nunca tratado como falha da exclusão — a conta já foi removida no servidor.
    }

    router.replace('/')
    router.refresh()
  }

  /**
   * Etapa "Stripe 5.6" FASE 13 — nunca confia na resposta de uma rota de
   * billing para declarar o estado local: toda ação recarrega
   * `effectivePlan`/`ownSubscription` do zero via as mesmas RPCs do
   * carregamento inicial (que por sua vez sempre refletem o que o
   * Subscription Sync/webhook já persistiu, chamado de forma eager pela
   * própria rota antes de responder — ver relatório da etapa).
   */
  async function reloadSubscriptionState() {
    const [effectivePlanResult, ownSubscriptionResult] = await Promise.all([profileRepository.getOwnEffectivePlan(), profileRepository.getOwnSubscription()])
    setEffectivePlan(effectivePlanResult)
    setOwnSubscription(ownSubscriptionResult)
  }

  async function handleOpenPortal() {
    setPortalError(null)
    setIsOpeningPortal(true)

    try {
      const response = await fetch('/api/billing/portal', { method: 'POST' })
      const body: { url?: string; error?: string } | null = await response.json().catch(() => null)

      if (!response.ok || !body?.url) {
        setPortalError(body?.error ?? 'Não foi possível abrir o portal de cobrança agora. Tente novamente.')
        return
      }

      window.location.href = body.url
    } catch {
      setPortalError('Não foi possível abrir o portal de cobrança agora. Tente novamente.')
    } finally {
      setIsOpeningPortal(false)
    }
  }

  async function handleCancelSubscription() {
    setCancelError(null)
    setIsCanceling(true)

    try {
      const response = await fetch('/api/billing/subscription/cancel', { method: 'POST' })
      const body: { success?: boolean; error?: string } | null = await response.json().catch(() => null)

      if (!response.ok || !body?.success) {
        setCancelError(body?.error ?? 'Não foi possível cancelar sua assinatura agora. Tente novamente.')
        return
      }

      await reloadSubscriptionState()
      setIsCancelDialogOpen(false)
    } catch {
      setCancelError('Não foi possível cancelar sua assinatura agora. Tente novamente.')
    } finally {
      setIsCanceling(false)
    }
  }

  async function handleUpgradeToPremium() {
    if (!ownSubscription) return
    setUpgradeError(null)
    setIsUpgrading(true)

    try {
      const response = await fetch('/api/billing/subscription/change-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planSlug: 'premium', interval: ownSubscription.interval, currency: ownSubscription.currency }),
      })
      const body: { kind?: string; error?: string } | null = await response.json().catch(() => null)

      if (!response.ok || !body?.kind) {
        setUpgradeError(body?.error ?? 'Não foi possível concluir o upgrade agora. Tente novamente.')
        return
      }

      await reloadSubscriptionState()
      setIsUpgradeDialogOpen(false)
    } catch {
      setUpgradeError('Não foi possível concluir o upgrade agora. Tente novamente.')
    } finally {
      setIsUpgrading(false)
    }
  }

  async function handleDowngradeToPro() {
    if (!ownSubscription) return
    setDowngradeError(null)
    setIsDowngrading(true)

    try {
      const response = await fetch('/api/billing/subscription/change-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planSlug: 'pro', interval: ownSubscription.interval, currency: ownSubscription.currency }),
      })
      const body: { kind?: string; error?: string } | null = await response.json().catch(() => null)

      if (!response.ok || !body?.kind) {
        setDowngradeError(body?.error ?? 'Não foi possível agendar o downgrade agora. Tente novamente.')
        return
      }

      await reloadSubscriptionState()
      setIsDowngradeDialogOpen(false)
    } catch {
      setDowngradeError('Não foi possível agendar o downgrade agora. Tente novamente.')
    } finally {
      setIsDowngrading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-text-secondary" aria-hidden />
      </div>
    )
  }

  if (loadError || !profile) {
    return (
      <ErrorState
        title="Não foi possível carregar seu perfil"
        description={loadError ?? undefined}
        actionLabel="Tentar novamente"
        onAction={loadProfileData}
      />
    )
  }

  const avatarLabel = profile.name?.trim() || profile.email?.split('@')[0] || '?'

  return (
    <div className="flex flex-col gap-10">
      <PageHeader title="Meu Perfil" description="Gerencie sua identidade no Numora." />

      <section className="flex flex-col gap-4">
        <p className="text-[11px] font-semibold tracking-wider text-text-secondary/60 uppercase">
          Identidade e conta
        </p>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="p-6 lg:col-span-2">
            <h2 className="text-base font-semibold text-text-primary">Identidade</h2>

            <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <Avatar name={avatarLabel} size="md" />
                <div>
                  <p className="text-sm font-medium text-text-primary">Foto do perfil</p>
                  <Badge tone="neutral" className="mt-1">
                    Em breve
                  </Badge>
                </div>
              </div>

              <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} />

              <Input
                label="Nome de usuário"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ex.: joao_colecionador"
              />

              <Select label="País" value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
                <option value="">Selecione...</option>
                {countries.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.flagEmoji ? `${country.flagEmoji} ` : ''}
                    {country.name}
                  </option>
                ))}
              </Select>

              <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
                <div>
                  <p className="text-xs text-text-secondary">Numora ID</p>
                  <p className="text-sm font-medium text-text-primary">{profile.numoraId}</p>
                </div>
                <div>
                  <p className="text-xs text-text-secondary">Colecionador desde</p>
                  <p className="text-sm font-medium text-text-primary">{formatDateOnly(profile.collectorSince)}</p>
                </div>
              </div>

              {error && <p className="text-sm text-danger">{error}</p>}
              {successMessage && <p className="text-sm text-success">{successMessage}</p>}

              <Button type="submit" isLoading={isSaving} className="mt-1 sm:w-fit">
                {isSaving ? 'Salvando...' : 'Salvar alterações'}
              </Button>
            </form>
          </Card>

          <div className="flex flex-col gap-6">
            <Card className="p-6">
              <h2 className="text-base font-semibold text-text-primary">Conta</h2>
              <div className="mt-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-text-secondary">Plano</p>
                  <div className="flex items-center gap-1.5">
                    {effectivePlan && planSourceLabel(effectivePlan.source) && (
                      <Badge tone="neutral">{planSourceLabel(effectivePlan.source)}</Badge>
                    )}
                    <Badge tone={effectivePlan ? planBadgeTone(effectivePlan.planSlug) : 'neutral'}>
                      {effectivePlan ? planLabel(effectivePlan.planSlug) : '—'}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-text-secondary">Membro desde</p>
                  <p className="text-sm text-text-primary">{formatTimestampDate(profile.createdAt)}</p>
                </div>
              </div>
            </Card>

            {ownSubscription && (
              <Card className="p-6">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-text-primary">Assinatura</h2>
                  <Badge tone={SUBSCRIPTION_STATUS_LABELS[ownSubscription.status]?.tone ?? 'neutral'}>
                    {SUBSCRIPTION_STATUS_LABELS[ownSubscription.status]?.label ?? ownSubscription.status}
                  </Badge>
                </div>

                <div className="mt-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-text-secondary">Plano</p>
                    <p className="text-sm font-medium text-text-primary">{ownSubscription.planName}</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-text-secondary">Valor</p>
                    <p className="text-sm text-text-primary">
                      {formatSubscriptionAmount(ownSubscription.amount, ownSubscription.currency)} / {INTERVAL_LABELS[ownSubscription.interval] ?? ownSubscription.interval}
                    </p>
                  </div>
                  {ELIGIBLE_SUBSCRIPTION_STATUSES.includes(ownSubscription.status) && ownSubscription.currentPeriodEnd && (
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-text-secondary">{ownSubscription.cancelAtPeriodEnd ? 'Acesso até' : 'Próxima cobrança'}</p>
                      <p className="text-sm text-text-primary">{formatTimestampDate(ownSubscription.currentPeriodEnd)}</p>
                    </div>
                  )}
                  {ownSubscription.status === 'canceled' && ownSubscription.canceledAt && (
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-text-secondary">Cancelada em</p>
                      <p className="text-sm text-text-primary">{formatTimestampDate(ownSubscription.canceledAt)}</p>
                    </div>
                  )}
                </div>

                {ownSubscription.cancelAtPeriodEnd && (
                  <p className="mt-4 flex items-start gap-2 rounded-lg bg-danger/10 p-3 text-sm text-danger">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    Sua assinatura foi cancelada e não será renovada — você mantém acesso ao plano {ownSubscription.planName} até{' '}
                    {ownSubscription.currentPeriodEnd ? formatTimestampDate(ownSubscription.currentPeriodEnd) : 'o fim do período já pago'}.
                  </p>
                )}

                {ownSubscription.scheduledPlanSlug && (
                  <p className="mt-4 flex items-start gap-2 rounded-lg bg-accent/10 p-3 text-sm text-accent">
                    <ArrowDownCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    Downgrade agendado: você passa para o plano {ownSubscription.scheduledPlanName} a partir de{' '}
                    {ownSubscription.currentPeriodEnd ? formatTimestampDate(ownSubscription.currentPeriodEnd) : 'o fim do período atual'}. Até lá, continua com {ownSubscription.planName}.
                  </p>
                )}

                {portalError && <p className="mt-4 text-sm text-danger">{portalError}</p>}

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" onClick={handleOpenPortal} isLoading={isOpeningPortal}>
                    <CreditCard className="size-4" aria-hidden />
                    Gerenciar pagamento
                  </Button>

                  {ELIGIBLE_SUBSCRIPTION_STATUSES.includes(ownSubscription.status) && !ownSubscription.cancelAtPeriodEnd && (
                    <Button type="button" variant="secondary" onClick={() => setIsCancelDialogOpen(true)}>
                      <Ban className="size-4" aria-hidden />
                      Cancelar assinatura
                    </Button>
                  )}

                  {ELIGIBLE_SUBSCRIPTION_STATUSES.includes(ownSubscription.status) && !ownSubscription.scheduledPlanSlug && ownSubscription.planSlug === 'pro' && (
                    <Button type="button" variant="secondary" onClick={() => setIsUpgradeDialogOpen(true)}>
                      <ArrowUpCircle className="size-4" aria-hidden />
                      Fazer upgrade para Premium
                    </Button>
                  )}

                  {ELIGIBLE_SUBSCRIPTION_STATUSES.includes(ownSubscription.status) && !ownSubscription.scheduledPlanSlug && ownSubscription.planSlug === 'premium' && (
                    <Button type="button" variant="secondary" onClick={() => setIsDowngradeDialogOpen(true)}>
                      <ArrowDownCircle className="size-4" aria-hidden />
                      Fazer downgrade para Pro
                    </Button>
                  )}
                </div>
              </Card>
            )}

            <Card className="p-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-text-primary">Passport público</h2>
                  <Badge tone={profile.passportPublic ? 'success' : 'neutral'}>
                    {profile.passportPublic ? 'Ativo' : 'Privado'}
                  </Badge>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={profile.passportPublic}
                  aria-label="Ativar Passport público"
                  onClick={handleTogglePassport}
                  disabled={isTogglingPassport}
                  className={cn(
                    'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    profile.passportPublic ? 'bg-accent' : 'bg-surface-hover',
                  )}
                >
                  <span
                    className={cn(
                      'inline-block size-4 rounded-full bg-background transition-transform',
                      profile.passportPublic ? 'translate-x-6' : 'translate-x-1',
                    )}
                  />
                </button>
              </div>

              <p className="mt-3 text-sm text-text-secondary">
                O Passport é a identidade pública do seu colecionismo: um cartão com seu nome, país, tempo de
                coleção e os números-resumo (moedas, unidades, países, metais) — nunca preço, custo ou e-mail.
              </p>

              {!profile.username && (
                <p className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-text-secondary">
                  <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
                  Defina um nome de usuário no formulário ao lado antes de ativar o Passport público.
                </p>
              )}

              {passportError && <p className="mt-2 text-sm text-danger">{passportError}</p>}

              {profile.passportPublic && profile.username ? (
                <div className="mt-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
                    <p className="truncate text-sm text-text-secondary">/passport/{profile.username}</p>
                    <Button type="button" variant="ghost" size="sm" onClick={handleCopyPassportLink}>
                      {linkCopied ? (
                        <>
                          <Check className="size-4" aria-hidden />
                          Copiado
                        </>
                      ) : (
                        <>
                          <Copy className="size-4" aria-hidden />
                          Copiar
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="flex gap-2">
                    <Link href={`/passport/${profile.username}`} target="_blank" rel="noopener noreferrer" className="flex-1">
                      <Button type="button" className="w-full">
                        <ExternalLink className="size-4" aria-hidden />
                        Ver meu Passport
                      </Button>
                    </Link>
                    <Button type="button" variant="secondary" onClick={() => setIsShareModalOpen(true)}>
                      <QrCode className="size-4" aria-hidden />
                      QR Code
                    </Button>
                  </div>

                  <div className="border-t border-border pt-3">
                    <Select
                      label="Moedas visíveis no Passport"
                      value={profile.passportCollectionVisibility}
                      disabled={isSavingVisibility}
                      onChange={(e) =>
                        handleSelectCollectionVisibility(e.target.value as PassportCollectionVisibility)
                      }
                    >
                      {(Object.keys(PASSPORT_VISIBILITY_LABELS) as PassportCollectionVisibility[]).map((value) => (
                        <option key={value} value={value}>
                          {PASSPORT_VISIBILITY_LABELS[value]}
                        </option>
                      ))}
                    </Select>
                    <p className="mt-1.5 text-xs text-text-secondary">
                      {profile.passportCollectionVisibility === 'selected'
                        ? 'Marque as moedas em "Minha Coleção" para escolher quais aparecem.'
                        : 'Os números-resumo da coleção aparecem sempre, em qualquer opção.'}
                    </p>
                    {visibilityError && <p className="mt-1.5 text-sm text-danger">{visibilityError}</p>}
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-xs text-text-secondary">
                  Quando ativado, seu perfil fica acessível para qualquer pessoa com o link — nunca aparece em
                  buscas externas por padrão. Você pode desativar a qualquer momento.
                </p>
              )}
            </Card>

            <Card className="p-6">
              <h2 className="text-base font-semibold text-text-primary">Privacidade</h2>
              <p className="mt-2 text-sm text-text-secondary">
                Controle o que o Numora pode usar para analytics e para identificar a origem de cadastros.
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-4"
                onClick={() => setIsPreferencesOpen(true)}
              >
                Gerenciar preferências de cookies
              </Button>
            </Card>
          </div>
        </div>
      </section>

      <ConsentPreferencesModal isOpen={isPreferencesOpen} onClose={() => setIsPreferencesOpen(false)} />

      {profile.passportPublic && profile.username && (
        <PassportShareModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          url={getPassportUrl() ?? ''}
        />
      )}

      {/*
        F7 (Beta Readiness Audit) — confirmação explícita antes de publicar
        toda a coleção ("all"), mesmo padrão do ConfirmDialog de publicação
        de foto em app/dashboard/collection/page.tsx: só fecha ao suceder,
        erro aparece dentro do próprio dialog. "none"/"selected" continuam
        sem confirmação — não representam publicação ampla.
      */}
      <ConfirmDialog
        isOpen={isAllVisibilityConfirmOpen}
        onClose={closeAllVisibilityConfirm}
        onConfirm={confirmPublishAllCollection}
        title="Publicar toda a coleção?"
        description="Isso tornará públicas todas as moedas ativas da sua coleção no seu Passport — não só os números-resumo."
        icon={Globe}
        confirmLabel="Publicar coleção"
        isLoading={isSavingVisibility}
        error={visibilityError}
      >
        <p className="text-xs text-text-secondary">
          Cada moeda aparece com denominação, país, ano e metal — nunca preço, custo ou dados pessoais. As fotos
          continuam privadas até você publicá-las individualmente. Você pode voltar para uma visibilidade mais
          restrita a qualquer momento.
        </p>
      </ConfirmDialog>

      {/* Etapa "Stripe 5.6" — cancelamento agenda cancel_at_period_end, nunca cancela imediatamente; por isso `isDestructive={false}` (o acesso continua até o fim do período já pago). */}
      {ownSubscription && (
        <ConfirmDialog
          isOpen={isCancelDialogOpen}
          onClose={() => {
            if (isCanceling) return
            setIsCancelDialogOpen(false)
            setCancelError(null)
          }}
          onConfirm={handleCancelSubscription}
          title="Cancelar assinatura?"
          description={`Você continua com acesso ao plano ${ownSubscription.planName} até ${ownSubscription.currentPeriodEnd ? formatTimestampDate(ownSubscription.currentPeriodEnd) : 'o fim do período já pago'}. Depois disso, sua conta volta para o plano Free.`}
          icon={Ban}
          confirmLabel="Cancelar assinatura"
          cancelLabel="Manter assinatura"
          isLoading={isCanceling}
          error={cancelError}
        />
      )}

      {ownSubscription && (
        <ConfirmDialog
          isOpen={isUpgradeDialogOpen}
          onClose={() => {
            if (isUpgrading) return
            setIsUpgradeDialogOpen(false)
            setUpgradeError(null)
          }}
          onConfirm={handleUpgradeToPremium}
          title="Fazer upgrade para Premium?"
          description="O upgrade é imediato — você é cobrado agora pela diferença proporcional ao tempo restante do ciclo atual, e passa a ter acesso ao Premium na hora."
          icon={ArrowUpCircle}
          confirmLabel="Confirmar upgrade"
          isLoading={isUpgrading}
          error={upgradeError}
        />
      )}

      {ownSubscription && (
        <ConfirmDialog
          isOpen={isDowngradeDialogOpen}
          onClose={() => {
            if (isDowngrading) return
            setIsDowngradeDialogOpen(false)
            setDowngradeError(null)
          }}
          onConfirm={handleDowngradeToPro}
          title="Fazer downgrade para Pro?"
          description={`Você continua com todos os benefícios do Premium até ${ownSubscription.currentPeriodEnd ? formatTimestampDate(ownSubscription.currentPeriodEnd) : 'o fim do período atual'} — a troca para o Pro só acontece depois disso, sem nenhuma cobrança adicional agora.`}
          icon={ArrowDownCircle}
          confirmLabel="Agendar downgrade"
          isLoading={isDowngrading}
          error={downgradeError}
        />
      )}

      <section className="flex flex-col gap-4">
        <p className="text-[11px] font-semibold tracking-wider text-text-secondary/60 uppercase">Estatísticas</p>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <StatCard icon={Coins} label="Moedas" value={String(stats?.totalItems ?? 0)} />
          <StatCard icon={Layers} label="Unidades" value={String(stats?.totalUnits ?? 0)} />
          <StatCard icon={Globe2} label="Países" value={String(stats?.countryCount ?? 0)} />
          <StatCard icon={Gem} label="Metais" value={String(stats?.metalCount ?? 0)} />
          <StatCard
            icon={Wallet}
            label="Total investido"
            value={currencyFormatter.format(stats?.totalInvested ?? 0)}
          />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <p className="text-[11px] font-semibold tracking-wider text-danger/70 uppercase">Zona de perigo</p>
        <Card className="border-danger/30 p-6">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger">
              <TriangleAlert className="size-[18px]" aria-hidden />
            </div>
            <div className="flex-1">
              <h2 className="text-base font-semibold text-text-primary">Excluir minha conta</h2>
              <p className="mt-2 text-sm text-text-secondary">
                Remove permanentemente seu perfil, suas moedas e exemplares, as imagens da sua coleção,
                seu Passport público e os demais dados vinculados à conta (compras, vendas e atribuição).
                Esta ação é permanente e não pode ser desfeita.
              </p>

              {ownRole === 'owner' && (
                <p className="mt-4 text-sm text-text-secondary">
                  Contas com papel de proprietário da plataforma não podem ser excluídas por este fluxo.
                </p>
              )}

              <Button
                type="button"
                variant="danger"
                className="mt-4"
                disabled={ownRole === 'owner'}
                onClick={() => setIsDeleteDialogOpen(true)}
              >
                Excluir minha conta
              </Button>
            </div>
          </div>
        </Card>
      </section>

      {/*
        Etapa 15.10.18 — `Modal` usado diretamente (não `ConfirmDialog`):
        `ConfirmDialog` não expõe uma forma de desabilitar o botão de
        confirmação além de `isLoading` (ver components/ui/ConfirmDialog.tsx)
        — esta confirmação precisa ficar desabilitada até o texto digitado
        bater exatamente com "EXCLUIR", uma condição extra que o wrapper
        não suporta. Adicionar isso ao ConfirmDialog estaria fora do escopo
        autorizado desta etapa, então o footer é montado aqui, sobre o
        mesmo `Modal` compartilhado (foco/Escape/Tab-trap idênticos), sem
        alterar nenhum arquivo fora de app/dashboard/profile/page.tsx.
      */}
      <Modal
        isOpen={isDeleteDialogOpen}
        onClose={closeDeleteDialog}
        title="Excluir minha conta"
        description="Esta ação é permanente e não pode ser desfeita."
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeDeleteDialog} disabled={isDeleting}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleDeleteAccount}
              isLoading={isDeleting}
              disabled={deleteConfirmationText !== DELETE_CONFIRMATION_WORD}
            >
              Excluir permanentemente
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex size-10 items-center justify-center rounded-full bg-danger/10 text-danger">
            <TriangleAlert className="size-5" aria-hidden />
          </div>
          <p className="text-sm font-medium text-danger">Todos os seus dados serão removidos definitivamente.</p>
          <p className="text-sm text-text-secondary">
            Para confirmar, digite <span className="font-semibold text-text-primary">EXCLUIR</span> abaixo.
          </p>
          <Input
            label="Confirmação"
            value={deleteConfirmationText}
            onChange={(e) => setDeleteConfirmationText(e.target.value)}
            disabled={isDeleting}
            autoComplete="off"
          />
          {deleteError && <p className="text-sm text-danger">{deleteError}</p>}
        </div>
      </Modal>
    </div>
  )
}
