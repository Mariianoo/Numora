/**
 * vitest.config.mts
 * Etapa "F2 — Closed Beta Test Suite". Cobre `tests/unit` (sem rede) e
 * `tests/integration` (Supabase DEV real, ver tests/support/dev-env.ts) —
 * um único config, já que os dois só diferem em SE fazem chamadas de
 * rede, não em ferramenta. `tests/e2e` fica de fora — é Playwright, não
 * Vitest (ver playwright.config.ts).
 *
 * Extensão `.mts` (não `.ts`): evita o aviso do Vite ("ESM syntax loaded
 * como CommonJS") sem precisar declarar `"type": "module"` no
 * `package.json` do projeto inteiro — mudança isolada a este arquivo.
 *
 * Carrega `.env.test.local` (gitignored, nunca commitado — ver
 * `.env.test.example`) para `process.env`, mesmo mecanismo de `.env.*`
 * que o Vite já usa, só redirecionado para `process.env` porque os testes
 * de integration usam `@supabase/supabase-js` em Node puro (lêem
 * `process.env` diretamente, não `import.meta.env`).
 */
import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }

  return {
    resolve: {
      alias: {
        '@': path.resolve(dirname, '.'),
      },
    },
    test: {
      environment: 'node',
      include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
      // Testes de integration fazem round-trips reais contra Supabase DEV
      // (signup, RPC, Storage) — 20s dá folga sem mascarar uma falha real
      // de rede como timeout. Unit tests terminam bem abaixo disso.
      testTimeout: 20_000,
      // Etapa "Stripe 4.1.1" — achado real: Vitest roda arquivos de teste em
      // paralelo por padrão, e dois arquivos de tests/integration podem
      // mutar/ler o mesmo estado em Supabase DEV ao mesmo tempo (visto
      // reproduzido: um teste criando uma linha temporária na combinação
      // real "pro/month/BRL" colidindo com outro lendo o catálogo). Só
      // afeta arquivos entre si — testes dentro do MESMO arquivo continuam
      // com o comportamento de concorrência de sempre.
      fileParallelism: false,
    },
  }
})
