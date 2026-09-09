/**
 * app/api/account/delete/route.ts
 * Etapa 15.10.17B — orquestração server-side da exclusão voluntária da
 * própria conta. Único Route Handler do projeto que usa a `service_role`
 * (via lib/supabase/admin.ts) — todo o resto da aplicação usa `anon key`.
 *
 * Ordem (auditada e aprovada na etapa de planejamento; revisada na Etapa
 * "5.7 — Account Deletion x Stripe" para inserir o passo 3):
 *   1. Sessão real (cookie) → identifica o usuário, nunca aceita user_id do body.
 *   2. Bloqueia `owner` usando is_platform_owner() na sessão real (auth.uid()
 *      resolve corretamente aqui — client de sessão normal, não admin).
 *   3. [Etapa 5.7] Cancela TODA subscription Stripe não-terminal do Customer
 *      deste usuário (`cancelAllStripeSubscriptionsForAccountDeletion`,
 *      lib/stripe/subscription-management.ts) — ANTES de qualquer alteração
 *      local. Se essa etapa falhar (Stripe indisponível, cancelamento
 *      rejeitado, etc.), a exclusão inteira é abortada AQUI: nenhum ban,
 *      nenhuma remoção de Storage, nenhuma chamada à RPC, nenhum
 *      `deleteUser` — o usuário continua com a conta intacta e pode tentar
 *      de novo. Isso é o que impede uma subscription Stripe `active`
 *      sobreviver à exclusão da conta local (achado do audit pós-Stripe
 *      5.6, SEC-01). Usuário Free/courtesy-only nunca instancia o client
 *      Stripe (a função só o faz se existir `billing_customers.stripe_customer_id`).
 *   4. Bane a conta (auth.admin.updateUserById, ban_duration ~100 anos) —
 *      bloqueio de login imediato, antes de qualquer dado ser tocado.
 *   5. Lista e remove TODOS os objetos do usuário nos DOIS buckets de fotos
 *      — o privado (`coin-images`, originais) e o público (`coin-images-public`,
 *      derivações com marca d'água — Fundação de imagens/Fix 2 da revisão
 *      arquitetural). Mesma função `listAllUserFiles`, só parametrizada
 *      pelo bucket — nenhuma lógica de descoberta de path duplicada.
 *      Storage.list() não é recursivo (confirmado na documentação oficial:
 *      "pastas" são só prefixos, sem API de listagem em árvore) — como o
 *      path é {user_id}/{collection_unit_id}/{kind}.webp (2 níveis), listamos
 *      o primeiro nível e, para cada entrada sem `metadata` (= pasta, não
 *      arquivo — mesmo critério usado no script oficial de migração de
 *      Storage do Supabase), listamos o nível seguinte. Sem isso, a
 *      derivação pública de uma foto publicada sobreviveria à exclusão da
 *      conta inteira, contradizendo a Política de Privacidade.
 *   6. Chama delete_own_account_data(userId) — RPC SECURITY DEFINER,
 *      EXECUTE só para service_role, bloqueia owner internamente também
 *      (defesa em profundidade, Etapa 15.10.17B migration 3).
 *   7. auth.admin.deleteUser(userId) — documentação oficial confirma que
 *      isso FALHA se sobrar qualquer objeto de Storage do usuário; por isso
 *      o passo 5 é obrigatório antes deste. "Não encontrado" é tratado como
 *      sucesso (idempotência — 2ª chamada nunca falha).
 *
 * Cada etapa aborta e retorna erro se a anterior não teve certeza de
 * sucesso — nunca prossegue "torcendo para dar certo". Nenhuma etapa
 * reverte as anteriores (não há rollback cross-sistema possível entre
 * Stripe/GoTrue/Storage/Postgres) — a ordem escolhida minimiza o risco
 * residual em vez de prometer atomicidade impossível (ver relatório da
 * etapa). O Stripe Customer NUNCA é deletado (`customers.del`) — só a
 * capacidade de gerar nova cobrança é removida; o histórico de invoices
 * permanece no Stripe para auditoria/contabilidade.
 */
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { getStripeClient } from '@/lib/stripe/client'
import { cancelAllStripeSubscriptionsForAccountDeletion } from '@/lib/stripe/subscription-management'
import { PUBLIC_COIN_IMAGE_BUCKET } from '@/features/coin-images/types'

const PRIVATE_COIN_IMAGES_BUCKET = 'coin-images'
const BAN_DURATION = '876000h' // ~100 anos — bloqueio de login efetivamente permanente
const LIST_PAGE_LIMIT = 1000

interface StorageListEntry {
  name: string
  metadata: Record<string, unknown> | null
}

/**
 * Lista todos os arquivos de um usuário num bucket, resolvendo o 2º nível
 * (collection_unit_id) manualmente — ver comentário do arquivo sobre por
 * que list() não é recursivo. Parametrizada pelo bucket (Fix 2 da revisão
 * arquitetural) para ser chamada tanto para `coin-images` (privado) quanto
 * para `coin-images-public` (derivações) sem duplicar esta lógica.
 */
