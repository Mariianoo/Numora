/**
 * features/labels/components/LabelCardPreview.tsx
 * Etapa "F4 — Numora Labels" — pré-visualização HTML/CSS de UMA etiqueta.
 * Renderizada em tamanho FÍSICO real (`mm` como unidade CSS, suportada
 * nativamente pelo navegador) — não é uma aproximação em px. Usa
 * `getLabelLines` (a MESMA função que alimenta o PDF, `features/labels/pdf.ts`)
 * — nunca uma segunda lógica de composição de texto.
 *
 * Paleta de IMPRESSÃO (Cream/Navy/Gold), deliberadamente diferente da
 * paleta de tela do app — ver comentário em `pdf.ts`.
 */
import Image from 'next/image'
import { QrCode } from 'lucide-react'

import type { LabelData } from '../types'
import { getLabelLines } from '../label-layout'
import { LABEL_HEIGHT_MM, LABEL_WIDTH_MM } from '../layout-constants'

export interface LabelCardPreviewProps {
  data: LabelData
}

export function LabelCardPreview({ data }: LabelCardPreviewProps) {
  const lines = getLabelLines(data)

  return (
    <div
      style={{ width: `${LABEL_WIDTH_MM}mm`, height: `${LABEL_HEIGHT_MM}mm` }}
      className="flex shrink-0 items-stretch gap-2 rounded-md border border-[#D4AF37] bg-[#F9F6EE] p-2 text-[#0B1F3B]"
    >
      {/*
        Layout reorganizado (Etapa "F5"): símbolo isolado no topo, NMR
        isolado no rodapé — nunca lado a lado (competiam visualmente,
        achado de QA física em Production). Mesmo layout do PDF
        (`pdf.ts`), só que com emoji de bandeira preservado (a restrição
        de fonte é exclusiva do jsPDF, a tela renderiza emoji normalmente).
      */}
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <Image src="/brand/numora-symbol-reduced.png" alt="" width={11} height={11} unoptimized className="opacity-80" />

        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{lines.title ?? 'Sem denominação'}</p>
          {lines.originLine && <p className="truncate text-[11px]">{lines.originLine}</p>}
          {lines.metalLine && <p className="truncate text-[11px]">{lines.metalLine}</p>}
          {lines.detailLines.slice(0, 2).map((line) => (
            <p key={line} className="truncate text-[10px] opacity-80">
              {line}
            </p>
          ))}
        </div>

        {data.labelCode ? (
          <p className="text-[10px] font-medium text-[#D4AF37]">{data.labelCode}</p>
        ) : (
          <span aria-hidden className="h-[14px]" />
        )}
      </div>

      <div className="flex size-[22mm] shrink-0 items-center justify-center rounded bg-white/60">
        <QrCode className="size-8 text-[#0B1F3B]/40" aria-hidden />
      </div>
    </div>
  )
}
