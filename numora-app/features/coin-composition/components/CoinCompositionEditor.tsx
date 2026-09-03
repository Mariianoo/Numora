/**
 * features/coin-composition/components/CoinCompositionEditor.tsx
 * Editor de composição metálica (Etapa 3B) — vive dentro do formulário
 * "Adicionar/Editar moeda" (app/dashboard/collection/page.tsx), no lugar
 * do antigo "Um metal / Dois metais".
 *
 * NUNCA expõe os termos técnicos `body`/`core`/`ring`/`plating`/
 * "component"/"RPC"/"legacy" ao usuário — usa "Núcleo", "Anel",
 * "Revestimento", nomes de metal. A conversão para o formato aceito pela
 * RPC (`SetCoinCompositionInput`) acontece só internamente, via
 * `buildPayload`.
 *
 * Controlado por fora (`value`/`onChange`, espelhando o padrão de
 * qualquer input controlado do projeto), mas com estado interno rico
 * (modo, linhas de liga, anéis) — o pai deve remontar este componente
 * (prop `key`) ao trocar de moeda/alternar adicionar↔editar, para que o
 * estado interno seja hidratado de novo a partir do `value` inicial em
 * vez de tentar reconciliar uma composição totalmente diferente campo a
 * campo.
 *
 * Simplificação deliberada (documentada no relatório desta etapa): cada
 * `core`/`ring`/`plating` só aceita 1 metal na UI (sem "liga dentro do
 * núcleo/anel") — a RPC permite estruturas mais ricas, mas isso cobre os
 * 6 cenários pedidos (simples, liga, bimetálica, trimetálica, plating,
 * desconhecida) sem expor complexidade que nenhum caso de uso real
 * pediu ainda.
 */
'use client'

import { useEffect, useId, useState } from 'react'
import { Plus, X } from 'lucide-react'

import type { Metal } from '@/features/collection/types'
import type { SetCoinCompositionInput, SetCoinCompositionPartInput } from '@/features/coin-composition/types'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'

export type Mode = 'simples' | 'liga' | 'bimetalica' | 'trimetalica' | 'desconhecida'

interface MetalRow {
  key: string
  metalCode: string
  percentageText: string
}

let rowKeySeq = 0
function nextRowKey(): string {
  rowKeySeq += 1
  return `row-${rowKeySeq}`
}

function emptyRow(): MetalRow {
  return { key: nextRowKey(), metalCode: '', percentageText: '' }
}

