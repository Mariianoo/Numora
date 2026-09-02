/**
 * components/passport/PassportShareModal.tsx
 * Passport V1 (Fase 6) — QR Code + compartilhamento do Passport público.
 * Gerado inteiramente client-side a partir da própria URL pública
 * (`qrcode`, única dependência nova desta etapa — nenhuma lib de QR já
 * existia no projeto, ver package.json antes desta etapa). Nunca
 * armazenado: a imagem é recalculada em memória a cada abertura do modal
 * e descartada ao fechar, sem upload, sem novo endpoint, sem Storage.
 *
 * `navigator.share` (Web Share API) é usado quando disponível (a maioria
 * dos navegadores móveis — o caso de uso real, "compartilhar por
 * celular"); no desktop, onde normalmente não existe, cai para "Copiar
 * link" — nunca um erro visível por a API não existir.
 */
'use client'

import { useEffect, useState } from 'react'
import { toDataURL } from 'qrcode'
import { Check, Copy, Share2 } from 'lucide-react'

import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

export interface PassportShareModalProps {
  isOpen: boolean
  onClose: () => void
  url: string
}

export function PassportShareModal({ isOpen, onClose, url }: PassportShareModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  useEffect(() => {
    if (!isOpen) return

    let cancelled = false

    toDataURL(url, { width: 240, margin: 1, color: { dark: '#0d0d0d', light: '#ffffff' } })
      .then((dataUrl) => {
        if (cancelled) return
        setQrDataUrl(dataUrl)
        setQrError(null)
      })
      .catch(() => {
        if (cancelled) return
        setQrDataUrl(null)
        setQrError('Não foi possível gerar o QR Code agora.')
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, url])

  function handleCopy() {
    navigator.clipboard.writeText(url)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  async function handleShare() {
    try {
      await navigator.share({ title: 'Numora Passport', url })
    } catch {
      // Cancelamento do próprio usuário no share sheet nativo (ou falha
      // silenciosa da API) — nunca vira um erro visível, o link continua
      // disponível para copiar manualmente logo abaixo.
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Compartilhar Passport"
      description="Qualquer pessoa com este link (ou que escanear o QR Code) vê seu Passport público."
    >
      <div className="flex flex-col items-center gap-5">
        <div className="flex size-[240px] items-center justify-center overflow-hidden rounded-xl border border-border bg-white p-3">
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- data: URL gerada em memória, não é asset estático do Next
            <img src={qrDataUrl} alt="QR Code do Passport" className="size-full" />
          ) : qrError ? (
            <p className="text-center text-sm text-danger">{qrError}</p>
          ) : (
            <p className="text-sm text-text-secondary">Gerando QR Code...</p>
          )}
        </div>

        <p className="w-full truncate rounded-lg border border-border bg-background px-3 py-2 text-center text-sm text-text-secondary">
          {url}
        </p>

        <div className="flex w-full gap-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={handleCopy}>
            {linkCopied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            {linkCopied ? 'Copiado' : 'Copiar link'}
          </Button>
          {canShare && (
            <Button type="button" className="flex-1" onClick={handleShare}>
              <Share2 className="size-4" aria-hidden />
              Compartilhar
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
