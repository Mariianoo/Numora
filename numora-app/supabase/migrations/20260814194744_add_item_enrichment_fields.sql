-- ============================================================================
-- Etapa 11 — enriquecimento da EMISSÃO (collection_items), não do exemplar
-- (collection_units). Quantidade cunhada, história, curiosidades e
-- referências de catálogo pertencem à moeda como um todo — nunca são
-- duplicadas por exemplar físico.
--
-- `mintage` (quantidade historicamente cunhada) é DELIBERADAMENTE um
-- conceito diferente de `collection_items.quantity` (quantos exemplares
-- o usuário possui). `bigint` porque mintagens reais de moedas de
-- circulação moderna chegam à casa dos bilhões — `integer` estouraria
-- (~2,1 bilhões). Ver features/collection/repositories/collection.repository.ts
-- para como o valor é lido via `mintage::text` no PostgREST (evita
-- qualquer risco de arredondamento por `number` do JavaScript ao
-- atravessar JSON) — representado como `string | null` no TypeScript,
-- nunca convertido para `number` no caminho de leitura/escrita.
--
-- `catalog_references` é `jsonb` (array de `{ catalog, code }`) em vez de
-- uma tabela nova — suporta múltiplos sistemas de catalogação (KM#,
-- Numista, NGC, PCGS...) sem a complexidade de FKs/tabela dedicada. O
-- CHECK abaixo só garante a FORMA (é um array); o shape de cada elemento
-- é validado em TypeScript, não no banco.
--
-- `location`, `mint` e `description` (já existentes) NÃO são alterados
-- nesta migration — `location` continua com significado indefinido,
-- deliberadamente não reutilizado ainda.
-- ============================================================================

alter table public.collection_items
  add column mintage bigint,
  add column history text,
  add column trivia text,
  add column catalog_references jsonb;

alter table public.collection_items
  add constraint collection_items_mintage_check
  check (mintage is null or mintage > 0);

alter table public.collection_items
  add constraint collection_items_catalog_references_is_array
  check (catalog_references is null or jsonb_typeof(catalog_references) = 'array');
