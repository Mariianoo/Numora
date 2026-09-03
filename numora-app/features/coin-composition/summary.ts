/**
 * features/coin-composition/summary.ts
 * Deriva um resumo humano (PT-BR) de uma `CoinComposition` — nunca expõe
 * termos técnicos (`body`/`core`/`ring`/`plating`, "component", "legacy")
 * ao usuário. Usado pelo formulário de moeda (Etapa 3B) como feedback em
 * tempo real; função pura, sem I/O, reutilizável por qualquer outra tela
 * que precise do mesmo resumo no futuro (ver PROJECT_RULES — nunca
 * duplicar esta lógica em vários lugares).
 */
import type {
  CoinComposition,
  CoinPart,
  SetCoinCompositionInput,
} from '@/features/coin-composition/types'
import type { Metal } from '@/features/collection/types'

const PART_LABEL: Record<CoinPart['part'], string> = {
  body: '',
  core: 'Núcleo',
  ring: 'Anel',
  plating: 'Revestimento',
}

/** Forma mínima de que a lógica de resumo precisa — tanto `CoinPart[]` (leitura) quanto um rascunho ainda não salvo (`SetCoinCompositionInput`, com `sortOrder` sintetizado pela posição no array) satisfazem isto. */
interface SummarizablePart {
  part: CoinPart['part']
  sortOrder: number
  components: { metalCode: string; percentage: number | null; sortOrder: number }[]
}

function metalDisplayName(metalCode: string, metals: Metal[]): string {
  const metal = metals.find((candidate) => candidate.code === metalCode)
  return metal?.name ?? metalCode
}

function formatPercentage(percentage: number | null): string {
  if (percentage === null) return ''
  // Sem casas decimais desnecessárias (92.5 -> "92,5", 100 -> "100").
  const rounded = Math.round(percentage * 100) / 100
  return `${String(rounded).replace('.', ',')}%`
}

function summarizeComponents(components: SummarizablePart['components'], metals: Metal[]): string {
  const sorted = components.slice().sort((a, b) => a.sortOrder - b.sortOrder)
  return sorted
    .map((component) => {
      const name = metalDisplayName(component.metalCode, metals)
      const percentage = formatPercentage(component.percentage)
      return percentage ? `${percentage} ${name}` : name
    })
    .join(' + ')
}

function summarizeParts(parts: SummarizablePart[], metals: Metal[]): string {
  if (parts.length === 0) {
    return 'Composição não informada'
  }

  const body = parts.find((part) => part.part === 'body') ?? null
  const core = parts.find((part) => part.part === 'core') ?? null
  const rings = parts.filter((part) => part.part === 'ring').sort((a, b) => a.sortOrder - b.sortOrder)
  const plating = parts.find((part) => part.part === 'plating') ?? null

  let base: string
  if (body) {
    // A RPC nunca permite misturar componentes com e sem percentage na
    // mesma parte (regra "tudo ou nada") — então isto é sempre
    // "todos conhecidos" ou "todos desconhecidos", nunca parcial.
    const allKnown = body.components.every((component) => component.percentage !== null)

    if (body.components.length === 1) {
      const [component] = body.components
      const name = metalDisplayName(component.metalCode, metals)
      base = allKnown ? `${name} — ${formatPercentage(component.percentage)}` : name
    } else if (allKnown) {
      const dominant = body.components
        .slice()
        .sort((a, b) => (b.percentage ?? 0) - (a.percentage ?? 0) || a.sortOrder - b.sortOrder)[0]
      const dominantName = metalDisplayName(dominant.metalCode, metals)
      base = `${dominantName} — ${summarizeComponents(body.components, metals)}`
    } else {
      const names = body.components
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((component) => metalDisplayName(component.metalCode, metals))
        .join(' + ')
      base = `${names} — proporções não informadas`
    }
  } else if (core && rings.length > 0) {
    const coreLabel = summarizeComponents(core.components, metals)
    const ringLabel = rings.map((ring) => summarizeComponents(ring.components, metals)).join(' + ')
    const kind = rings.length > 1 ? 'Trimetálica' : 'Bimetálica'
    base = `${kind} — Núcleo: ${coreLabel} · Anel: ${ringLabel}`
  } else {
    // Estrutura presente mas sem body nem core+ring reconhecível (ex.: só
    // plating) — não deveria acontecer com dados vindos da RPC (que exige
    // "plating" com body/core+ring), mas fica coberto defensivamente.
    base = 'Composição parcial'
  }

  if (plating) {
    const platingLabel = summarizeComponents(plating.components, metals)
    base = `${base} · ${PART_LABEL.plating}: ${platingLabel}`
  }

  return base
}

/**
 * "Prata — 100%" · "Prata — 92,5% prata + 7,5% cobre" · "Bimetálica —
 * Núcleo: aço · Anel: latão" · "Trimetálica — Núcleo: aço · Anel: cobre +
 * latão" · "Cobre + Estanho — proporções não informadas" · "Composição
 * não informada". Para uma composição já lida do banco (`getComposition`).
 */
export function summarizeComposition(composition: CoinComposition, metals: Metal[]): string {
  return summarizeParts(composition.parts, metals)
}

/**
 * Mesmo resumo, mas para um rascunho ainda não salvo (`SetCoinCompositionInput`,
 * o formato que `CoinCompositionEditor` produz) — usado como feedback em
 * tempo real no formulário, antes de qualquer chamada à RPC.
 * `sortOrder` ausente é sintetizado pela posição no array, mesma
 * convenção usada pela RPC/repository quando o campo é omitido.
 */
export function summarizeDraftComposition(parts: SetCoinCompositionInput, metals: Metal[]): string {
  const summarizable: SummarizablePart[] = parts.map((part, partIndex) => ({
    part: part.part,
    sortOrder: part.sortOrder ?? partIndex,
    components: part.components.map((component, componentIndex) => ({
      metalCode: component.metalCode,
      percentage: component.percentage,
      sortOrder: component.sortOrder ?? componentIndex,
    })),
  }))
  return summarizeParts(summarizable, metals)
}
