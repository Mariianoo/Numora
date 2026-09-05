/**
 * features/labels/types.ts
 * Tipagens de domínio do Numora Labels (Etapa "F4 — Numora Labels").
 */

/** Escolha do usuário na pré-visualização — padrão é 'none' (privacidade em primeiro lugar, decisão explícita do owner). */
export type FinancialDisplayOption = 'none' | 'purchase'

/**
 * Dados já resolvidos/montados de UMA etiqueta — granular de propósito
 * (nunca uma string pronta "país: ano"): cada campo é `null` quando o dado
 * não existe para aquele item, permitindo testar unitariamente que campos
 * ausentes são omitidos (nunca "—") sem depender de nenhuma formatação de
 * texto específica. `buildLabelData` (label-layout.ts) é quem monta isto a
 * partir de um `CollectionItem`.
 */
export interface LabelData {
  itemId: string
  /** `null` até `ensure_label_codes` ser chamado — a pré-visualização mostra o layout mesmo sem código ainda; o PDF final sempre chama ensure_label_codes antes de desenhar. */
  labelCode: string | null
  countryName: string | null
  countryFlagEmoji: string | null
  countryCode: string | null
  year: number | null
  denomination: string | null
  metalName: string | null
  secondaryMetalName: string | null
  weightG: number | null
  gradeLabel: string | null
  /** Só populado quando `financialDisplay === 'purchase'` E o item tem um valor de compra conhecido — nunca o valor bruto do banco ignorando a escolha do usuário. */
  purchaseValue: number | null
  notes: string | null
  /** URL completa de `/passport/[username]/coin/[itemId]` — sempre pelo UUID interno, nunca pelo label_code (ver features/labels/qr.ts). */
  qrTargetUrl: string
}

export interface GenerateLabelsOptions {
  financialDisplay: FinancialDisplayOption
}

export interface LabelsRepository {
  /** `get_my_entitlement('labels')` — só UX (mostrar gerador vs. card de upgrade); nunca a barreira real. */
  isEnabled(): Promise<boolean>
  /** `ensure_label_codes` — única escrita real; lança em caso de 42501 (sem entitlement ou ownership inválido). */
  ensureLabelCodes(itemIds: string[]): Promise<Record<string, string>>
}
