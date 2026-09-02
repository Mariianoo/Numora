/**
 * features/coin-images/repositories/coin-images.repository.ts
 * Infrastructure layer das fotos de exemplar (PROJECT_RULES.md §4.2) —
 * única camada que sabe o nome da tabela `coin_images`, do bucket
 * `coin-images` e do formato do path. Ownership nunca é enviado pelo
 * frontend: a RLS de `coin_images` (via collection_units→collection_items.user_id)
 * e as policies de `storage.objects` (via primeiro segmento do path =
 * auth.uid()) são a proteção real — este repositório só monta o path
 * corretamente, não decide quem pode acessar o quê.
 *
 * Estratégia de upload/replace (path determinístico + upsert):
 * `{user_id}/{collection_unit_id}/{kind}.webp` é sempre o MESMO path
 * para um dado exemplar+tipo, então "substituir uma foto" é só subir de
 * novo no mesmo lugar (`upsert: true`) — não existe um arquivo "antigo"
 * separado para limpar depois, o novo upload já sobrescreve os bytes
 * atômicamente no Storage. Isso elimina a classe de bug "arquivo órfão
 * ao substituir": só sobra decidir o que fazer se o passo seguinte
 * (gravar a linha em `coin_images`) falhar depois do upload já ter tido
 * sucesso.
 *
 * Ordem: 1) upload no Storage; 2) só then grava/atualiza a linha no
 * banco. Se o upload falhar, nada no banco muda — a imagem antiga (se
 * havia) continua válida e visível, erro é propagado para a UI. Se o
 * upload tiver sucesso mas o upsert no banco falhar, o Storage já tem os
 * bytes novos mas a linha em `coin_images` pode ficar ausente (primeira
 * foto daquele tipo) ou desatualizada (substituição) até uma nova
 * tentativa — isso NUNCA deixa o banco apontando para um arquivo
 * inexistente (o caso que realmente quebraria a UI), só no pior caso
 * deixa um objeto no Storage sem linha correspondente por um tempo, que
 * se autocorrige no próximo upload bem-sucedido para o mesmo
 * exemplar+tipo (mesmo path, upsert). Não implementamos rollback do
 * Storage nesse caso: não há para onde reverter (é a primeira foto
 * daquele tipo) ou os bytes antigos já não existem mais para restaurar.
 */
import * as Sentry from '@sentry/nextjs'

import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { PUBLIC_COIN_IMAGE_BUCKET, type CoinImage, type CoinImageKind, type CoinImageUpload } from '@/features/coin-images/types'

const BUCKET = 'coin-images'
const DEFAULT_SIGNED_URL_TTL_SECONDS = 3600

export interface CoinImagesRepository {
  listByUnit(collectionUnitId: string): Promise<CoinImage[]>
  getByUnitAndKind(collectionUnitId: string, kind: CoinImageKind): Promise<CoinImage | null>
  upload(collectionUnitId: string, input: CoinImageUpload): Promise<CoinImage>
  remove(image: CoinImage): Promise<void>
  getSignedUrl(storagePath: string, expiresInSeconds?: number): Promise<string>
  /**
   * Versão em lote de `getSignedUrl` — uma única chamada ao Storage para
   * várias miniaturas (Etapa 10: cartões da coleção), em vez de uma
   * request por card. Paths que falharem (arquivo inexistente, etc.)
   * simplesmente não aparecem no mapa de retorno — quem chama decide como
   * tratar a ausência (ex.: mostrar o estado "sem imagem").
   */
  getSignedUrls(storagePaths: string[], expiresInSeconds?: number): Promise<Record<string, string>>
  /**
   * Fundação de imagens — envia a derivação PÚBLICA (já com marca d'água,
   * gerada no navegador por `applyPublicWatermark`) para o bucket público
   * `coin-images-public`, no MESMO path relativo do original privado
   * (`{user_id}/{collection_unit_id}/{kind}.webp`) — só o bucket muda.
   * Nunca recebe a imagem original, só o blob já processado.
   */
  uploadPublicDerivative(storagePath: string, blob: Blob): Promise<void>
  /**
   * Remove a derivação pública (usuário retirou a foto/moeda do
   * Passport). Nunca toca no bucket privado nem na linha de `coin_images`
   * — só desfaz a cópia derivada.
   */
  removePublicDerivative(storagePath: string): Promise<void>
  /** URL pública estável (sem expiração, sem checagem de RLS) do bucket `coin-images-public` — só faz sentido para paths que passaram por `uploadPublicDerivative`. */
  getPublicUrl(storagePath: string): string
}

