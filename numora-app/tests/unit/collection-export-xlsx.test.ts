/**
 * tests/unit/collection-export-xlsx.test.ts
 * Etapa "5.10V.2 — Excel Premium da Coleção" — testa
 * `generateCollectionXlsx` (features/collection/export-xlsx.ts) de ponta a
 * ponta, gerando um `.xlsx` real em memória e inspecionando seus bytes
 * crus (o arquivo `.xlsx` é um ZIP de XML — RFC/ECMA-376) via `fflate`
 * (`unzipSync`), que já é dependência transitiva do projeto (via `jspdf` E
 * via `write-excel-file`, ambos já a usam) — NENHUMA biblioteca nova foi
 * adicionada só para testar, conforme exigido pela Etapa 5.10V.2 seção
 * 11 ("NÃO adicionar uma biblioteca de leitura de XLSX somente para
 * testar").
 *
 * Por que inspecionar bytes crus em vez de só "não lança erro": a
 * exigência central desta etapa é que números/datas sejam CÉLULAS REAIS
 * do Excel, não texto formatado disfarçado de número/data. O formato
 * OOXML sempre grava o valor cru de uma célula numérica/data usando ponto
 * decimal (nunca vírgula) e datas como número de série (nunca a string
 * ISO/formatada) — por isso, procurar a ausência da versão "vírgula"/
 * "formatada" nos bytes crus é uma prova real e não-frágil de que a
 * célula é genuinamente numérica/data, sem precisar escrever um parser de
 * OOXML completo só para o teste.
 */
import { unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it } from 'vitest'

import { generateCollectionXlsx, buildCollectionExportXlsxFilename } from '@/features/collection/export-xlsx'
import type { CollectionItem, CollectionItemUnit } from '@/features/collection/types'

let unitCounter = 0
let itemCounter = 0

function makeUnit(overrides: Partial<CollectionItemUnit> = {}): CollectionItemUnit {
  unitCounter += 1
  return {
    id: `unit-${unitCounter}`,
    collectionItemId: 'item-1',
    gradeId: null,
    gradeLabel: null,
    gradeScale: null,
    status: 'in_collection',
    rating: null,
    isPrimary: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    purchaseId: null,
    unitCost: null,
    costOrigin: 'auto',
    costType: 'unknown',
    images: [],
    ...overrides,
  }
}

function makeItem(overrides: Partial<CollectionItem> = {}): CollectionItem {
  itemCounter += 1
  return {
    id: `item-secret-${itemCounter}`,
    userId: 'user-secret-1',
    purchaseId: `purchase-secret-${itemCounter}`,
    countryCode: null,
    countryName: null,
    year: null,
    denomination: null,
    mint: null,
    metalCode: null,
    secondaryMetalCode: null,
    grossWeightG: null,
    purity: null,
    faceValue: null,
    quantity: 1,
    unitCostOverride: null,
    description: null,
    location: null,
    tags: null,
    mintage: null,
    history: null,
    trivia: null,
    catalogReferences: null,
    createdAt: '2024-03-05T10:00:00.000Z',
    updatedAt: '2024-03-05T10:00:00.000Z',
    deletedAt: null,
    countryDisplayName: null,
    countryFlagEmoji: null,
    metalName: null,
    secondaryMetalName: null,
    purchase: null,
    units: [makeUnit()],
    isPublicInPassport: false,
    isPhotoPublic: false,
    labelCode: null,
    ...overrides,
  }
}

/** Descompacta o `.xlsx` e devolve todo o texto de todas as entradas concatenado — suficiente para busca de substring sem precisar mapear qual XML é qual sheet. */
async function unzipAllText(blob: Blob): Promise<{ entries: Record<string, string>; allText: string }> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const unzipped = unzipSync(bytes)
  const entries: Record<string, string> = {}
  for (const [path, content] of Object.entries(unzipped)) {
    entries[path] = strFromU8(content)
  }
  return { entries, allText: Object.values(entries).join('\n') }
}