function parsePercentageText(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function percentageToText(percentage: number | null): string {
  return percentage !== null ? String(percentage) : ''
}

interface EditorState {
  mode: Mode
  simpleMetal: string
  simplePercentageText: string
  ligaRows: MetalRow[]
  coreMetal: string
  corePercentageText: string
  rings: MetalRow[]
  hasPlating: boolean
  platingMetal: string
  platingPercentageText: string
  isAdvanced: boolean
}

/**
 * Hidrata o estado interno a partir de um `SetCoinCompositionInput` já
 * existente (edição) — nunca lê/grava o banco. `defaultMode` só é usado
 * quando `value` está vazio e não há nada a hidratar: `'simples'` ao
 * adicionar uma moeda nova (a UX começa em "Material simples", conforme
 * o modelo de UX pedido), `'desconhecida'` ao editar uma moeda que
 * genuinamente não tem nenhum metal registrado (nada a pré-selecionar).
 */
function deriveInitialState(value: SetCoinCompositionInput, defaultMode: Mode = 'desconhecida'): EditorState {
  const body = value.find((part) => part.part === 'body') ?? null
  const core = value.find((part) => part.part === 'core') ?? null
  const rings = value.filter((part) => part.part === 'ring')
  const plating = value.find((part) => part.part === 'plating') ?? null

  const base: EditorState = {
    mode: defaultMode,
    simpleMetal: '',
    simplePercentageText: '100',
    ligaRows: [emptyRow(), emptyRow()],
    coreMetal: '',
    corePercentageText: '',
    rings: [emptyRow()],
    hasPlating: false,
    platingMetal: '',
    platingPercentageText: '',
    isAdvanced: false,
  }

  if (plating) {
    base.hasPlating = true
    base.platingMetal = plating.components[0]?.metalCode ?? ''
    base.platingPercentageText = percentageToText(plating.components[0]?.percentage ?? null)
    base.isAdvanced = true
  }

  if (body) {
    if (body.components.length <= 1) {
      base.mode = 'simples'
      base.simpleMetal = body.components[0]?.metalCode ?? ''
      base.simplePercentageText = percentageToText(body.components[0]?.percentage ?? null)
    } else {
      base.mode = 'liga'
      base.ligaRows = body.components.map((component) => ({
        key: nextRowKey(),
        metalCode: component.metalCode,
        percentageText: percentageToText(component.percentage),
      }))
    }
    return base
  }

  if (core && rings.length > 0) {
    base.mode = rings.length > 1 ? 'trimetalica' : 'bimetalica'
    base.coreMetal = core.components[0]?.metalCode ?? ''
    base.corePercentageText = percentageToText(core.components[0]?.percentage ?? null)
    if (base.corePercentageText !== '') base.isAdvanced = true
    base.rings = rings.map((ring) => {
      const percentageText = percentageToText(ring.components[0]?.percentage ?? null)
      if (percentageText !== '') base.isAdvanced = true
      return { key: nextRowKey(), metalCode: ring.components[0]?.metalCode ?? '', percentageText }
    })
    return base
  }

  return base
}

function buildPayload(state: EditorState): SetCoinCompositionInput {
  const parts: SetCoinCompositionPartInput[] = []

  if (state.mode === 'simples') {
    if (state.simpleMetal !== '') {
      parts.push({
        part: 'body',
        components: [{ metalCode: state.simpleMetal, percentage: parsePercentageText(state.simplePercentageText) }],
      })
    }
  } else if (state.mode === 'liga') {
    const filled = state.ligaRows.filter((row) => row.metalCode !== '')
    if (filled.length > 0) {
      parts.push({
        part: 'body',
        components: filled.map((row) => ({ metalCode: row.metalCode, percentage: parsePercentageText(row.percentageText) })),
      })
    }
  } else if (state.mode === 'bimetalica' || state.mode === 'trimetalica') {
    const filledRings = state.rings.filter((row) => row.metalCode !== '')
    if (state.coreMetal !== '' && filledRings.length > 0) {
      parts.push({
        part: 'core',
        components: [{ metalCode: state.coreMetal, percentage: parsePercentageText(state.corePercentageText) }],
      })
      for (const ring of filledRings) {
        parts.push({ part: 'ring', components: [{ metalCode: ring.metalCode, percentage: parsePercentageText(ring.percentageText) }] })
      }
    }
  }

  // Revestimento só é enviado quando já existe uma estrutura base — um
  // plating "solto" seria rejeitado pela RPC (22023) e, sem base
  // nenhuma, não há nada de humano para descrever ("revestimento de quê?").
  if (state.hasPlating && state.platingMetal !== '' && parts.length > 0) {
    parts.push({
      part: 'plating',
      components: [{ metalCode: state.platingMetal, percentage: parsePercentageText(state.platingPercentageText) }],
    })
  }

  return parts
}

interface PercentageFeedback {
  message: string
  tone: 'positive' | 'negative' | 'neutral'
}

/**
 * Etapa 3D — feedback de UX para o percentual de uma parte com exatamente
 * 1 componente (Material simples, Núcleo, cada Anel, Revestimento). Espelha
 * (sem duplicar) a regra real da RPC: mesmo com 1 componente só, a soma da
 * parte precisa ser 100% (tolerância ±0.1) quando informada — então o
 * único percentual "válido" além de vazio é ~100. A RPC continua sendo a
 * autoridade final (22023 se esta checagem client-side falhar de algum
 * jeito); isto é só feedback antecipado, nunca uma segunda fonte de regra.
 */
function evaluateSingleComponentPercentage(percentageText: string): PercentageFeedback | null {
  const trimmed = percentageText.trim()
  if (trimmed === '') return null

  const value = Number(trimmed)
  if (Math.abs(value - 100) <= 0.1) {
    return { message: 'Percentual válido (100%).', tone: 'positive' }
  }
  return { message: 'Quando há apenas um metal, o percentual deve ser 100% ou ficar em branco.', tone: 'negative' }
}

function evaluateLigaPercentages(rows: MetalRow[]): PercentageFeedback | null {
  const filled = rows.filter((row) => row.metalCode !== '')
  if (filled.length === 0) return null
  if (filled.length === 1) return evaluateSingleComponentPercentage(filled[0].percentageText)

  const withPercentage = filled.filter((row) => row.percentageText.trim() !== '')
  if (withPercentage.length === 0) {
    return { message: 'Proporções não informadas.', tone: 'neutral' }
  }
  if (withPercentage.length < filled.length) {
    return { message: 'Informe o percentual de todos os metais desta liga, ou deixe todos em branco.', tone: 'negative' }
  }

  const values = withPercentage.map((row) => Number(row.percentageText.trim()))
  if (values.some((value) => value <= 0)) {
    return { message: 'O percentual de cada metal precisa ser maior que zero.', tone: 'negative' }
  }

  const sum = values.reduce((total, value) => total + value, 0)
  const rounded = Math.round(sum * 100) / 100
  if (Math.abs(sum - 100) <= 0.1) {
    return { message: `Total: ${rounded}%`, tone: 'positive' }
  }
  return { message: 'Os percentuais precisam totalizar 100%.', tone: 'negative' }
}

const FEEDBACK_TONE_CLASS: Record<PercentageFeedback['tone'], string> = {
  positive: 'text-success',
  negative: 'text-danger',
  neutral: 'text-text-secondary/70',
}

/**
 * Validade geral do rascunho atual — usada só para decidir se o pai pode
 * chamar `setComposition()` no submit (ver `onValidityChange`). Nunca
 * substitui a validação da RPC, só evita uma chamada que sabemos, do lado
 * do cliente, que vai falhar.
 */
function computeIsValid(state: EditorState): boolean {
  const isInvalid = (feedback: PercentageFeedback | null) => feedback !== null && feedback.tone === 'negative'

  if (state.mode === 'simples' && state.simpleMetal !== '' && isInvalid(evaluateSingleComponentPercentage(state.simplePercentageText))) {
    return false
  }

  if (state.mode === 'liga' && isInvalid(evaluateLigaPercentages(state.ligaRows))) {
    return false
  }

  if (state.mode === 'bimetalica' || state.mode === 'trimetalica') {
    if (state.coreMetal !== '' && isInvalid(evaluateSingleComponentPercentage(state.corePercentageText))) {
      return false
    }
    for (const ring of state.rings) {
      if (ring.metalCode !== '' && isInvalid(evaluateSingleComponentPercentage(ring.percentageText))) {
        return false
      }
    }
  }

  if (state.hasPlating && state.platingMetal !== '' && isInvalid(evaluateSingleComponentPercentage(state.platingPercentageText))) {
    return false
  }

  return true
}

function metalOptionLabel(metal: Metal): string {
  return metal.kind === 'alloy' ? `${metal.name} (liga)` : metal.name
}

/** `<Select>` de metal reutilizado em todos os slots (simples/liga/núcleo/anel/revestimento) — desabilita metais já usados nas OUTRAS linhas da mesma parte, para não permitir duplicidade. */
function MetalSelect({
  label,
  metals,
  value,
  onChange,
  excludeCodes,
}: {
  label: string
  metals: Metal[]
  value: string
  onChange: (code: string) => void
  excludeCodes?: string[]
}) {
  const excluded = new Set((excludeCodes ?? []).filter((code) => code !== value))
  return (
    <Select label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Selecione...</option>
      {metals
        .filter((metal) => !excluded.has(metal.code))
        .map((metal) => (
          <option key={metal.code} value={metal.code}>
            {metalOptionLabel(metal)}
          </option>
        ))}
    </Select>
  )
}

export interface CoinCompositionEditorProps {
  metals: Metal[]
  value: SetCoinCompositionInput
  onChange: (next: SetCoinCompositionInput) => void
  /** Ver `deriveInitialState` — só importa quando `value` é `[]`. Padrão: `'desconhecida'`. */
  defaultMode?: Mode
  /**
   * Etapa 3D — avisa o pai se o rascunho atual tem algum percentual que a
   * RPC certamente vai rejeitar (ex.: um metal único com 50%). O pai deve
   * usar isto para NÃO chamar `setComposition()` quando `false`, mostrando
   * o feedback inline em vez de depender só do 22023 da RPC. Nunca duplica
   * a validação de negócio completa — só os casos já visíveis como erro
   * inline nesta tela.
   */
  onValidityChange?: (isValid: boolean) => void
}

export function CoinCompositionEditor({
  metals,
  value,
  onChange,
  defaultMode = 'desconhecida',
  onValidityChange,
}: CoinCompositionEditorProps) {
  const [state, setState] = useState<EditorState>(() => deriveInitialState(value, defaultMode))
  const modeSelectId = useId()

  useEffect(() => {
    onChange(buildPayload(state))
    onValidityChange?.(computeIsValid(state))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `onChange`/`onValidityChange` são recriados a cada render do pai; só o estado interno deve disparar a sincronização.
  }, [state])

  function setMode(mode: Mode) {
    setState((current) => {
      if (mode === 'simples') {
        return { ...current, mode, simpleMetal: '', simplePercentageText: '100' }
      }
      if (mode === 'liga') {
        return { ...current, mode, ligaRows: [emptyRow(), emptyRow()] }
      }
      if (mode === 'bimetalica') {
        return { ...current, mode, coreMetal: '', corePercentageText: '', rings: [emptyRow()] }
      }
      if (mode === 'trimetalica') {
        return { ...current, mode, coreMetal: '', corePercentageText: '', rings: [emptyRow(), emptyRow()] }
      }
      return { ...current, mode, hasPlating: false, platingMetal: '', platingPercentageText: '' }
    })
  }

  const ligaFeedback = state.mode === 'liga' ? evaluateLigaPercentages(state.ligaRows) : null

  return (
    <div className="flex flex-col gap-4">
      <Select
        id={modeSelectId}
        label="Tipo de composição"
        value={state.mode}
        onChange={(e) => setMode(e.target.value as Mode)}
      >
        <option value="simples">Material simples</option>
        <option value="liga">Liga metálica (2 ou mais metais)</option>
        <option value="bimetalica">Bimetálica (núcleo + anel)</option>
        <option value="trimetalica">Trimetálica (núcleo + 2 anéis ou mais)</option>
        <option value="desconhecida">Composição não informada</option>
      </Select>

      {state.mode === 'simples' && (
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <MetalSelect
              label="Metal"
              metals={metals}
              value={state.simpleMetal}
              onChange={(metalCode) => setState((current) => ({ ...current, simpleMetal: metalCode }))}
            />
            <Input
              label="Percentual (%)"
              type="number"
              step="any"
              min="0.01"
              max="100"
              placeholder="Ex.: 100"
              value={state.simplePercentageText}
              onChange={(e) => setState((current) => ({ ...current, simplePercentageText: e.target.value }))}
            />
          </div>
          {(() => {
            const feedback = state.simpleMetal !== '' ? evaluateSingleComponentPercentage(state.simplePercentageText) : null
            return feedback && <p className={`text-xs ${FEEDBACK_TONE_CLASS[feedback.tone]}`}>{feedback.message}</p>
          })()}
        </div>
      )}

      {state.mode === 'liga' && (
        <div className="flex flex-col gap-3">
          {state.ligaRows.map((row, index) => (
            <div key={row.key} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_120px_auto]">
              <MetalSelect
                label={`Metal ${index + 1}`}
                metals={metals}
                value={row.metalCode}
                excludeCodes={state.ligaRows.map((r) => r.metalCode)}
                onChange={(metalCode) =>
                  setState((current) => ({
                    ...current,
                    ligaRows: current.ligaRows.map((r) => (r.key === row.key ? { ...r, metalCode } : r)),
                  }))
                }
              />
              <Input
                label="Percentual (%)"
                type="number"
                step="any"
                min="0.01"
                max="100"
                value={row.percentageText}
                onChange={(e) =>
                  setState((current) => ({
                    ...current,
                    ligaRows: current.ligaRows.map((r) => (r.key === row.key ? { ...r, percentageText: e.target.value } : r)),
                  }))
                }
              />
              <IconButton
                icon={X}
                size="sm"
                aria-label={`Remover metal ${index + 1}`}
                disabled={state.ligaRows.length <= 2}
                onClick={() => setState((current) => ({ ...current, ligaRows: current.ligaRows.filter((r) => r.key !== row.key) }))}
              />
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() => setState((current) => ({ ...current, ligaRows: [...current.ligaRows, emptyRow()] }))}
          >
            <Plus className="size-4" aria-hidden /> Adicionar metal
          </Button>
          {ligaFeedback && <p className={`text-xs ${FEEDBACK_TONE_CLASS[ligaFeedback.tone]}`}>{ligaFeedback.message}</p>}
        </div>
      )}

      {(state.mode === 'bimetalica' || state.mode === 'trimetalica') && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <MetalSelect
              label="Núcleo"
              metals={metals}
              value={state.coreMetal}
              onChange={(metalCode) => setState((current) => ({ ...current, coreMetal: metalCode }))}
            />
            {state.isAdvanced && (
              <div className="flex flex-col gap-1.5">
                <Input
                  label="Percentual do núcleo (%)"
                  type="number"
                  step="any"
                  min="0.01"
                  max="100"
                  placeholder="Não informado"
                  value={state.corePercentageText}
                  onChange={(e) => setState((current) => ({ ...current, corePercentageText: e.target.value }))}
                />
                {(() => {
                  const feedback = state.coreMetal !== '' ? evaluateSingleComponentPercentage(state.corePercentageText) : null
                  return feedback && <p className={`text-xs ${FEEDBACK_TONE_CLASS[feedback.tone]}`}>{feedback.message}</p>
                })()}
              </div>
            )}
          </div>

          {state.rings.map((ring, index) => {
            const ringFeedback = ring.metalCode !== '' ? evaluateSingleComponentPercentage(ring.percentageText) : null
            return (
              <div key={ring.key} className="flex flex-col gap-1.5">
                <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_120px_auto]">
                  <MetalSelect
                    label={state.rings.length > 1 ? `Anel ${index + 1}` : 'Anel'}
                    metals={metals}
                    value={ring.metalCode}
                    onChange={(metalCode) =>
                      setState((current) => ({
                        ...current,
                        rings: current.rings.map((r) => (r.key === ring.key ? { ...r, metalCode } : r)),
                      }))
                    }
                  />
                  {state.isAdvanced && (
                    <Input
                      label="Percentual (%)"
                      type="number"
                      step="any"
                      min="0.01"
                      max="100"
                      placeholder="Não informado"
                      value={ring.percentageText}
                      onChange={(e) =>
                        setState((current) => ({
                          ...current,
                          rings: current.rings.map((r) => (r.key === ring.key ? { ...r, percentageText: e.target.value } : r)),
                        }))
                      }
                    />
                  )}
                  <IconButton
                    icon={X}
                    size="sm"
                    aria-label={`Remover anel ${index + 1}`}
                    disabled={state.rings.length <= 1}
                    onClick={() =>
                      setState((current) => {
                        const rings = current.rings.filter((r) => r.key !== ring.key)
                        return { ...current, rings, mode: rings.length > 1 ? 'trimetalica' : 'bimetalica' }
                      })
                    }
                  />
                </div>
                {state.isAdvanced && ringFeedback && (
                  <p className={`text-xs ${FEEDBACK_TONE_CLASS[ringFeedback.tone]}`}>{ringFeedback.message}</p>
                )}
              </div>
            )
          })}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() =>
              setState((current) => ({ ...current, rings: [...current.rings, emptyRow()], mode: 'trimetalica' }))
            }
          >
            <Plus className="size-4" aria-hidden /> Adicionar anel
          </Button>
          {!state.isAdvanced && (
            <p className="text-xs text-text-secondary/70">Proporções não informadas — use &quot;Detalhar composição&quot; para informá-las.</p>
          )}
        </div>
      )}

      {state.mode === 'desconhecida' && (
        <p className="text-xs text-text-secondary/70">
          Nenhum metal será registrado para esta moeda — você pode informar a composição depois.
        </p>
      )}

      {state.mode !== 'desconhecida' && (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          {!state.isAdvanced ? (
            <button
              type="button"
              onClick={() => setState((current) => ({ ...current, isAdvanced: true }))}
              className="self-start text-sm font-medium text-accent hover:underline"
            >
              + Detalhar composição
            </button>
          ) : (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                className="accent-accent"
                checked={state.hasPlating}
                onChange={(e) => setState((current) => ({ ...current, hasPlating: e.target.checked }))}
              />
              Revestimento (banho de outro metal por cima)
            </label>
          )}

          {state.isAdvanced && state.hasPlating && (
            <div className="flex flex-col gap-1.5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <MetalSelect
                  label="Metal do revestimento"
                  metals={metals}
                  value={state.platingMetal}
                  onChange={(metalCode) => setState((current) => ({ ...current, platingMetal: metalCode }))}
                />
                <Input
                  label="Percentual (%)"
                  type="number"
                  step="any"
                  min="0.01"
                  max="100"
                  placeholder="Não informado"
                  value={state.platingPercentageText}
                  onChange={(e) => setState((current) => ({ ...current, platingPercentageText: e.target.value }))}
                />
              </div>
              {(() => {
                const feedback =
                  state.platingMetal !== '' ? evaluateSingleComponentPercentage(state.platingPercentageText) : null
                return feedback && <p className={`text-xs ${FEEDBACK_TONE_CLASS[feedback.tone]}`}>{feedback.message}</p>
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