async function listAllUserFiles(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  bucket: string,
  userId: string,
): Promise<string[]> {
  const { data: firstLevel, error: firstLevelError } = await adminClient.storage
    .from(bucket)
    .list(userId, { limit: LIST_PAGE_LIMIT })

  if (firstLevelError) {
    throw new Error(`Falha ao listar arquivos do usuário em ${bucket}: ${firstLevelError.message}`)
  }

  const paths: string[] = []

  for (const entry of (firstLevel ?? []) as StorageListEntry[]) {
    if (entry.metadata === null) {
      // Entrada sem metadata = "pasta" (prefixo), não arquivo — precisa de
      // mais um nível de list() para chegar aos arquivos de verdade.
      const subPath = `${userId}/${entry.name}`
      const { data: secondLevel, error: secondLevelError } = await adminClient.storage
        .from(bucket)
        .list(subPath, { limit: LIST_PAGE_LIMIT })

      if (secondLevelError) {
        throw new Error(`Falha ao listar arquivos em ${bucket}/${subPath}: ${secondLevelError.message}`)
      }

      for (const file of (secondLevel ?? []) as StorageListEntry[]) {
        paths.push(`${subPath}/${file.name}`)
      }
    } else {
      paths.push(`${userId}/${entry.name}`)
    }
  }

  return paths
}

export async function POST() {
  const sessionClient = await getSupabaseServerClient()

  const {
    data: { user },
    error: userError,
  } = await sessionClient.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const { data: isOwner, error: ownerCheckError } = await sessionClient.rpc('is_platform_owner')

  if (ownerCheckError) {
    Sentry.captureException(ownerCheckError)
    return NextResponse.json({ error: 'Falha ao verificar permissões.' }, { status: 500 })
  }

  if (isOwner) {
    return NextResponse.json(
      { error: 'A conta do proprietário da plataforma não pode ser excluída por este fluxo.' },
      { status: 403 },
    )
  }

  const userId = user.id
  const adminClient = getSupabaseAdminClient()

  // Etapa "5.7" — fail-closed: se o Stripe não puder confirmar que toda
  // subscription não-terminal foi cancelada, a exclusão para AQUI. Nada
  // abaixo desta linha (ban, Storage, RPC, deleteUser) é executado.
  try {
    await cancelAllStripeSubscriptionsForAccountDeletion(adminClient, getStripeClient, userId)
  } catch (err) {
    Sentry.captureException(err)
    return NextResponse.json(
      { error: 'Falha ao cancelar sua assinatura de cobrança. A exclusão foi interrompida com segurança — tente novamente.' },
      { status: 500 },
    )
  }

  const { error: banError } = await adminClient.auth.admin.updateUserById(userId, {
    ban_duration: BAN_DURATION,
  })

  if (banError) {
    Sentry.captureException(banError)
    return NextResponse.json({ error: 'Falha ao iniciar a exclusão da conta.' }, { status: 500 })
  }

  let filePaths: string[]
  let publicFilePaths: string[]
  try {
    filePaths = await listAllUserFiles(adminClient, PRIVATE_COIN_IMAGES_BUCKET, userId)
    publicFilePaths = await listAllUserFiles(adminClient, PUBLIC_COIN_IMAGE_BUCKET, userId)
  } catch (err) {
    Sentry.captureException(err)
    return NextResponse.json(
      { error: 'Falha ao localizar arquivos do usuário. A exclusão foi interrompida com segurança.' },
      { status: 500 },
    )
  }

  if (filePaths.length > 0) {
    const { error: removeError } = await adminClient.storage.from(PRIVATE_COIN_IMAGES_BUCKET).remove(filePaths)

    if (removeError) {
      Sentry.captureException(removeError)
      return NextResponse.json(
        { error: 'Falha ao remover arquivos do usuário. A exclusão foi interrompida com segurança.' },
        { status: 500 },
      )
    }
  }

  if (publicFilePaths.length > 0) {
    const { error: removePublicError } = await adminClient.storage
      .from(PUBLIC_COIN_IMAGE_BUCKET)
      .remove(publicFilePaths)

    if (removePublicError) {
      Sentry.captureException(removePublicError)
      return NextResponse.json(
        { error: 'Falha ao remover arquivos públicos do usuário. A exclusão foi interrompida com segurança.' },
        { status: 500 },
      )
    }
  }

  const { error: rpcError } = await adminClient.rpc('delete_own_account_data', { p_user_id: userId })

  if (rpcError) {
    Sentry.captureException(rpcError)
    return NextResponse.json(
      { error: 'Falha ao remover os dados da conta. A exclusão foi interrompida com segurança.' },
      { status: 500 },
    )
  }

  const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(userId)

  // "Usuário não encontrado" = já foi removido numa tentativa anterior —
  // idempotente, não é falha. Qualquer outro erro continua sendo reportado
  // (nunca mascarar um erro estrutural real como sucesso).
  if (deleteUserError && deleteUserError.status !== 404) {
    Sentry.captureException(deleteUserError)
    return NextResponse.json(
      {
        error:
          'Conta e dados removidos, mas houve falha ao finalizar no Auth. Contate o suporte: suporte.numora@gmail.com.',
      },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true })
}
