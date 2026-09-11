/**
 * lib/health/ready-checks.ts
 * Etapa "5.10L-B — Health Check" — as 3 verificações de dependência usadas
 * por `GET /api/health/ready`. Extraídas do Route Handler para serem
 * testáveis isoladamente (mesmo padrão de `lib/stripe/*` — lógica em
 * `lib/`, Route Handler fino só orquestrando).
 *
 * Nenhuma delas usa `service_role`, nenhuma consulta dado de usuário,
 * nenhuma expõe detalhes internos — cada uma devolve só `'ok' | 'fail'`.
 *
 * Etapa "5.10L-C — Status Page": `getReadinessSnapshot()` (abaixo) é a
 * mesma orquestração usada por `GET /api/health/ready` E por `/status` —
 * nenhuma segunda implementação da lógica "rodar os 3 checks com
 * segurança" foi criada (ver diagrama da etapa: as duas superfícies
 * apontam para esta única camada compartilhada).
 */
import { PostgrestError, type SupabaseClient } from '@supabase/supabase-js'

import { getSupabaseServerClient } from '@/lib/supabase/server'

export type CheckResult = 'ok' | 'fail'

const DATABASE_CHECK_TIMEOUT_MS = 2500
const STORAGE_CHECK_TIMEOUT_MS = 2500

/**
 * Prova que Postgres/PostgREST estão respondendo — NUNCA que a leitura
 * teve sucesso. `plans` é catálogo comercial público (não é dado de
 * usuário); `head: true` garante que nenhuma linha é devolvida.
 *
 * Etapa 5.10L-B (auditoria real contra DEV): a role `anon` não tem NENHUM
 * grant de SELECT em nenhuma tabela pública neste projeto (hardening de
 * grants de etapas anteriores) — então esta consulta SEMPRE volta como
 * `42501 permission denied` quando não há sessão de usuário real. Isso é
 * o resultado ESPERADO e conta como banco "ok": a pergunta aqui é "o
 * Postgres/PostgREST respondeu?", nunca "o endpoint conseguiu ler a
 * tabela?". `.throwOnError()` é o que torna essa distinção possível: com
 * ele, um erro HTTP/PostgREST real (a requisição chegou ao servidor) vira
 * uma instância de `PostgrestError`; uma falha de TRANSPORTE (timeout via
 * `AbortSignal`, DNS, conexão recusada) nunca chega a virar isso — só
 * nesse segundo caso o banco conta como "fail".
 */
export async function checkDatabase(supabase: SupabaseClient): Promise<CheckResult> {
  try {
    await supabase.from('plans').select('id', { count: 'exact', head: true }).abortSignal(AbortSignal.timeout(DATABASE_CHECK_TIMEOUT_MS)).throwOnError()
    return 'ok'
  } catch (err) {
    return err instanceof PostgrestError ? 'ok' : 'fail'
  }
}

/**
 * `GET {SUPABASE_URL}/storage/v1/status` — healthcheck nativo do próprio
 * motor de Storage (storage-api), sem exigir nenhuma API key. Confirmado
 * por sonda real (read-only) contra DEV nesta etapa: `200`, corpo vazio,
 * sem autenticação. Nunca lista bucket, nunca lista arquivo, nunca lê o
 * corpo da resposta (nem para diagnóstico) — só o status HTTP importa.
 */
export async function checkStorage(supabaseUrl: string): Promise<CheckResult> {
  try {
    const response = await fetch(`${supabaseUrl}/storage/v1/status`, {
      signal: AbortSignal.timeout(STORAGE_CHECK_TIMEOUT_MS),
    })
    return response.ok ? 'ok' : 'fail'
  } catch {
    return 'fail'
  }
}

/**
 * Só confirma PRESENÇA (nunca o valor) das 2 variáveis mínimas para a
 * aplicação funcionar. Lida diretamente de `process.env` a cada chamada
 * (nunca via `clientEnv`, o singleton Zod de `lib/env.server.ts` — este
 * resolve uma única vez no boot do processo, então não serviria como uma
 * checagem por requisição). `SUPABASE_SERVICE_ROLE_KEY`/Stripe/
 * `MAINTENANCE_BYPASS_TOKEN` deliberadamente FORA daqui — nenhum é usado
 * pelos checks desta etapa (decisão confirmada no 5.10L-B).
 */
export function checkConfiguration(): CheckResult {
  const hasSupabaseUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL)
  const hasSupabaseAnonKey = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  return hasSupabaseUrl && hasSupabaseAnonKey ? 'ok' : 'fail'
}

export interface ReadinessSnapshot {
  database: CheckResult
  storage: CheckResult
  configuration: CheckResult
}

/**
 * Etapa "5.10L-C — Status Page": roda os 3 checks com segurança e NUNCA
 * lança — usada tanto por `GET /api/health/ready` quanto por `/status`.
 * Constrói o próprio client de sessão (`getSupabaseServerClient()`, anon
 * key + RLS, nunca `service_role`) para que nenhum dos dois chamadores
 * precise saber COMO obter um client, só o QUE o snapshot significa. Uma
 * falha inesperada ao montar o client (nunca observada em teste, mas
 * nunca vale a pena deixar vazar) vira um snapshot "tudo fail", nunca uma
 * exceção crua — mesma filosofia de cada check individual.
 */
export async function getReadinessSnapshot(): Promise<ReadinessSnapshot> {
  try {
    const configuration = checkConfiguration()
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

    const supabase = await getSupabaseServerClient()
    const [database, storage] = await Promise.all([checkDatabase(supabase), checkStorage(supabaseUrl)])

    return { database, storage, configuration }
  } catch {
    return { database: 'fail', storage: 'fail', configuration: 'fail' }
  }
}

export function isReadySnapshot(snapshot: ReadinessSnapshot): boolean {
  return snapshot.database === 'ok' && snapshot.storage === 'ok' && snapshot.configuration === 'ok'
}
