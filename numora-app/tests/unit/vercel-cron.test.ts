/**
 * tests/unit/vercel-cron.test.ts — Etapa "B2.5.7 (Bloco B)".
 * `vercel.json` versionado: UM cron diário que chama a rota de cleanup existente. O segredo nunca
 * mora no arquivo (a Vercel envia `Authorization: Bearer <CRON_SECRET>` a partir da env var do
 * projeto, configurada fora do repositório) e a rota continua protegida por ele.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')
const raw = readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')
const config = JSON.parse(raw) as { crons?: Array<{ path: string; schedule: string }>; [key: string]: unknown }

describe('vercel.json — cron do cleanup de signups pendentes', () => {
  it('declara exatamente UM cron e nenhuma outra configuração', () => {
    expect(Object.keys(config)).toEqual(['crons'])
    expect(config.crons).toHaveLength(1)
  })

  it('o cron chama a rota de cleanup existente, sem query string', () => {
    const [cron] = config.crons ?? []
    expect(cron.path).toBe('/api/internal/signup-cleanup')
    expect(cron.path).not.toMatch(/[?#]/)
    expect(existsSync(path.join(ROOT, 'app/api/internal/signup-cleanup/route.ts'))).toBe(true)
  })

  it('o agendamento é DIÁRIO (minuto e hora fixos, o resto curinga) — o mínimo aceito pelo plano Hobby', () => {
    const [cron] = config.crons ?? []
    const match = cron.schedule.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/)
    expect(match, `schedule "${cron.schedule}" não é diário`).not.toBeNull()
    expect(Number(match![1])).toBeLessThan(60)
    expect(Number(match![2])).toBeLessThan(24)
  })

  it('nenhum segredo, token ou credencial no arquivo (CRON_SECRET só existe como env var do projeto)', () => {
    expect(raw).not.toMatch(/CRON_SECRET|secret|token|bearer|authorization|password|key/i)
    expect(raw).not.toMatch(/https?:\/\//)
  })

  it('a rota é GET (o método do Vercel Cron) e exige Bearer em tempo constante — sem acesso anônimo', () => {
    const route = readFileSync(path.join(ROOT, 'app/api/internal/signup-cleanup/route.ts'), 'utf8')
    expect(route).toMatch(/export async function GET\(/)
    expect(route).not.toMatch(/export (async )?function (POST|PUT|PATCH|DELETE)\b/)
    expect(route).toMatch(/Bearer \$\{secret\}/)
    expect(route).toMatch(/timingSafeEqual/)
    expect(route.indexOf("process.env.CRON_SECRET")).toBeLessThan(route.indexOf('getSupabaseAdminClient()'))
  })
})