const CSV_EQUIVALENT_HEADERS = [
  'País',
  'Ano',
  'Denominação',
  'Casa da moeda',
  'Label Code',
  'Quantidade',
  'Metal',
  'Metal secundário',
  'Peso bruto',
  'Pureza',
  'Valor facial',
  'Cunhagem',
  'Data de compra',
  'Vendedor',
  'Local',
  'Observações',
  'Custo de compra',
  'Custo por unidade',
  'Origem do custo',
  'Tipo do custo',
  'Grade',
  'Escala da grade',
  'Status',
  'Rating',
  'Principal',
  'Descrição',
  'Tags',
  'Histórico',
  'Curiosidades',
  'Referências de catálogo',
  'Data de criação',
]

describe('generateCollectionXlsx — estrutura do workbook', () => {
  it('gera um Blob não vazio, com o content-type de xlsx', async () => {
    const blob = await generateCollectionXlsx([makeItem()])
    expect(blob.size).toBeGreaterThan(0)
  })

  it('é um ZIP válido (formato .xlsx real) — descompacta sem lançar erro', async () => {
    const blob = await generateCollectionXlsx([makeItem()])
    await expect(unzipAllText(blob)).resolves.toBeDefined()
  })

  it('as abas "Resumo" e "Coleção" existem no workbook', async () => {
    const blob = await generateCollectionXlsx([makeItem()])
    const { entries } = await unzipAllText(blob)
    const workbookXml = entries['xl/workbook.xml']

    expect(workbookXml).toBeDefined()
    expect(workbookXml).toContain('Resumo')
    expect(workbookXml).toContain('Coleção')
  })

  it('coleção vazia gera um workbook válido (nunca lança, nunca um arquivo corrompido)', async () => {
    const blob = await generateCollectionXlsx([])
    expect(blob.size).toBeGreaterThan(0)
    const { entries } = await unzipAllText(blob)
    expect(entries['xl/workbook.xml']).toContain('Resumo')
    expect(entries['xl/workbook.xml']).toContain('Coleção')
  })

  it('1 item gera um workbook válido', async () => {
    await expect(generateCollectionXlsx([makeItem()])).resolves.toBeInstanceOf(Blob)
  })

  it('múltiplos itens geram um workbook válido', async () => {
    const items = Array.from({ length: 25 }, () => makeItem())
    await expect(generateCollectionXlsx(items)).resolves.toBeInstanceOf(Blob)
  })
})

describe('generateCollectionXlsx — cabeçalhos e dados presentes (aba Coleção)', () => {
  it('todos os 31 cabeçalhos (mesmos do CSV) estão presentes em algum lugar do workbook', async () => {
    const blob = await generateCollectionXlsx([makeItem()])
    const { allText } = await unzipAllText(blob)

    for (const header of CSV_EQUIVALENT_HEADERS) {
      expect(allText).toContain(header)
    }
  })

  it('dados de texto do item aparecem no workbook', async () => {
    const item = makeItem({ countryDisplayName: 'Brasil', denomination: '1 Real Comemorativo', mint: 'Casa da Moeda' })
    const blob = await generateCollectionXlsx([item])
    const { allText } = await unzipAllText(blob)

    expect(allText).toContain('Brasil')
    expect(allText).toContain('1 Real Comemorativo')
    expect(allText).toContain('Casa da Moeda')
  })
})

/**
 * Etapa "XLSX UI Integration" — auditoria "XLSX UI Integration Audit"
 * (Seção 6) verificou no código-fonte de `write-excel-file` que uma célula
 * só vira fórmula real quando o cell object usa explicitamente
 * `type: 'Formula'` — `export-xlsx.ts` nunca faz isso em nenhuma coluna.
 * Este bloco PROVA isso no arquivo `.xlsx` REAL gerado (não só por leitura
 * de código): um valor de texto livre começando com `=`/`+`/`-`/`@` chega
 * ao workbook como texto puro, e o arquivo inteiro nunca contém nenhum
 * elemento de fórmula OOXML (`<f>...</f>`) — diferente do CSV (documentado
 * separadamente em collection-export.test.ts, sem correção nesta etapa).
 */
