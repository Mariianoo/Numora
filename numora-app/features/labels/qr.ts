/**
 * features/labels/qr.ts
 * Etapa "F4 — Numora Labels" — URL do Passport individual (alvo do QR) +
 * geração do QR Code em si. Mesma lib já usada pelo Passport
 * (`qrcode`/`toDataURL`, ver components/passport/PassportShareModal.tsx) —
 * nenhuma dependência nova.
 */
import { toDataURL } from 'qrcode'
import { QR_ERROR_CORRECTION, QR_QUIET_ZONE_MODULES } from './layout-constants'

/**
 * SEMPRE o UUID interno do item (`collection_items.id`) — nunca
 * `label_code` (decisão explícita do owner: o código sequencial impresso na
 * etiqueta nunca deve ser o identificador de rota, para não permitir
 * enumeração). `origin` vem de `window.location.origin` no momento da
 * geração — nunca uma URL hardcoded/inventada, funciona identicamente em
 * DEV/Production.
 */
export function buildPassportItemUrl(origin: string, username: string, itemId: string): string {
  return `${origin}/passport/${encodeURIComponent(username)}/coin/${itemId}`
}

/**
 * `margin` (quiet zone) maior que o já usado no compartilhamento do
 * Passport (`margin: 1`, pensado só para tela) — impressão física se
 * beneficia de mais respiro ao redor do QR para leitura confiável mesmo com
 * pequenas imprecisões de corte/impressão.
 */
export async function generateLabelQrDataUrl(targetUrl: string): Promise<string> {
  return toDataURL(targetUrl, {
    errorCorrectionLevel: QR_ERROR_CORRECTION,
    margin: QR_QUIET_ZONE_MODULES,
    color: { dark: '#0B1F3B', light: '#F9F6EE' },
  })
}
