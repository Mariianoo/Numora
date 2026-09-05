/**
 * features/labels/components/LabelGeneratorModal.tsx
 * Etapa "F4 — Numora Labels" — modal único para geração individual (1 item)
 * e em lote (N itens), reaproveitado por `app/dashboard/collection/page.tsx`
 * em ambos os fluxos (integração mínima com a página existente, sem
 * duplicar UI). Fluxo: entitlement (UX, não é a barreira real) → aviso de
 * Passport privado (não-bloqueante) → escolha de valor financeiro →
 * pré-visualização → `ensure_label_codes` (a barreira real) → PDF.
 */
'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, FileDown, Sparkles } from 'lucide-react'

import type { CollectionItem } from '@/features/collection/types'
import { createSupabaseProfileRepository } from '@/features/profile/repositories/profile.repository'
import { createSupabaseLabelsRepository } from '@/features/labels/repositories/labels.repository'
import { buildLabelData } from '@/features/labels/label-layout'
import { generateLabelsPdf } from '@/features/labels/pdf'
import type { FinancialDisplayOption } from '@/features/labels/types'
import { getUserFriendlyErrorMessage } from '@/lib/errors/get-user-friendly-error-message'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { LabelCardPreview } from './LabelCardPreview'

const profileRepository = createSupabaseProfileRepository()
const labelsRepository = createSupabaseLabelsRepository()

const UPGRADE_MAILTO =
  'mailto:suporte.numora@gmail.com?subject=Quero%20conhecer%20o%20Numora%20Pro'

export interface LabelGeneratorModalProps {
  items: CollectionItem[]
  onClose: () => void
}

type LoadState = 'loading' | 'blocked' | 'ready'