describe('generateCollectionXlsx — valores começando com =/+/-/@ NUNCA viram fórmula real (diferente do CSV)', () => {
  it.each(['=1+1', '+1+1', '-1+1', '@SUM(1,1)'])(
    'campo "%s" chega ao workbook como texto puro, e o arquivo não contém nenhum elemento de fórmula OOXML (<f>)',
    async (value) => {
      const item = makeItem({ description: value })
      const blob = await generateCollectionXlsx([item])
      const { allText } = await unzipAllText(blob)

      expect(allText).toContain(value)
      expect(allText).not.toMatch(/<f>/)
      expect(allText).not.toMatch(/<f [^>]*>/)
    },
  )
})

describe('generateCollectionXlsx — números e datas são células REAIS do Excel', () => {
  it('peso bruto decimal é gravado como NÚMERO real (ponto decimal cru no XML), nunca como texto formatado com vírgula', async () => {
    const item = makeItem({ grossWeightG: 7.55 })
    const blob = await generateCollectionXlsx([item])
    const { allText } = await unzipAllText(blob)

    expect(allText).toContain('7.55')
    expect(allText).not.toContain('7,55')
  })

  it('custo de compra é gravado como número real, nunca texto formatado com vírgula/símbolo de moeda', async () => {
    const item = makeItem({ units: [makeUnit({ unitCost: 123.4 })] })
    const blob = await generateCollectionXlsx([item])
    const { allText } = await unzipAllText(blob)

    expect(allText).not.toContain('123,40')
    expect(allText).not.toContain('R$')
    expect(allText).not.toContain('$123')
  })

  it('data de compra é gravada como DATA real (número de série do Excel), nunca a string ISO ou formatada literal', async () => {
    const item = makeItem({ purchase: { totalPrice: 10, purchaseDate: '2023-06-15', sellerName: null, notes: null } })
    const blob = await generateCollectionXlsx([item])
    const { allText } = await unzipAllText(blob)

    expect(allText).not.toContain('2023-06-15')
    expect(allText).not.toContain('15/06/2023')
  })

  it('quantidade permanece um valor numérico simples (sem símbolo/prefixo)', async () => {
    const item = makeItem({ quantity: 7 })
    const blob = await generateCollectionXlsx([item])
    const { allText } = await unzipAllText(blob)
    expect(allText).toMatch(/(^|[^0-9])7([^0-9]|$)/)
  })
})

