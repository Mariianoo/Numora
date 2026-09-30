/**
 * tests/unit/legal-versions.test.ts — Etapa "B2 — Signup + Legal".
 * Versionamento legal centralizado e fail-safe (lib/legal/versions.ts).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  AGE_CONFIRMATION_TEXT,
  AGE_CONFIRMATION_VERSION,
  COOKIES_VERSION,
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_TYPES,
  LEGAL_VERSION_PATTERN,
  MARKETING_OPT_IN_VERSION,
  PRIVACY_VERSION,
  TERMS_VERSION,
  getCurrentLegalVersion,
  isCurrentLegalVersion,
  isValidLegalVersion,
} from '@/lib/legal/versions'

const ROOT = path.resolve(__dirname, '../..')

function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.next', '.claude', 'test-results'].includes(entry)) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

describe('versões legais — fonte única', () => {
  it('todas as versões são identificadores válidos e não vazios', () => {
    for (const version of [TERMS_VERSION, PRIVACY_VERSION, COOKIES_VERSION, AGE_CONFIRMATION_VERSION, MARKETING_OPT_IN_VERSION]) {
      expect(version).toMatch(LEGAL_VERSION_PATTERN)
    }
  })

  it('getCurrentLegalVersion devolve a constante de cada tipo', () => {
    expect(getCurrentLegalVersion('terms')).toBe(TERMS_VERSION)
    expect(getCurrentLegalVersion('privacy')).toBe(PRIVACY_VERSION)
    expect(getCurrentLegalVersion('cookies')).toBe(COOKIES_VERSION)
    expect(getCurrentLegalVersion('age_18')).toBe(AGE_CONFIRMATION_VERSION)
    expect(getCurrentLegalVersion('marketing_email')).toBe(MARKETING_OPT_IN_VERSION)
  })

  it('todo tipo controlado tem versão registrada (nenhum tipo sem versão)', () => {
    for (const type of LEGAL_DOCUMENT_TYPES) {
      expect(() => getCurrentLegalVersion(type)).not.toThrow()
    }
  })

  it('tipo desconhecido/ausente FALHA (fail-safe) em vez de devolver vazio', () => {
    // @ts-expect-error — tipo inexistente de propósito
    expect(() => getCurrentLegalVersion('bogus')).toThrow(/Versão ausente ou inválida/)
    // @ts-expect-error — undefined de propósito
    expect(() => getCurrentLegalVersion(undefined)).toThrow()
  })

  it.each([undefined, null, '', ' ', '-x', 'a b', 'x'.repeat(65), 20260925, {}, ['2026-09-25']])(
    'versão ausente/malformada (%j) nunca é "vigente"',
    (value) => {
      expect(isValidLegalVersion(value)).toBe(false)
      expect(isCurrentLegalVersion('terms', value)).toBe(false)
    },
  )

  it('só a versão exata vigente é aceita; versão antiga é rejeitada', () => {
    expect(isCurrentLegalVersion('terms', TERMS_VERSION)).toBe(true)
    expect(isCurrentLegalVersion('terms', '2020-01-01')).toBe(false)
    expect(isCurrentLegalVersion('privacy', TERMS_VERSION === PRIVACY_VERSION ? '1999-01-01' : TERMS_VERSION)).toBe(false)
  })

  it('a lista de tipos é a mesma do CHECK da migration legal_consents', () => {
    const migration = readFileSync(path.join(ROOT, 'supabase/migrations/20260925163425_create_legal_consents.sql'), 'utf8')
    const match = migration.match(/document_type in \(([^)]*)\)/)
    const inMigration = (match?.[1] ?? '').split(',').map((entry) => entry.trim().replace(/'/g, '')).sort()
    expect(inMigration).toEqual([...LEGAL_DOCUMENT_TYPES].sort())
  })

  it('as páginas legais usam a fonte única (versão nunca hardcoded fora de lib/legal/versions.ts)', () => {
    const literal = new RegExp(`['"\`]${TERMS_VERSION}['"\`]`)
    const offenders = listSourceFiles(ROOT)
      .filter((file) => !file.includes(`${path.sep}tests${path.sep}`) && !file.endsWith(path.join('lib', 'legal', 'versions.ts')))
      .filter((file) => literal.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('documentos estão marcados como pendentes de revisão jurídica (nenhum conteúdo declarado definitivo)', () => {
    for (const document of Object.values(LEGAL_DOCUMENTS)) {
      expect(document.reviewStatus).toBe('pending_legal_review')
      expect(document.isCurrent).toBe(true)
      expect(document.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('o texto da declaração de maioridade é exatamente o aprovado', () => {
    expect(AGE_CONFIRMATION_TEXT).toBe('Confirmo que tenho 18 anos ou mais.')
  })
})

describe('páginas legais — versão, vigência e status', () => {
  const strip = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')

  it.each([
    ['app/terms/page.tsx', 'terms'],
    ['app/privacy/page.tsx', 'privacy'],
    ['app/cookies/page.tsx', 'cookies'],
  ])('%s exibe o bloco de versão/vigência (%s)', (file, type) => {
    const source = strip(file)
    expect(source).toContain(`<LegalDocumentMeta type="${type}" />`)
  })

  it('o bloco mostra "PENDENTE DE REVISÃO JURÍDICA" enquanto pendente e lê de lib/legal/versions', () => {
    const source = strip('components/legal/LegalDocumentMeta.tsx')
    expect(source).toContain('PENDENTE DE REVISÃO JURÍDICA')
    expect(source).toContain("from '@/lib/legal/versions'")
    expect(source).toContain('Documento vigente')
  })

  it('nenhuma página legal afirma conformidade jurídica definitiva (LGPD/GDPR "em conformidade")', () => {
    for (const file of ['app/terms/page.tsx', 'app/privacy/page.tsx', 'app/cookies/page.tsx']) {
      expect(strip(file)).not.toMatch(/em conformidade com a (LGPD|GDPR)|totalmente em conformidade|100% em conformidade/i)
    }
  })
})
