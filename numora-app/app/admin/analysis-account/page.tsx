/**
 * app/admin/analysis-account/page.tsx
 * Etapa "5.10W.4 — Conta de Análise: Painel Administrativo" — permite ao
 * Owner controlar a Conta de Análise (plano simulado + dataset fictício)
 * usando exclusivamente as RPCs já auditadas (W.1/W.2/W.3/W.4) via
 * `AnalysisAccountRepository` — nenhuma regra de plano/dataset
 * reimplementada em TypeScript, nenhuma escrita direta em
 * `benefit_grants`/`collection_items`/`purchases`.
 *
 * Leitura (`getState()`) é permitida para Admin OU Owner (mesmo nível de
 * `internal_test_accounts_select_admin`/`get_analysis_account_dataset_summary`,
 * banco). Escrita (troca de plano/popular/resetar) é gated no CLIENT por
 * `isOwner` (`AdminRepository.getOwnRole()`, já existente, mesmo padrão de
 * `/admin/members`) — só UX: a barreira REAL continua sendo
 * `is_platform_owner()` dentro de cada RPC, nunca esta checagem.
 *
 * SEM impersonation: nenhum mecanismo de "entrar como" é oferecido — só
 * uma nota informativa (seção "Identificação da conta") apontando que o
 * acesso é feito com as credenciais próprias da Conta de Análise. Nenhuma
 * senha/credencial é armazenada, lida ou exibida por esta página.
 *
 * Indicador "🧪 CONTA DE ANÁLISE" aparece SOMENTE aqui (Etapa 5.10W.4,
 * seção 8) — nenhum banner global no dashboard da própria conta nesta
 * etapa (fica para uma etapa futura).
 */
'use client'

import { useCallback, useEffect, useState } from 'react'
import { FlaskConical, RotateCcw, Sparkles } from 'lucide-react'

import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ErrorState } from '@/components/ui/ErrorState'
import { EmptyState } from '@/components/ui/EmptyState'
import { createSupabaseAdminRepository } from '@/features/admin/repositories/admin.repository'
import {
  createSupabaseAnalysisAccountRepository,
  type AnalysisAccountPlanSlug,
  type AnalysisAccountState,
} from '@/features/admin/repositories/analysis-account.repository'
import { getUserFriendlyErrorMessage } from '@/lib/errors/get-user-friendly-error-message'
import type { AdminRole } from '@/features/admin/types'

const adminRepository = createSupabaseAdminRepository()
const analysisAccountRepository = createSupabaseAnalysisAccountRepository()

const PLAN_LABELS: Record<AnalysisAccountPlanSlug, string> = { free: 'Free', pro: 'Pro', premium: 'Premium' }
const PLAN_OPTIONS: AnalysisAccountPlanSlug[] = ['free', 'pro', 'premium']

/**
 * Traduz os erros CONHECIDOS das RPCs desta etapa — já são mensagens
 * amigáveis em português na origem, mas `getUserFriendlyErrorMessage`
 * trataria `[AnalysisAccountRepository] Falha ao X: <mensagem>` como
 * técnico (por conter ": " após o prefixo) e cairia no fallback genérico.
 * Reconhece os casos explicitamente pedidos (não autorizado / não é Conta
 * de Análise / nenhuma Conta de Análise); qualquer erro NÃO reconhecido
 * cai no tradutor genérico já existente — nunca SQL bruto, nunca nome de
 * constraint, nunca stack trace.
 */
function friendlyAnalysisAccountError(err: unknown): string {
  const message = err instanceof Error ? err.message : ''

  if (message.includes('Somente o owner pode')) {
    return 'Você não tem permissão para alterar a Conta de Análise — apenas o owner pode fazer isso.'
  }
  if (message.includes('não é uma Conta de Análise')) {
    return 'Este usuário não é uma Conta de Análise configurada.'
  }
  if (message.includes('Nenhuma Conta de Análise configurada')) {
    return 'Nenhuma Conta de Análise foi configurada ainda.'
  }

  return getUserFriendlyErrorMessage(err)
}