export function LabelGeneratorModal({ items, onClose }: LabelGeneratorModalProps) {
  const [state, setState] = useState<LoadState>('loading')
  const [ownerUsername, setOwnerUsername] = useState<string | null>(null)
  const [passportPublic, setPassportPublic] = useState(false)
  const [financialDisplay, setFinancialDisplay] = useState<FinancialDisplayOption>('none')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfFilename, setPdfFilename] = useState<string>('etiquetas-numora.pdf')

  const isOpen = items.length > 0

  // `window.open(blobUrl)` chamado depois de um `await` é bloqueado
  // SILENCIOSAMENTE como popup pela maioria dos navegadores (não é um
  // clique síncrono do usuário do ponto de vista do navegador) — achado
  // real em QA manual: o PDF era gerado com sucesso (label_code atribuído,
  // blob criado) mas nenhuma aba abria, sem erro nenhum. Corrigido
  // renderizando um `<a download>` de verdade, que o usuário clica —
  // downloads iniciados por um clique real em `<a>` nunca são bloqueados.
  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    }
  }, [pdfUrl])

  // `.then()` (não async/await) dentro do useEffect, encadeado a partir de
  // `Promise.resolve()` — mesmo padrão já usado em outras páginas do
  // dashboard (evita react-hooks/set-state-in-effect: o `setState` só é
  // reconhecido como assíncrono quando fica dentro de um callback `.then()`,
  // nunca no corpo síncrono do efeito).
  useEffect(() => {
    if (!isOpen) return

    Promise.resolve()
      .then(() => {
        setState('loading')
        setError(null)
        return Promise.all([labelsRepository.isEnabled(), profileRepository.getOwnProfile()])
      })
      .then(([enabled, profile]) => {
        setOwnerUsername(profile.username)
        setPassportPublic(profile.passportPublic)
        setState(enabled ? 'ready' : 'blocked')
      })
      .catch((err) => {
        setError(getUserFriendlyErrorMessage(err))
        setState('blocked')
      })
  }, [isOpen])

  async function handleGenerate() {
    if (!ownerUsername) return

    setIsGenerating(true)
    setError(null)
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl)
      setPdfUrl(null)
    }

    try {
      const origin = window.location.origin
      const codesByItemId = await labelsRepository.ensureLabelCodes(items.map((item) => item.id))

      const labelData = items.map((item) =>
        buildLabelData(
          { ...item, labelCode: codesByItemId[item.id] ?? item.labelCode },
          { financialDisplay, origin, ownerUsername },
        ),
      )

      const pdfBlob = await generateLabelsPdf(labelData)
      setPdfUrl(URL.createObjectURL(pdfBlob))
      // Usa o código recém-resolvido (`codesByItemId`), nunca `items[0].labelCode`
      // — esse é o valor da prop QUANDO O MODAL ABRIU, ainda `null` na
      // primeira geração de um item (o código só existe depois do
      // `ensureLabelCodes` acima retornar). Achado real ao escrever o E2E
      // desta etapa: o nome do arquivo baixado teria o UUID em vez do
      // NMR-XXXXXXX na primeira geração se lesse a prop stale.
      setPdfFilename(
        items.length === 1 ? `etiqueta-${codesByItemId[items[0].id] ?? items[0].labelCode ?? items[0].id}.pdf` : 'etiquetas-numora.pdf',
      )
    } catch (err) {
      setError(getUserFriendlyErrorMessage(err))
    } finally {
      setIsGenerating(false)
    }
  }

  const previewData = items.map((item) =>
    buildLabelData(item, { financialDisplay, origin: '', ownerUsername: ownerUsername ?? '' }),
  )

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Numora Labels"
      description={items.length === 1 ? 'Etiqueta desta moeda' : `${items.length} etiquetas selecionadas`}
    >
      {state === 'loading' && <p className="py-6 text-center text-sm text-text-secondary">Carregando...</p>}

      {state === 'blocked' && (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Sparkles className="size-7" aria-hidden />
          </div>
          <div>
            <h3 className="text-base font-semibold text-text-primary">Numora Labels</h3>
            <p className="mt-1 max-w-xs text-sm text-text-secondary">
              Identifique fisicamente suas moedas e conecte cada uma ao seu Passport.
            </p>
            <p className="mt-1 text-sm font-medium text-accent">Exclusivo do Numora Pro.</p>
          </div>
          {/* Navegação na própria aba (não `window.open`) — `mailto:` só precisa acionar o cliente de e-mail do sistema, nunca uma nova aba do navegador. */}
          <Button type="button" onClick={() => (window.location.href = UPGRADE_MAILTO)}>
            Conhecer o Pro
          </Button>
        </div>
      )}

      {state === 'ready' && (
        <div className="flex flex-col gap-5">
          {!passportPublic && (
            <div className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/5 p-3 text-sm text-text-secondary">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              <p>
                Este QR Code só mostrará informações quando seu Passport estiver público.{' '}
                <a href="/dashboard/profile" className="font-medium text-accent underline underline-offset-2">
                  Configurar Passport
                </a>
              </p>
            </div>
          )}

          <Select
            label="Valor financeiro na etiqueta"
            value={financialDisplay}
            onChange={(event) => setFinancialDisplay(event.target.value as FinancialDisplayOption)}
          >
            <option value="none">Não mostrar valor</option>
            <option value="purchase">Mostrar valor de compra</option>
          </Select>

          <div className="flex flex-wrap justify-center gap-3 overflow-x-auto rounded-lg border border-border bg-surface-hover p-4">
            {previewData.map((data) => (
              <LabelCardPreview key={data.itemId} data={data} />
            ))}
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex items-center justify-end gap-3">
            {pdfUrl && (
              <a
                href={pdfUrl}
                download={pdfFilename}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-success px-4 text-sm font-medium text-background transition-colors hover:opacity-90"
              >
                <FileDown className="size-4" aria-hidden />
                Baixar PDF
              </a>
            )}
            <Button type="button" onClick={handleGenerate} isLoading={isGenerating} variant={pdfUrl ? 'secondary' : 'primary'}>
              {!pdfUrl && <FileDown className="size-4" aria-hidden />}
              {isGenerating ? 'Gerando...' : pdfUrl ? 'Gerar novamente' : 'Gerar PDF'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