describe('generateCollectionXlsx — ausência de dados proibidos', () => {
  it('nenhum id interno (collection_items.id/collection_units.id/purchase_id) aparece no workbook', async () => {
    const item = makeItem()
    const blob = await generateCollectionXlsx([item])
    const { allText } = await unzipAllText(blob)

    expect(allText).not.toContain(item.id)
    expect(allText).not.toContain(item.purchaseId ?? '__never__')
    expect(allText).not.toContain(item.units[0].id)
  })

  it('user_id nunca aparece no workbook', async () => {
    const item = makeItem({ userId: 'user-secret-1' })
    const blob = await generateCollectionXlsx([item])
    const { allText } = await unzipAllText(blob)

    expect(allText).not.toContain('user-secret-1')
    expect(allText).not.toContain('userId')
    expect(allText).not.toContain('user_id')
  })

  it('nenhum dado administrativo ou termo de mercado/patrimônio/lucro aparece em nenhum lugar do workbook', async () => {
    const blob = await generateCollectionXlsx([makeItem()])
    const { allText } = await unzipAllText(blob)

    for (const forbidden of ['valor de mercado', 'patrimônio', 'lucro', 'prejuízo', 'rentabilidade', 'valorização', 'cotação', 'service_role']) {
      expect(allText.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })
})

describe('generateCollectionXlsx — Resumo: distinção itens x exemplares e custo desconhecido', () => {
  it('itens com quantity diferente refletem "Total de itens"/"Total de exemplares" corretos (nunca confundidos)', async () => {
    const items = [makeItem({ quantity: 1 }), makeItem({ quantity: 4 })]
    const blob = await generateCollectionXlsx(items)
    const { allText } = await unzipAllText(blob)

    expect(allText).toContain('Total de itens')
    expect(allText).toContain('Total de exemplares')
  })

  it('custo desconhecido em toda a coleção: "Custo total de aquisição conhecido" nunca aparece como "0" — a linha é omitida', async () => {
    const items = [makeItem({ units: [makeUnit({ unitCost: null })] })]
    const blob = await generateCollectionXlsx(items)
    const { allText } = await unzipAllText(blob)

    expect(allText).not.toContain('Custo total de aquisição conhecido')
  })

  it('custo conhecido em pelo menos um item: "Custo total de aquisição conhecido" aparece', async () => {
    const items = [makeItem({ units: [makeUnit({ unitCost: 500 })] })]
    const blob = await generateCollectionXlsx(items)
    const { allText } = await unzipAllText(blob)

    expect(allText).toContain('Custo total de aquisição conhecido')
  })
})

describe('buildCollectionExportXlsxFilename', () => {
  it('formato numora-colecao-YYYY-MM-DD.xlsx, sem dado pessoal', () => {
    const date = new Date(2026, 2, 5)
    expect(buildCollectionExportXlsxFilename(date)).toBe('numora-colecao-2026-03-05.xlsx')
  })
})

describe('generateCollectionXlsx — segurança (inspeção de fonte, sem chamadas externas)', () => {
  it('o módulo NUNCA importa/chama Stripe/Supabase/fetch de API/Storage (busca por USO real, não por menção em comentário/prosa)', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const source = readFileSync(path.resolve(__dirname, '../../features/collection/export-xlsx.ts'), 'utf8')

    expect(source).not.toMatch(/^import .*(stripe|supabase)/im)
    expect(source).not.toMatch(/getStripeClient\(/)
    expect(source).not.toMatch(/getSupabase\w*Client\(/)
    expect(source).not.toMatch(/await fetch\(|=\s*fetch\(/)
    expect(source).not.toMatch(/\.storage\./)
    expect(source).not.toMatch(/'\/api\//)
  })
})

/**
 * Regressão 5.10V (blocker da auditoria final) — datas de calendário
 * deslocadas em 1 dia em fusos UTC+1 ou superiores.
 *
 * `write-excel-file` serializa `Date` como `getTime() / 86400000 + 25569`
 * (instante UTC, sem fuso); uma `Date` à meia-noite LOCAL cai no dia
 * anterior para quem está a leste de UTC. Estes testes NÃO comparam
 * strings: leem o NÚMERO DE SÉRIE gravado no XML do `.xlsx` gerado pela
 * biblioteca real, convertem para o dia de calendário que o Excel exibiria
 * e exigem também que seja um inteiro (sem fração de hora escondida).
 *
 * O fuso do processo é trocado em tempo de execução (`process.env.TZ`) e
 * cada teste confirma que a troca teve efeito (`getTimezoneOffset`) — se o
 * ambiente não honrar `TZ`, o teste falha ruidosamente em vez de passar sem
 * exercitar nada.
 */
const TIME_ZONES = [
  { tz: 'America/Sao_Paulo', offsetMinutes: 180 },
  { tz: 'Europe/Madrid', offsetMinutes: -60 },
  { tz: 'Asia/Tokyo', offsetMinutes: -540 },
] as const

async function withTimeZone<T>(tz: string, expectedOffsetMinutes: number, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.TZ
  process.env.TZ = tz
  try {
    // Referência em março de 2026 (fora de qualquer troca de horário de verão relevante).
    expect(new Date(2026, 2, 5).getTimezoneOffset(), `TZ=${tz} não teve efeito neste ambiente`).toBe(expectedOffsetMinutes)
    return await fn()
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)
  return match ? match[1] : null
}

interface ParsedSheet {
  /** Ex.: "B2" → conteúdo (string resolvida da sharedStrings, ou o valor cru de células numéricas). */
  cells: Map<string, { isText: boolean; value: string }>
}

async function readSheets(blob: Blob): Promise<Record<string, ParsedSheet>> {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  const text = (path: string) => strFromU8(files[path])

  const sharedStrings = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((si) =>
    [...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''),
  )

  const relTargets = new Map<string, string>()
  for (const rel of text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*\/>/g)) {
    relTargets.set(attr(rel[0], 'Id')!, attr(rel[0], 'Target')!)
  }

  const sheets: Record<string, ParsedSheet> = {}
  for (const sheetTag of text('xl/workbook.xml').matchAll(/<sheet\b[^>]*\/>/g)) {
    const name = attr(sheetTag[0], 'name')!
    const target = relTargets.get(attr(sheetTag[0], 'r:id')!)!
    const xml = text(`xl/${target}`)

    const cells = new Map<string, { isText: boolean; value: string }>()
    for (const cell of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const valueMatch = cell[3] ? /<v>([\s\S]*?)<\/v>/.exec(cell[3]) : null
      if (!valueMatch) continue
      const isText = attr(cell[2], 't') === 's'
      cells.set(cell[1], { isText, value: isText ? sharedStrings[Number(valueMatch[1])] : valueMatch[1] })
    }
    sheets[name] = { cells }
  }
  return sheets
}

/** Serial do Excel → `YYYY-MM-DD` do dia que o Excel exibiria; falha se houver fração de hora escondida. */
function serialToCalendarDay(cell: { isText: boolean; value: string } | undefined, where: string): string {
  expect(cell, `${where}: célula ausente`).toBeDefined()
  expect(cell!.isText, `${where}: deveria ser célula de data (número), não texto`).toBe(false)
  const serial = Number(cell!.value)
  expect(Number.isInteger(serial), `${where}: serial ${serial} tem fração de hora escondida`).toBe(true)
  return new Date(Math.round((serial - 25569) * 86400000)).toISOString().slice(0, 10)
}

function columnOfHeader(sheet: ParsedSheet, header: string): string {
  for (const [ref, cell] of sheet.cells) {
    if (/^[A-Z]+1$/.test(ref) && cell.isText && cell.value === header) return ref.replace('1', '')
  }
  throw new Error(`cabeçalho "${header}" não encontrado`)
}

function rowOfLabel(sheet: ParsedSheet, label: string): number {
  for (const [ref, cell] of sheet.cells) {
    if (/^A\d+$/.test(ref) && cell.isText && cell.value === label) return Number(ref.slice(1))
  }
  throw new Error(`rótulo "${label}" não encontrado`)
}

describe('generateCollectionXlsx — datas de calendário NUNCA mudam de dia com o fuso (regressão 5.10V, biblioteca real)', () => {
  const purchaseDates = ['2026-03-05', '2026-01-01', '2026-12-31']

  function itemsWithPurchases(): CollectionItem[] {
    return purchaseDates.map((purchaseDate) => makeItem({ purchase: { totalPrice: 10, purchaseDate, sellerName: null, notes: null } }))
  }

  it.each(TIME_ZONES)('$tz: "Data de compra" (aba Coleção) continua no mesmo dia, inclusive na virada de ano', async ({ tz, offsetMinutes }) => {
    await withTimeZone(tz, offsetMinutes, async () => {
      const sheets = await readSheets(await generateCollectionXlsx(itemsWithPurchases()))
      const collection = sheets['Coleção']
      const column = columnOfHeader(collection, 'Data de compra')

      expect(serialToCalendarDay(collection.cells.get(`${column}2`), `${tz} Data de compra 1`)).toBe('2026-03-05')
      expect(serialToCalendarDay(collection.cells.get(`${column}3`), `${tz} Data de compra 2`)).toBe('2026-01-01')
      expect(serialToCalendarDay(collection.cells.get(`${column}4`), `${tz} Data de compra 3`)).toBe('2026-12-31')
    })
  })

  it.each(TIME_ZONES)('$tz: "Primeira aquisição" e "Última aquisição" (aba Resumo) continuam no mesmo dia', async ({ tz, offsetMinutes }) => {
    await withTimeZone(tz, offsetMinutes, async () => {
      const sheets = await readSheets(await generateCollectionXlsx(itemsWithPurchases()))
      const summary = sheets['Resumo']

      const firstRow = rowOfLabel(summary, 'Primeira aquisição')
      const lastRow = rowOfLabel(summary, 'Última aquisição')
      expect(serialToCalendarDay(summary.cells.get(`B${firstRow}`), `${tz} Primeira aquisição`)).toBe('2026-01-01')
      expect(serialToCalendarDay(summary.cells.get(`B${lastRow}`), `${tz} Última aquisição`)).toBe('2026-12-31')
    })
  })

  it.each(TIME_ZONES)('$tz: a mesma data 05/03/2026 é idêntica entre as abas Resumo e Coleção', async ({ tz, offsetMinutes }) => {
    await withTimeZone(tz, offsetMinutes, async () => {
      const item = makeItem({ purchase: { totalPrice: 10, purchaseDate: '2026-03-05', sellerName: null, notes: null } })
      const sheets = await readSheets(await generateCollectionXlsx([item]))

      const column = columnOfHeader(sheets['Coleção'], 'Data de compra')
      const inCollection = serialToCalendarDay(sheets['Coleção'].cells.get(`${column}2`), `${tz} Coleção`)
      const inSummary = serialToCalendarDay(sheets['Resumo'].cells.get(`B${rowOfLabel(sheets['Resumo'], 'Primeira aquisição')}`), `${tz} Resumo`)

      expect(inCollection).toBe('2026-03-05')
      expect(inSummary).toBe('2026-03-05')
    })
  })
})

describe('generateCollectionXlsx — "Data de criação" é um INSTANTE exibido como dia LOCAL (mesmo dia do CSV)', () => {
  // `createdAt` é `timestamptz`: o dia exibido é o dia de calendário LOCAL do
  // instante (igual ao `toLocaleDateString` do CSV), não o dia UTC.
  const CASES = [
    // 2026-03-06T01:00Z = 05/03 22:00 em São Paulo, 06/03 02:00 em Madri, 06/03 10:00 em Tóquio.
    { tz: 'America/Sao_Paulo', offsetMinutes: 180, createdAt: '2026-03-06T01:00:00.000Z', expectedDay: '2026-03-05' },
    { tz: 'Europe/Madrid', offsetMinutes: -60, createdAt: '2026-03-06T01:00:00.000Z', expectedDay: '2026-03-06' },
    { tz: 'Asia/Tokyo', offsetMinutes: -540, createdAt: '2026-03-06T01:00:00.000Z', expectedDay: '2026-03-06' },
    // 2024-03-05T10:00Z cai em 05/03 nos três fusos (07:00 / 11:00 / 19:00 locais).
    { tz: 'America/Sao_Paulo', offsetMinutes: 180, createdAt: '2024-03-05T10:00:00.000Z', expectedDay: '2024-03-05' },
    { tz: 'Europe/Madrid', offsetMinutes: -60, createdAt: '2024-03-05T10:00:00.000Z', expectedDay: '2024-03-05' },
    { tz: 'Asia/Tokyo', offsetMinutes: -540, createdAt: '2024-03-05T10:00:00.000Z', expectedDay: '2024-03-05' },
  ] as const

  it.each(CASES)('$tz, criado em $createdAt → exibe $expectedDay (inteiro, igual ao dia local do CSV)', async ({ tz, offsetMinutes, createdAt, expectedDay }) => {
    await withTimeZone(tz, offsetMinutes, async () => {
      const sheets = await readSheets(await generateCollectionXlsx([makeItem({ createdAt })]))
      const column = columnOfHeader(sheets['Coleção'], 'Data de criação')

      expect(serialToCalendarDay(sheets['Coleção'].cells.get(`${column}2`), `${tz} Data de criação`)).toBe(expectedDay)

      // Mesmo dia que o CSV mostra para o mesmo instante (dia local, dd/mm/yyyy).
      const localDay = new Date(createdAt).toLocaleDateString('pt-BR')
      const [day, month, year] = localDay.split('/')
      expect(`${year}-${month}-${day}`).toBe(expectedDay)
    })
  })
})