export default function AnalysisAccountPage() {
  const [role, setRole] = useState<AdminRole | null>(null)
  const isOwner = role === 'owner'

  const [state, setState] = useState<AnalysisAccountState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [switchingPlan, setSwitchingPlan] = useState<AnalysisAccountPlanSlug | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)

  const [isPopulating, setIsPopulating] = useState(false)
  const [populateMessage, setPopulateMessage] = useState<string | null>(null)
  const [populateError, setPopulateError] = useState<string | null>(null)

  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  // Encadeamento `.then()` (não async/await) de propósito — mesmo padrão
  // já usado em app/dashboard/collection/page.tsx (`loadCollectionData`):
  // evita react-hooks/set-state-in-effect quando chamada diretamente pelo
  // useEffect de montagem abaixo.
  const loadState = useCallback(() => {
    return Promise.resolve()
      .then(() => {
        setIsLoading(true)
        setLoadError(null)
        return analysisAccountRepository.getState()
      })
      .then((result) => setState(result))
      .catch((err) => setLoadError(friendlyAnalysisAccountError(err)))
      .finally(() => setIsLoading(false))
  }, [])

  useEffect(() => {
    adminRepository
      .getOwnRole()
      .then(setRole)
      .catch(() => setRole(null))
  }, [])

  useEffect(() => {
    loadState()
  }, [loadState])

  async function handleSwitchPlan(plan: AnalysisAccountPlanSlug) {
    if (switchingPlan !== null) return
    setPlanError(null)
    setSwitchingPlan(plan)
    try {
      await analysisAccountRepository.switchPlan(plan)
      await loadState()
    } catch (err) {
      setPlanError(friendlyAnalysisAccountError(err))
    } finally {
      setSwitchingPlan(null)
    }
  }

  async function handlePopulate() {
    if (isPopulating) return
    setPopulateError(null)
    setPopulateMessage(null)
    setIsPopulating(true)
    try {
      const result = await analysisAccountRepository.populateDataset()
      setPopulateMessage(
        result.populated
          ? `Dataset de demonstração criado com ${result.itemCount} itens.`
          : `Os dados de demonstração já existem (${result.itemCount} itens) — nada foi duplicado.`,
      )
      await loadState()
    } catch (err) {
      setPopulateError(friendlyAnalysisAccountError(err))
    } finally {
      setIsPopulating(false)
    }
  }

  async function handleReset() {
    setResetError(null)
    setIsResetting(true)
    try {
      await analysisAccountRepository.resetDataset()
      setIsResetConfirmOpen(false)
      setPopulateMessage(null)
      await loadState()
    } catch (err) {
      setResetError(friendlyAnalysisAccountError(err))
    } finally {
      setIsResetting(false)
    }
  }

  const currentPlanLabel = state ? (PLAN_LABELS[state.planSlug as AnalysisAccountPlanSlug] ?? state.planSlug) : null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="🧪 Conta de Análise"
        description="Use esta conta para validar a experiência dos planos Free, Pro e Premium com dados fictícios."
      />

      {isLoading ? (
        <Card className="p-6 text-sm text-text-secondary">Carregando...</Card>
      ) : loadError ? (
        <ErrorState
          title="Não foi possível carregar a Conta de Análise"
          description={loadError}
          actionLabel="Tentar novamente"
          onAction={loadState}
        />
      ) : state === null ? (
        <EmptyState
          icon={FlaskConical}
          title="Nenhuma Conta de Análise configurada"
          description="Configure uma Conta de Análise (internal_test_accounts) para usar este painel."
        />
      ) : (
        <>
          {/* Indicador — só nesta página (Etapa 5.10W.4, seção 8). */}
          <Card className="flex flex-col gap-1.5 border-accent/30 bg-accent/5 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-accent">
              <FlaskConical className="size-4" aria-hidden />
              CONTA DE ANÁLISE
            </div>
            <p className="text-sm text-text-secondary">
              Plano simulado: <span className="font-semibold text-text-primary">{currentPlanLabel}</span>
            </p>
            <p className="text-xs text-text-secondary">Esta conta não representa uma assinatura ou pagamento real.</p>
          </Card>

          <Card className="flex flex-col gap-4 p-5">
            <h2 className="text-sm font-semibold text-text-primary">Plano simulado</h2>
            <div className="flex flex-wrap gap-2">
              {PLAN_OPTIONS.map((plan) => (
                <Button
                  key={plan}
                  type="button"
                  variant={state.planSlug === plan ? 'primary' : 'secondary'}
                  onClick={() => handleSwitchPlan(plan)}
                  isLoading={switchingPlan === plan}
                  disabled={!isOwner || switchingPlan !== null || state.planSlug === plan}
                >
                  {PLAN_LABELS[plan]}
                </Button>
              ))}
            </div>
            {!isOwner && <p className="text-xs text-text-secondary">Somente o owner pode alterar o plano.</p>}
            {planError && <p className="text-sm text-danger">{planError}</p>}
          </Card>

          <Card className="flex flex-col gap-3 p-5">
            <h2 className="text-sm font-semibold text-text-primary">Dataset de demonstração</h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-text-secondary">Itens</p>
                <p className="text-lg font-semibold text-text-primary">{state.itemCount}</p>
              </div>
              <div>
                <p className="text-xs text-text-secondary">Países</p>
                <p className="text-lg font-semibold text-text-primary">{state.countryCount}</p>
              </div>
              <div>
                <p className="text-xs text-text-secondary">Compras</p>
                <p className="text-lg font-semibold text-text-primary">{state.purchaseCount}</p>
              </div>
            </div>
          </Card>

          <Card className="flex flex-col gap-3 p-5">
            <h2 className="text-sm font-semibold text-text-primary">Ações</h2>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={handlePopulate} isLoading={isPopulating} disabled={!isOwner || isPopulating}>
                <Sparkles className="size-4" aria-hidden />
                Popular dados de demonstração
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => setIsResetConfirmOpen(true)}
                disabled={!isOwner || state.itemCount === 0}
              >
                <RotateCcw className="size-4" aria-hidden />
                Resetar dados de demonstração
              </Button>
            </div>
            {!isOwner && <p className="text-xs text-text-secondary">Somente o owner pode popular ou resetar o dataset.</p>}
            {populateMessage && <p className="text-sm text-success">{populateMessage}</p>}
            {populateError && <p className="text-sm text-danger">{populateError}</p>}
          </Card>

          <Card className="flex flex-col gap-2 p-5">
            <h2 className="text-sm font-semibold text-text-primary">Identificação da conta</h2>
            <Badge tone="accent" className="w-fit">
              Conta interna de análise
            </Badge>
            <p className="text-xs text-text-secondary">
              Use as credenciais próprias da Conta de Análise para acessar a experiência de usuário.
            </p>
          </Card>
        </>
      )}

      <ConfirmDialog
        isOpen={isResetConfirmOpen}
        onClose={() => setIsResetConfirmOpen(false)}
        onConfirm={handleReset}
        title="Resetar dados de demonstração"
        description="Isso removerá a coleção fictícia, compras, composição e dados relacionados da Conta de Análise. A conta, o plano e as configurações administrativas serão preservados."
        confirmLabel="Resetar"
        icon={RotateCcw}
        isDestructive
        isLoading={isResetting}
        error={resetError}
      />
    </div>
  )
}