interface CoinImageRow {
  id: string
  collection_unit_id: string
  kind: CoinImageKind
  storage_path: string
  width: number
  height: number
  file_size: number
  mime_type: string
  created_at: string
  updated_at: string
}

function toCoinImage(row: CoinImageRow): CoinImage {
  return {
    id: row.id,
    collectionUnitId: row.collection_unit_id,
    kind: row.kind,
    storagePath: row.storage_path,
    width: row.width,
    height: row.height,
    fileSize: row.file_size,
    mimeType: row.mime_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function buildStoragePath(userId: string, collectionUnitId: string, kind: CoinImageKind): string {
  return `${userId}/${collectionUnitId}/${kind}.webp`
}

export function createSupabaseCoinImagesRepository(): CoinImagesRepository {
  const supabase = getSupabaseBrowserClient()

  return {
    async listByUnit(collectionUnitId) {
      const { data, error } = await supabase
        .from('coin_images')
        .select('*')
        .eq('collection_unit_id', collectionUnitId)

      if (error) {
        throw new Error(`[CoinImagesRepository] Falha ao listar imagens: ${error.message}`)
      }

      return (data as CoinImageRow[]).map(toCoinImage)
    },

    async getByUnitAndKind(collectionUnitId, kind) {
      const { data, error } = await supabase
        .from('coin_images')
        .select('*')
        .eq('collection_unit_id', collectionUnitId)
        .eq('kind', kind)
        .maybeSingle()

      if (error) {
        throw new Error(`[CoinImagesRepository] Falha ao buscar imagem: ${error.message}`)
      }

      return data ? toCoinImage(data as CoinImageRow) : null
    },

    async upload(collectionUnitId, input) {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('[CoinImagesRepository] Nenhum usuário logado para associar a imagem.')
      }

      const storagePath = buildStoragePath(user.id, collectionUnitId, input.kind)

      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, input.blob, {
        upsert: true,
        contentType: 'image/webp',
      })

      if (uploadError) {
        throw new Error(`[CoinImagesRepository] Falha ao enviar a imagem: ${uploadError.message}`)
      }

      const { data, error } = await supabase
        .from('coin_images')
        .upsert(
          {
            collection_unit_id: collectionUnitId,
            kind: input.kind,
            storage_path: storagePath,
            width: input.width,
            height: input.height,
            file_size: input.blob.size,
            mime_type: 'image/webp',
          },
          { onConflict: 'collection_unit_id,kind' },
        )
        .select('*')
        .single()

      if (error) {
        // O arquivo já está no Storage com os bytes novos, mas a linha do
        // banco não foi gravada/atualizada — ver comentário no topo do
        // arquivo. Não escondemos isso: propagamos o erro para a UI nunca
        // mostrar "Salvo".
        throw new Error(`[CoinImagesRepository] Upload enviado, mas falha ao salvar os metadados: ${error.message}`)
      }

      return toCoinImage(data as CoinImageRow)
    },

    async remove(image) {
      const { error: storageError } = await supabase.storage.from(BUCKET).remove([image.storagePath])

      if (storageError) {
        // Não remove a linha do banco se o Storage falhar — evita
        // metadado apontando para nada (o inverso do problema de órfão).
        throw new Error(`[CoinImagesRepository] Falha ao remover o arquivo: ${storageError.message}`)
      }

      const { error } = await supabase.from('coin_images').delete().eq('id', image.id)

      if (error) {
        throw new Error(`[CoinImagesRepository] Arquivo removido, mas falha ao remover o registro: ${error.message}`)
      }

      // Fundação de imagens — Fix 1 (revisão arquitetural): o original já
      // foi removido com sucesso acima; a derivação pública (se existir)
      // usa o MESMO `storagePath` relativo, só em outro bucket — nunca uma
      // segunda lógica de path. Best-effort DE PROPÓSITO: se isto falhar,
      // NUNCA desfaz a remoção do original (já confirmada) nem propaga erro
      // para a UI — só registra para diagnóstico. Único ponto por onde
      // TODA remoção de foto privada passa (chamado por `CollectionRepository.remove`,
      // `CollectionUnitsRepository.remove` e pelo editor de fotos), então
      // corrigir aqui cobre os três fluxos de uma vez, sem duplicar lógica
      // em cada chamador.
      const { error: publicRemoveError } = await supabase.storage.from(PUBLIC_COIN_IMAGE_BUCKET).remove([
        image.storagePath,
      ])

      if (publicRemoveError) {
        Sentry.captureException(
          new Error(`[CoinImagesRepository] Falha ao remover derivação pública (melhor esforço): ${publicRemoveError.message}`),
        )
      }

      // Fix 3 — se a foto removida era a de FRENTE do exemplar PRINCIPAL do
      // item, ela é exatamente a única foto que `photo_public` pode estar
      // anunciando como pública (ver get_public_passport). Sem este reset,
      // o toggle na Coleção continuaria mostrando "publicada" para uma
      // moeda sem nenhuma foto por trás — nunca um vazamento de dado (a RPC
      // já esconde a foto sozinha assim que a linha de `coin_images` some),
      // só uma inconsistência de estado. Nunca toca `is_public` nem
      // `passport_collection_visibility` — só a coluna de foto.
      if (image.kind === 'front') {
        const { data: unitRow } = await supabase
          .from('collection_units')
          .select('collection_item_id, is_primary')
          .eq('id', image.collectionUnitId)
          .maybeSingle()

        if (unitRow?.is_primary) {
          const { error: resetError } = await supabase
            .from('collection_items')
            .update({ photo_public: false })
            .eq('id', unitRow.collection_item_id)

          if (resetError) {
            Sentry.captureException(
              new Error(`[CoinImagesRepository] Falha ao resetar photo_public (melhor esforço): ${resetError.message}`),
            )
          }
        }
      }
    },

    async getSignedUrl(storagePath, expiresInSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS) {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresInSeconds)

      if (error || !data) {
        throw new Error(`[CoinImagesRepository] Falha ao gerar link da imagem: ${error?.message}`)
      }

      return data.signedUrl
    },

    async getSignedUrls(storagePaths, expiresInSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS) {
      if (storagePaths.length === 0) return {}

      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(storagePaths, expiresInSeconds)

      if (error || !data) {
        throw new Error(`[CoinImagesRepository] Falha ao gerar links das imagens: ${error?.message}`)
      }

      const result: Record<string, string> = {}
      for (const entry of data) {
        if (entry.path && !entry.error && entry.signedUrl) {
          result[entry.path] = entry.signedUrl
        }
      }
      return result
    },

    async uploadPublicDerivative(storagePath, blob) {
      const { error } = await supabase.storage.from(PUBLIC_COIN_IMAGE_BUCKET).upload(storagePath, blob, {
        upsert: true,
        contentType: 'image/webp',
      })

      if (error) {
        throw new Error(`[CoinImagesRepository] Falha ao publicar a imagem: ${error.message}`)
      }
    },

    async removePublicDerivative(storagePath) {
      const { error } = await supabase.storage.from(PUBLIC_COIN_IMAGE_BUCKET).remove([storagePath])

      if (error) {
        throw new Error(`[CoinImagesRepository] Falha ao remover a imagem pública: ${error.message}`)
      }
    },

    getPublicUrl(storagePath) {
      return supabase.storage.from(PUBLIC_COIN_IMAGE_BUCKET).getPublicUrl(storagePath).data.publicUrl
    },
  }
}
