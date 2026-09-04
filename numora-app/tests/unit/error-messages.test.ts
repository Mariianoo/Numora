import { describe, expect, it } from 'vitest'

import {
  getUserFriendlyErrorMessage,
  GENERIC_ERROR_MESSAGE,
} from '@/lib/errors/get-user-friendly-error-message'
import { mapAuthErrorMessage } from '@/features/auth/map-auth-error-message'

describe('getUserFriendlyErrorMessage', () => {
  it('reconhece erro de rede e devolve mensagem de conexão', () => {
    const err = new TypeError('Failed to fetch')
    expect(getUserFriendlyErrorMessage(err)).toMatch(/conectar ao servidor/i)
  })

  it('reconhece sessão expirada (401)', () => {
    expect(getUserFriendlyErrorMessage({ status: 401 })).toMatch(/sessão expirou/i)
  })

  it('reconhece permissão negada (403)', () => {
    expect(getUserFriendlyErrorMessage({ status: 403 })).toMatch(/não tem permissão/i)
  })

  it('erro 5xx vira mensagem genérica', () => {
    expect(getUserFriendlyErrorMessage({ status: 500 })).toBe(GENERIC_ERROR_MESSAGE)
  })

  it('nunca expõe mensagem técnica de Postgres/PostgREST', () => {
    const err = new Error('duplicate key value violates unique constraint "uq_profiles_username"')
    expect(getUserFriendlyErrorMessage(err)).toBe(GENERIC_ERROR_MESSAGE)
  })

  it('nunca expõe o prefixo interno de repository quando embute erro cru', () => {
    const err = new Error('[ProfileRepository] Falha ao atualizar perfil: connection terminated unexpectedly')
    expect(getUserFriendlyErrorMessage(err)).toBe(GENERIC_ERROR_MESSAGE)
  })

  it('mensagem de negócio já curada (sem erro cru embutido) passa quase inalterada, só sem o prefixo interno', () => {
    const err = new Error('[ProfileRepository] Este nome de usuário já está em uso.')
    expect(getUserFriendlyErrorMessage(err)).toBe('Este nome de usuário já está em uso.')
  })

  it('fallback seguro para erro sem mensagem reconhecível', () => {
    expect(getUserFriendlyErrorMessage(new Error(''))).toBe(GENERIC_ERROR_MESSAGE)
  })

  it('usa o fallback explícito quando fornecido (ex.: mapAuthErrorMessage)', () => {
    expect(getUserFriendlyErrorMessage(new Error('algo sem padrão conhecido'), 'mensagem alternativa segura')).toBe(
      'algo sem padrão conhecido',
    )
  })
})

describe('mapAuthErrorMessage — códigos conhecidos', () => {
  it('invalid_credentials', () => {
    expect(mapAuthErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(
      'E-mail ou senha incorretos.',
    )
  })

  it('email_not_confirmed', () => {
    expect(mapAuthErrorMessage({ code: 'email_not_confirmed', message: 'Email not confirmed' })).toMatch(
      /confirme seu e-mail/i,
    )
  })

  it('user_already_exists e email_exists mapeiam para a mesma mensagem', () => {
    const a = mapAuthErrorMessage({ code: 'user_already_exists', message: 'x' })
    const b = mapAuthErrorMessage({ code: 'email_exists', message: 'x' })
    expect(a).toBe(b)
    expect(a).toMatch(/já existe uma conta/i)
  })

  it('weak_password', () => {
    expect(mapAuthErrorMessage({ code: 'weak_password', message: 'x' })).toMatch(/senha muito fraca/i)
  })

  it('same_password', () => {
    expect(mapAuthErrorMessage({ code: 'same_password', message: 'x' })).toMatch(/diferente da atual/i)
  })

  it('over_email_send_rate_limit', () => {
    expect(mapAuthErrorMessage({ code: 'over_email_send_rate_limit', message: 'x' })).toMatch(/muitas tentativas/i)
  })

  it('fallback: código não mapeado devolve a mensagem original quando ela não bate em padrão técnico', () => {
    expect(mapAuthErrorMessage({ code: 'algum_codigo_novo_do_sdk', message: 'Something happened' })).toBe(
      'Something happened',
    )
  })

  it('fallback: sem código nenhum também cai no fallback (mensagem sem padrão técnico reconhecido passa como está)', () => {
    expect(mapAuthErrorMessage({ message: 'Network error' })).toBe('Network error')
  })

  /**
   * `signup_disabled` NÃO tem `case` próprio (gap conhecido, já reportado
   * na Etapa "Closed Beta UX" — ver comentário em
   * features/auth/map-auth-error-message.ts). Este teste documenta o
   * comportamento REAL hoje, não o ideal: cai no fallback e, como a
   * mensagem do GoTrue não bate em nenhum padrão técnico reconhecido,
   * "vaza" em inglês. Inofensivo na prática porque `/signup` não chama
   * mais `signUp()` — vira uma tela informativa de Beta Fechado. Corrigir
   * isso é uma mudança de comportamento fora do escopo desta etapa (só
   * testes).
   */
  it('signup_disabled cai no fallback e hoje devolve a mensagem bruta do GoTrue (comportamento documentado, não corrigido nesta etapa)', () => {
    expect(mapAuthErrorMessage({ code: 'signup_disabled', message: 'Signups not allowed for this instance' })).toBe(
      'Signups not allowed for this instance',
    )
  })
})
