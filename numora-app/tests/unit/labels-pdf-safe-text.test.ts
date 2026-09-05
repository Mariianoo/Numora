/**
 * tests/unit/labels-pdf-safe-text.test.ts
 * Etapa "F5 — Labels PDF fix" — `toPdfSafeText` (features/labels/pdf.ts),
 * a rede de segurança contra qualquer caractere fora de
 * WinAnsiEncoding/Latin-1 chegando ao jsPDF (achado real: bandeira Unicode
 * virou lixo binário no PDF impresso em Production).
 */
import { describe, expect, it } from 'vitest'

import { toPdfSafeText } from '@/features/labels/pdf'

describe('toPdfSafeText', () => {
  it('remove emoji de bandeira (par de indicadores regionais, fora do plano básico multilíngue)', () => {
    expect(toPdfSafeText('🇵🇦 Panamá')).toBe('Panamá')
  })

  it('remove emoji comuns (ex.: ❤️, 💡, 🐛) sem afetar o texto ao redor', () => {
    expect(toPdfSafeText('Nota ❤️ especial')).toBe('Nota  especial')
  })

  it('preserva acentos latinos (á, ã, ç, õ, ü, ñ...)', () => {
    expect(toPdfSafeText('São Tomé e Príncipe, Curaçao, España')).toBe('São Tomé e Príncipe, Curaçao, España')
  })

  it('preserva texto ASCII puro sem alteração', () => {
    expect(toPdfSafeText('NMR-0000001')).toBe('NMR-0000001')
  })

  it('remove espaços nas pontas (trim) após a limpeza', () => {
    expect(toPdfSafeText('  🇧🇷 Brasil  ')).toBe('Brasil')
  })

  it('string vazia permanece vazia', () => {
    expect(toPdfSafeText('')).toBe('')
  })
})
