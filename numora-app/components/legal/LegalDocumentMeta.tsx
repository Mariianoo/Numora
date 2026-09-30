/**
 * components/legal/LegalDocumentMeta.tsx
 * Etapa "B2 — Signup + Legal" — bloco de versão/vigência/status exibido no
 * topo das páginas legais. Lê SEMPRE de lib/legal/versions.ts (fonte única).
 * Enquanto `reviewStatus` for `pending_legal_review`, o bloco diz
 * explicitamente "PENDENTE DE REVISÃO JURÍDICA" — o texto do documento não
 * é declarado definitivo nem em conformidade com nenhuma lei.
 */
import { LEGAL_DOCUMENTS } from '@/lib/legal/versions'

function formatIsoDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

export function LegalDocumentMeta({ type }: { type: keyof typeof LEGAL_DOCUMENTS }) {
  const document = LEGAL_DOCUMENTS[type]

  return (
    <div className="rounded-lg border border-border px-4 py-3 text-xs text-text-secondary" data-testid="legal-document-meta">
      <p>
        <span className="font-medium text-text-primary">Versão {document.version}</span> · Vigência a partir de{' '}
        {formatIsoDate(document.effectiveDate)} · Documento vigente
      </p>
      {document.reviewStatus === 'pending_legal_review' && (
        <p className="mt-1 font-semibold text-danger">PENDENTE DE REVISÃO JURÍDICA</p>
      )}
    </div>
  )
}
