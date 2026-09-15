/**
 * tests/unit/collection-export.test.ts
 * Etapa "5.10U — Exportação da Coleção" — testa o módulo PURO
 * `features/collection/export.ts` com `CollectionItem[]` fabricados, sem
 * nenhum acesso a Supabase/rede/Blob de browser real (o `Blob`/`URL` do
 * Node 18+ já bastam — nenhum jsdom necessário, mesmo espírito de
 * `tests/unit/labels-pdf-safe-text.test.ts`).
 */
import { describe, expect, it } from 'vitest'

import { buildCollectionExportFilename, buildCollectionExportRows, generateCollectionCsv } from '@/features/collection/export'
import type { CatalogReference, CollectionItem, CollectionItemUnit } from '@/features/collection/types'

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
    id: `item-${itemCounter}`,
    userId: 'user-1',
    purchaseId: null,
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

async function blobText(blob: Blob): Promise<string> {
  return blob.text()
}

const HEADER_ROW =
  'País;Ano;Denominação;Casa da moeda;Label Code;Quantidade;Metal;Metal secundário;Peso bruto;Pureza;Valor facial;Cunhagem;Data de compra;Vendedor;Local;Observações;Custo de compra;Custo por unidade;Origem do custo;Tipo do custo;Grade;Escala da grade;Status;Rating;Principal;Descrição;Tags;Histórico;Curiosidades;Referências de catálogo;Data de criação'

