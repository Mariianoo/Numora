/**
 * playwright.config.ts
 * Etapa "F2 — Closed Beta Test Suite" — E2E mínimo do Closed Beta.
 *
 * `baseURL` vem de `PLAYWRIGHT_BASE_URL`, com fallback só para
 * `http://localhost:3000` — NUNCA um domínio de Production como fallback.
 * Os specs que precisam de Supabase usam `tests/support/dev-env.ts`, que
 * tem o próprio guard contra Production independente deste arquivo.
 *
 * `webServer.reuseExistingServer: true` — se um servidor já estiver de pé
 * em `baseURL` (ex.: `npm run dev` já rodando), reaproveita; senão sobe um
 * novo com `npm run dev`, sempre contra o Supabase de `.env.local`
 * (DEV neste projeto — nunca Production).
 */
import { defineConfig, devices } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Carrega `.env.test.local` (gitignored — ver `.env.test.example`) para
 * `process.env`, sem depender do pacote `dotenv` (nenhuma dependência
 * nova só para isso). Playwright, diferente do Vitest, não carrega `.env.*`
 * sozinho — precisa deste passo manual. Nunca sobrescreve uma variável já
 * definida no ambiente (mesma regra de precedência do Vite).
 */
function loadTestEnvFile(): void {
  const envPath = path.resolve(__dirname, '.env.test.local')
  if (!existsSync(envPath)) return

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([^#=\s][^=]*)=(.*)$/)
    if (!match) continue
    const [, key, value] = match
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

loadTestEnvFile()

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  // Contas de teste fazem login/logout/exclusão reais — evita corrida de
  // sessão entre specs rodando ao mesmo tempo contra o mesmo servidor.
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
