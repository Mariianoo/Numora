/**
 * app/dashboard/profile/page.tsx
 * "Meu Perfil" (Etapa 8.1) — identidade do colecionador. Client Component
 * (mesmo padrão de app/dashboard/collection/page.tsx): busca dados via
 * ProfileRepository/ReferenceRepository no mount, nunca chama Supabase
 * diretamente. Protegida pelo mesmo proxy/layout que cobre
 * /dashboard/:path*.
 *
 * Passport público: o toggle aparece desabilitado de propósito — a rota
 * pública (/passport/[username]) e a RLS que permitiria leitura pública
 * de profiles ainda não existem (ver análise da Etapa 8). Habilitar o
 * toggle agora criaria um estado no banco ("meu Passport é público") sem
 * nenhuma superfície pública para honrá-lo.
 */
'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Coins, Layers, Globe2, Gem, Wallet, Loader2 } from 'lucide-react'

import { createSupabaseProfileRepository } from '@/features/profile/repositories/profile.repository'
import { createSupabaseReferenceRepository } from '@/features/collection/repositories/reference.repository'
import type { Profile } from '@/features/profile/types'
import type { Country } from '@/features/collection/types'
import type { CollectionStats } from '@/lib/stats/collection-stats'
import { formatDateOnly, formatTimestampDate } from '@/lib/format/date'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { StatCard } from '@/components/ui/StatCard'
import { Avatar } from '@/components/ui/Avatar'

const profileRepository = createSupabaseProfileRepository()
const referenceRepository = createSupabaseReferenceRepository()

const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [stats, setStats] = useState<CollectionStats | null>(null)
  const [countries, setCountries] = useState<Country[]>([])

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [countryCode, setCountryCode] = useState('')

  useEffect(() => {
    Promise.all([profileRepository.getOwnProfile(), profileRepository.getOwnStats(), referenceRepository.listCountries()])
      .then(([profileResult, statsResult, countriesResult]) => {
        setProfile(profileResult)
        setStats(statsResult)
        setCountries(countriesResult)
        setName(profileResult.name ?? '')
        setUsername(profileResult.username ?? '')
        setCountryCode(profileResult.countryCode ?? '')
      })
      .catch((err: Error) => setLoadError(err.message))
      .finally(() => setIsLoading(false))
  }, [])

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
      setError((err as Error).message)
    } finally {
      setIsSaving(false)
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
    return <p className="text-sm text-danger">{loadError ?? 'Não foi possível carregar seu perfil.'}</p>
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
                  <Badge tone={profile.planTier === 'premium' ? 'accent' : 'neutral'}>
                    {profile.planTier === 'premium' ? 'Premium' : 'Free'}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-text-secondary">Membro desde</p>
                  <p className="text-sm text-text-primary">{formatTimestampDate(profile.createdAt)}</p>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-base font-semibold text-text-primary">Passport público</h2>
                <div
                  role="switch"
                  aria-checked="false"
                  aria-disabled="true"
                  aria-label="Passport público — em breve"
                  className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed items-center rounded-full bg-surface-hover opacity-60"
                >
                  <span className="inline-block size-4 translate-x-1 rounded-full bg-text-secondary" />
                </div>
              </div>
              <p className="mt-2 text-sm text-text-secondary">
                Em breve — seu Passport será uma identidade pública compartilhável dentro do Numora.
              </p>
            </Card>
          </div>
        </div>
      </section>

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
    </div>
  )
}