describe('generateCollectionCsv — estrutura do arquivo', () => {
  it('0 itens: gera um arquivo válido só com o cabeçalho (nunca um Blob vazio/corrompido)', async () => {
    const blob = generateCollectionCsv([])
    const text = await blobText(blob)

    // `Blob.text()` decodifica como UTF-8 e, por especificação (WHATWG
    // Encoding Standard), o decoder REMOVE um BOM inicial ao decodificar —
    // então o texto decodificado nunca mostra o BOM, mesmo que os BYTES do
    // Blob o contenham de verdade (ver teste seguinte, que verifica os
    // bytes crus via arrayBuffer, a forma correta de provar que o BOM foi
    // escrito).
    expect(text).toBe(`${HEADER_ROW}\r\n`)
  })

  it('inclui BOM UTF-8 nos BYTES do arquivo (compatibilidade Excel Windows) — verificado via arrayBuffer, já que Blob.text() remove o BOM ao decodificar', async () => {
    const blob = generateCollectionCsv([])
    const bytes = new Uint8Array(await blob.arrayBuffer())

    // EF BB BF é a sequência de bytes do BOM UTF-8.
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
  })

  it('usa ";" como separador (convenção Excel pt-BR — "," já é o decimal)', () => {
    expect(HEADER_ROW.includes(';')).toBe(true)
    expect(HEADER_ROW.includes(',')).toBe(false)
  })

  it('tipo MIME correto para CSV UTF-8', () => {
    const blob = generateCollectionCsv([])
    expect(blob.type).toBe('text/csv;charset=utf-8;')
  })

  it('quebras de linha CRLF (RFC 4180)', async () => {
    const text = await blobText(generateCollectionCsv([makeItem()]))
    expect(text).toContain('\r\n')
    expect(text.replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('cabeçalho tem exatamente as 31 colunas esperadas, na ordem certa (nenhum user_id/id interno)', () => {
    const headers = HEADER_ROW.split(';')
    expect(headers).toHaveLength(31)
    expect(headers).not.toContain('user_id')
    expect(headers).not.toContain('id')
    expect(headers).not.toContain('purchase_id')
  })
})

describe('buildCollectionExportRows — 1 item, campos completos', () => {
  it('mapeia identificação/composição corretamente', () => {
    const item = makeItem({
      countryDisplayName: 'Brasil',
      year: 1998,
      denomination: '1 Real',
      mint: 'Casa da Moeda',
      labelCode: 'NMR-0000001',
      quantity: 2,
      metalName: 'Aço inoxidável',
      secondaryMetalName: null,
      grossWeightG: 7.55,
      purity: 0.999,
      faceValue: 1,
      mintage: '500000000',
    })
    const [row] = buildCollectionExportRows([item])

    expect(row[0]).toBe('Brasil')
    expect(row[1]).toBe('1998')
    expect(row[2]).toBe('1 Real')
    expect(row[3]).toBe('Casa da Moeda')
    expect(row[4]).toBe('NMR-0000001')
    expect(row[5]).toBe('2')
    expect(row[6]).toBe('Aço inoxidável')
    expect(row[7]).toBe('')
    expect(row[8]).toBe('7,55')
    expect(row[9]).toBe('0,999')
    expect(row[10]).toBe('1')
    expect(row[11]).toBe('500000000')
  })

  it('ano NUNCA usa agrupamento de milhar (achado real: toLocaleString ingênuo produziria "2.024")', () => {
    const [row] = buildCollectionExportRows([makeItem({ year: 2024 })])
    expect(row[1]).toBe('2024')
    expect(row[1]).not.toContain('.')
  })

  it('mapeia aquisição (data/vendedor/local/observações)', () => {
    const item = makeItem({
      location: 'Cofre de casa',
      purchase: { totalPrice: 150, purchaseDate: '2023-06-15', sellerName: 'Numismática ABC', notes: 'Comprado em feira' },
    })
    const [row] = buildCollectionExportRows([item])

    expect(row[12]).toBe('15/06/2023')
    expect(row[13]).toBe('Numismática ABC')
    expect(row[14]).toBe('Cofre de casa')
    expect(row[15]).toBe('Comprado em feira')
  })

  it('rotula a coluna financeira como "Custo de compra", nunca "Valor" (auditoria 5.10T)', () => {
    expect(HEADER_ROW.split(';')[16]).toBe('Custo de compra')
    expect(HEADER_ROW.split(';')).not.toContain('Valor')
  })

  it('custo de compra/por unidade: exemplar único com unitCost conhecido', () => {
    const item = makeItem({
      purchase: { totalPrice: 200, purchaseDate: null, sellerName: null, notes: null },
      units: [makeUnit({ unitCost: 200, costOrigin: 'manual', costType: 'purchase' })],
    })
    const [row] = buildCollectionExportRows([item])

    expect(row[16]).toBe('200,00')
    expect(row[17]).toBe('200,00')
    expect(row[18]).toBe('Manual')
    expect(row[19]).toBe('Compra')
  })

  it('custo desconhecido (unitCost null) fica em branco — NUNCA "0,00" (custo desconhecido != custo zero real)', () => {
    const item = makeItem({ units: [makeUnit({ unitCost: null })] })
    const [row] = buildCollectionExportRows([item])

    expect(row[16]).toBe('')
    expect(row[17]).toBe('')
  })

  it('exemplares com custo diferente (não uniforme): soma aparece, mas origem/tipo ficam em branco (evita sugerir que vale para o item inteiro)', () => {
    const item = makeItem({
      units: [
        makeUnit({ id: 'u1', unitCost: 100, isPrimary: true, costOrigin: 'auto', costType: 'purchase' }),
        makeUnit({ id: 'u2', unitCost: 300, isPrimary: false, costOrigin: 'manual', costType: 'gift' }),
      ],
    })
    const [row] = buildCollectionExportRows([item])

    expect(row[16]).toBe('400,00')
    expect(row[17]).toBe('200,00')
    expect(row[18]).toBe('')
    expect(row[19]).toBe('')
  })

  it('exemplar (grade/status/rating/principal) reflete o EXEMPLAR PRINCIPAL do item', () => {
    const item = makeItem({
      units: [makeUnit({ gradeLabel: 'MS', gradeScale: 'Sheldon', status: 'for_sale', rating: 4, isPrimary: true })],
    })
    const [row] = buildCollectionExportRows([item])

    expect(row[20]).toBe('MS')
    expect(row[21]).toBe('Sheldon')
    expect(row[22]).toBe('Disponível para venda')
    expect(row[23]).toBe('4')
    expect(row[24]).toBe('Sim')
  })

  it('mapeia descrição/tags/histórico/curiosidades/referências/data de criação', () => {
    const catalogReferences: CatalogReference[] = [
      { catalog: 'KM', code: '649' },
      { catalog: 'Numista', code: 'N#12345' },
    ]
    const item = makeItem({
      description: 'Moeda comemorativa',
      tags: ['comemorativa', 'prata'],
      history: 'Emitida em 1998',
      trivia: 'Rara em alto grau',
      catalogReferences,
      createdAt: '2024-03-05T10:00:00.000Z',
    })
    const [row] = buildCollectionExportRows([item])

    expect(row[25]).toBe('Moeda comemorativa')
    expect(row[26]).toBe('comemorativa; prata')
    expect(row[27]).toBe('Emitida em 1998')
    expect(row[28]).toBe('Rara em alto grau')
    expect(row[29]).toBe('KM 649; Numista N#12345')
    expect(row[30]).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
  })
})

describe('buildCollectionExportRows — campos opcionais ausentes (branco, nunca "null"/"undefined"/"NaN")', () => {
  it('item totalmente vazio (sem compra, sem tags, sem referências, sem exemplares)', () => {
    const item = makeItem({ units: [] })
    const [row] = buildCollectionExportRows([item])

    for (const field of row) {
      expect(field).not.toBe('null')
      expect(field).not.toBe('undefined')
      expect(field).not.toBe('NaN')
    }
    expect(row[12]).toBe('') // data de compra
    expect(row[16]).toBe('') // custo de compra
    expect(row[17]).toBe('') // custo por unidade
    expect(row[20]).toBe('') // grade
    expect(row[22]).toBe('') // status (nenhum exemplar)
    expect(row[26]).toBe('') // tags
    expect(row[29]).toBe('') // referências
  })
})

describe('buildCollectionExportRows — escaping RFC 4180', () => {
  it('acentuação passa sem escaping (não contém separador/aspas/quebra)', () => {
    const item = makeItem({ countryDisplayName: 'Áustria', denomination: 'Cinquenta Réis' })
    const [row] = buildCollectionExportRows([item])
    expect(row[0]).toBe('Áustria')
    expect(row[2]).toBe('Cinquenta Réis')
  })

  it('campo com aspas duplas é escapado (aspas internas duplicadas, campo entre aspas)', () => {
    const item = makeItem({ purchase: { totalPrice: 10, purchaseDate: null, sellerName: 'O "Rei" das Moedas', notes: null } })
    const csv = generateCollectionCsv([item])
    return blobText(csv).then((text) => {
      expect(text).toContain('"O ""Rei"" das Moedas"')
    })
  })

  it('campo contendo o separador (;) é envolvido em aspas', async () => {
    const item = makeItem({ description: 'Comprada; depois avaliada' })
    const text = await blobText(generateCollectionCsv([item]))
    expect(text).toContain('"Comprada; depois avaliada"')
  })

  it('campo contendo vírgula NÃO precisa ser escapado (vírgula não é o separador nesta convenção)', async () => {
    const item = makeItem({ description: 'Comprada, depois avaliada' })
    const text = await blobText(generateCollectionCsv([item]))
    expect(text).toContain('Comprada, depois avaliada')
    expect(text).not.toContain('"Comprada, depois avaliada"')
  })

  it('campo com quebra de linha é envolvido em aspas e preserva a quebra interna', async () => {
    const item = makeItem({ description: 'Linha 1\nLinha 2' })
    const text = await blobText(generateCollectionCsv([item]))
    expect(text).toContain('"Linha 1\nLinha 2"')
  })
})

describe('escala — 50 e 5000 itens', () => {
  it('50 itens: 50 linhas de dados + 1 cabeçalho', async () => {
    const items = Array.from({ length: 50 }, () => makeItem())
    const text = await blobText(generateCollectionCsv(items))
    const lines = text.split('\r\n').filter((line) => line.length > 0)
    expect(lines).toHaveLength(51)
  })

  it('5000 itens: gera sem lançar erro, contagem de linhas correta (não faz query nem I/O — só transformação em memória)', async () => {
    const items = Array.from({ length: 5000 }, () => makeItem())
    const text = await blobText(generateCollectionCsv(items))
    const lines = text.split('\r\n').filter((line) => line.length > 0)
    expect(lines).toHaveLength(5001)
  })
})

describe('buildCollectionExportFilename', () => {
  it('formato numora-colecao-YYYY-MM-DD.csv, sem nenhum dado pessoal', () => {
    const date = new Date(2026, 2, 5) // 5 de março de 2026 (mês 0-indexado)
    expect(buildCollectionExportFilename(date)).toBe('numora-colecao-2026-03-05.csv')
  })

  it('usa a data atual quando nenhuma é informada', () => {
    const filename = buildCollectionExportFilename()
    expect(filename).toMatch(/^numora-colecao-\d{4}-\d{2}-\d{2}\.csv$/)
  })
})
