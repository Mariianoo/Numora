# API_CONVENTIONS.md — CoinVerse (Numisphere)

> Convenções transversais da API REST, referenciadas por toda a especificação OpenAPI (`openapi/openapi.yaml`). Subordinado a `PROJECT_RULES.md` (seções 31 e 34) e `DATABASE_ARCHITECTURE.md`.

---

## 1. Versionamento

- Prefixo de versão obrigatório na URL: **`/v1/...`**.
- Mudança *breaking* de contrato → nova versão (`/v2`), convivendo com `/v1` durante período de depreciação anunciado (mínimo 90 dias), conforme `PROJECT_RULES.md` seção 34.3.
- Depreciação sinalizada via header de resposta `Deprecation: true` e `Sunset: <data RFC 1123>` nos endpoints marcados para remoção.
- SemVer aplicado a releases do contrato (`CHANGELOG.md`), não a cada deploy individual.

## 2. Autenticação — JWT

- Emitido pelo Supabase Auth (`POST /v1/auth/login`, `/v1/auth/register`), algoritmo assimétrico, expiração curta (**access token: 1 hora**).
- Claims mínimas: `sub` (user id), `role` (papel primário, sincronizado de `profiles.role`), `email`, `exp`, `iat`, `session_id`.
- Enviado via header `Authorization: Bearer <access_token>` em toda rota autenticada.
- Client web (PWA) armazena o token em cookie `httpOnly`, `Secure`, `SameSite=Lax` — nunca em `localStorage` (`PROJECT_RULES.md` 15.4). Clients mobile/nativos podem usar armazenamento seguro de plataforma equivalente.

## 3. Refresh Token

- Emitido junto ao access token no login, **rotação a cada uso** (refresh token antigo invalidado ao gerar um novo).
- Endpoint dedicado: `POST /v1/auth/refresh`, recebe o refresh token (cookie `httpOnly` ou body, conforme client), retorna novo par access/refresh.
- Revogação: `POST /v1/auth/logout` (sessão atual) e `POST /v1/auth/logout-all` (todas as sessões — invalida todos os refresh tokens do usuário, espelha `user_sessions`).
- Refresh token expira em **30 dias** de inatividade; uso renova a expiração (sliding window).

## 4. Paginação

Padrão **cursor-based** em toda listagem (nunca `OFFSET` puro em tabela de alto volume — `PROJECT_RULES.md` seção 27.5 / `DATABASE_ARCHITECTURE.md` seção 9.1).

**Query parameters comuns:**
| Parâmetro | Tipo | Default | Descrição |
|---|---|---|---|
| `limit` | integer | `20` (máx. `100`) | Itens por página |
| `cursor` | string | — | Cursor opaco (base64) retornado pela página anterior |

**Envelope de resposta:**
```json
{
  "data": [ /* itens */ ],
  "pagination": {
    "next_cursor": "eyJpZCI6IjEyMyJ9",
    "has_more": true,
    "limit": 20
  }
}
```

## 5. Filtros

Sintaxe `filter[<campo>]=<valor>` em query string. Operadores suportados via sufixo:
- `filter[price][gte]=10&filter[price][lte]=100` — intervalo.
- `filter[status]=active` — igualdade.
- `filter[country_code][in]=BR,PT` — lista (`in`).

Campos filtráveis são declarados explicitamente por endpoint (nunca filtro livre sobre qualquer coluna, para não expor coluna sensível nem gerar query sem índice).

## 6. Ordenação

Query parameter `sort`, lista separada por vírgula; prefixo `-` indica ordem decrescente.
`sort=-created_at` · `sort=price,-created_at` (ordenação composta).
Campos ordenáveis são declarados explicitamente por endpoint (sempre cobertos por índice — `DATABASE_ARCHITECTURE.md` seção 1.5/9).

## 7. Busca

Query parameter `q` (texto livre). Endpoints de busca (`catalog`, `marketplace`) usam a coluna `search_vector` (`tsvector`/GIN) da tabela correspondente. Resultado ordenado por relevância (`ts_rank`) quando `sort` não é informado.

## 8. Upload

Padrão de **duas etapas** (nunca upload direto multipart para o Route Handler da aplicação, para permitir escala e não sobrecarregar a camada de aplicação com bytes de arquivo):
1. `POST /v1/uploads/request-url` — client informa `bucket`, `content_type`, `size_bytes`; API valida (tipo/tamanho/quota do plano) e retorna uma **signed upload URL** de curta duração para o bucket/path apropriado (ver `DATABASE_ARCHITECTURE.md` seção 4) + um `upload_id`.
2. Client envia o arquivo diretamente ao Storage via a signed URL (PUT).
3. `POST /v1/uploads/{upload_id}/complete` — confirma o upload; a API então processa (reprocessamento/sanitização de imagem — `PROJECT_RULES.md` 13.5) e vincula o `storage_path` final à entidade de domínio (ex.: `item_photos`).

Arquivos em `temp/` não confirmados em 24h são expurgados automaticamente (job periódico).

## 9. Download

Arquivos privados (`certificates`, `documents`, `chat`) nunca são servidos por URL pública fixa. `GET /v1/files/{storage_path}/signed-url` retorna uma **signed download URL** de curta duração (padrão 5 minutos), validada pela mesma regra de RLS/ownership da entidade dona do arquivo. Arquivos públicos (`avatars`, `coins` de itens públicos, `catalog`, `marketplace`) são servidos diretamente pela CDN do bucket, sem necessidade deste endpoint.

## 10. Rate Limiting

Aplicado por usuário autenticado (chave = `user_id`) ou por IP (rotas públicas/anônimas), via Redis (`PROJECT_RULES.md` seção 20 / 13.6). Limite documentado por endpoint (campo `x-rate-limit` de cada operação OpenAPI). Header de resposta padrão em toda rota com limite:
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1735689600
```
Excedente → `429 Too Many Requests` (documentado nos endpoints relevantes junto ao `400`).

## 11. Formato de erro padrão

Toda resposta de erro (`400`/`401`/`403`/`404`/`409`/`429`/`500`) segue o schema `Error` (ver `openapi/components/schemas.yaml`):
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "O campo 'name' é obrigatório.",
    "details": [ { "field": "name", "issue": "required" } ]
  }
}
```

## 12. Idempotência de escrita

Endpoints de criação com efeito financeiro/transacional (`marketplace_transactions`, `payment_transactions`) aceitam header opcional `Idempotency-Key` — reenvio com a mesma chave retorna a resposta original em vez de duplicar o efeito.
