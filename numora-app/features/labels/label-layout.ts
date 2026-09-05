/**
 * features/labels/label-layout.ts
 * Etapa "F4 — Numora Labels" — montagem PURA dos dados de uma etiqueta a
 * partir de um `CollectionItem` já carregado (nenhum acesso a rede aqui).
 * Granularidade da V1 aprovada pelo owner: 1 etiqueta por `collection_item`
 * (a emissão), nunca por `collection_unit` — um item com `quantity > 1`
 * gera uma única etiqueta representando a emissão inteira (limitação
 * documentada, decisão consciente).
 *
 * Regra central testada em unit: um campo ausente no dado real NUNCA vira
 * "—" nem um espaço reservado — ele simplesmente não aparece no array de
 * `getLabelLines()`. O layout (preview HTML e PDF) só itera esse array,
 * nunca posições fixas por campo.
 */
import type { CollectionItem, CollectionItemUnit } from '@/features/collection/types'
import type { FinancialDisplayOption, LabelData } from './types'
import { buildPassportItemUrl } from './qr'

/**
 * O exemplar "representante" do item para fins de etiqueta (conservação,
 * valor de compra) — sempre o exemplar principal (`isPrimary`), mesma
 * convenção já usada pelo Passport/miniatura da coleção para "qual
 * exemplar representa esta moeda". Nunca `units[0]` (que é só o mais
 * antigo) — um item pode ter o principal marcado em qualquer posição do
 * array.
 */
function findPrimaryUnit(units: CollectionItemUnit[]): CollectionItemUnit | null {
  return units.find((unit) => unit.isPrimary) ?? null
}

export interface BuildLabelDataOptions {
  financialDisplay: FinancialDisplayOption
  /** Origin da aplicação no momento da geração (`window.location.origin`) — nunca hardcoded, nunca inventado (ver qr.ts). */
  origin: string
  /** Username do PRÓPRIO usuário logado (dono do item) — o QR sempre aponta para o Passport dele. */
  ownerUsername: string
}

export function buildLabelData(item: CollectionItem, options: BuildLabelDataOptions): LabelData {
  const primaryUnit = findPrimaryUnit(item.units)

  const purchaseValue =
    options.financialDisplay === 'purchase' ? (primaryUnit?.unitCost ?? item.purchase?.totalPrice ?? null) : null

  return {
    itemId: item.id,
    labelCode: item.labelCode,
    countryName: item.countryDisplayName,
    countryFlagEmoji: item.countryFlagEmoji,
    countryCode: item.countryCode,
    year: item.year,
    denomination: item.denomination,
    metalName: item.metalName,
    secondaryMetalName: item.secondaryMetalName,
    weightG: item.grossWeightG,
    gradeLabel: primaryUnit?.gradeLabel ?? null,
    purchaseValue,
    notes: item.description,
    qrTargetUrl: buildPassportItemUrl(options.origin, options.ownerUsername, item.id),
  }
}

export interface LabelLines {
  /** Denominação — sempre a linha de destaque, mesmo quando `null` (o layout decide o fallback visual, nunca "—" aqui). */
  title: string | null
  /** "🇧🇷 Brasil · 1979", só com as partes que existirem; `null` se nem país nem ano existirem. */
  originLine: string | null
  /** "Bronze + Níquel" ou "Bronze"; `null` se nenhum metal existir. */
  metalLine: string | null
  /** Linhas opcionais, na ordem em que devem aparecer — nunca inclui uma entrada para um campo ausente. */
  detailLines: string[]
}

const NUMBER_FORMATTER = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Composição de texto — a ÚNICA função que decide como os campos de `LabelData` viram linhas visíveis. Reaproveitada por preview e PDF. */
export function getLabelLines(data: LabelData): LabelLines {
  const originParts = [
    data.countryFlagEmoji ? `${data.countryFlagEmoji} ${data.countryName ?? data.countryCode ?? ''}`.trim() : data.countryName,
    data.year !== null ? String(data.year) : null,
  ].filter((part): part is string => Boolean(part && part.length > 0))

  const metalParts = [data.metalName, data.secondaryMetalName].filter((part): part is string => Boolean(part))

  const detailLines: string[] = []
  if (data.weightG !== null) detailLines.push(`${NUMBER_FORMATTER.format(data.weightG)} g`)
  if (data.gradeLabel) detailLines.push(data.gradeLabel)
  if (data.purchaseValue !== null) detailLines.push(`R$ ${NUMBER_FORMATTER.format(data.purchaseValue)}`)
  if (data.notes) detailLines.push(data.notes)

  return {
    title: data.denomination,
    originLine: originParts.length > 0 ? originParts.join(' · ') : null,
    metalLine: metalParts.length > 0 ? metalParts.join(' + ') : null,
    detailLines,
  }
}

/**
 * Etapa "F5 — Labels PDF fix" — variante de `getLabelLines` SEM emoji, para
 * uso exclusivo do PDF (`pdf.ts`). Achado real em teste físico em
 * Production (moeda "1 Balboa — Panamá — 1947"): a bandeira Unicode
 * (`🇵🇦`, par de indicadores regionais fora do plano básico multilíngue)
 * não tem glyph nas fontes padrão do jsPDF (`helvetica`/`times`/`courier`,
 * que só cobrem WinAnsiEncoding/Latin-1) — o resultado impresso foi lixo
 * binário (`"¤�Y�"`), nunca um erro. A pré-visualização em tela
 * (`LabelCardPreview.tsx`) CONTINUA usando `getLabelLines` (com emoji) —
 * só o PDF precisa da variante sem bandeira, por limitação da própria
 * biblioteca, não por preferência de design.
 *
 * Nome do país em maiúsculas (`PANAMÁ`) — acentos latinos (á, ã, ç...)
 * continuam dentro de WinAnsiEncoding, então renderizam normalmente; só o
 * emoji é removido. `toPdfSafeText` (`pdf.ts`) permanece como rede de
 * segurança adicional para qualquer outro caractere fora do intervalo
 * suportado que apareça em campos de texto livre (ex.: observações).
 */
export function getPrintSafeLabelLines(data: LabelData): LabelLines {
  const lines = getLabelLines(data)

  const countryText = data.countryName ?? data.countryCode
  const originParts = [
    countryText ? countryText.toUpperCase() : null,
    data.year !== null ? String(data.year) : null,
  ].filter((part): part is string => Boolean(part && part.length > 0))

  return {
    ...lines,
    originLine: originParts.length > 0 ? originParts.join(' · ') : null,
  }
}
