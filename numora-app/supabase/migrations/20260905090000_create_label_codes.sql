-- ============================================================================
-- Etapa "F4 — Numora Labels" (Fundação) — identificador humano estável por
-- `collection_item` (a emissão), aprovado explicitamente pelo owner como a
-- granularidade da V1 (nunca por `collection_unit` nesta etapa).
--
-- Mesmo padrão já usado por `profiles.numora_id`
-- (20260812093100_add_numora_id.sql): sequence dedicada (nextval() é
-- atômico, sem corrida sob inserts concorrentes), formato "NMR-0000001",
-- imutável uma vez atribuído, nunca gerado antecipadamente para toda a
-- coleção (nasce `NULL`, só é preenchido sob demanda pela RPC
-- `ensure_label_codes`, migration seguinte).
--
-- Proteção contra escrita direta pelo client: mesmo padrão já usado para
-- proteger `profiles.role` (20260812093200_profiles_column_grants.sql) —
-- `revoke update on collection_items from authenticated` (TABELA inteira,
-- não só a coluna) seguido de `grant update (...)` só nas colunas que o
-- client de fato precisa escrever hoje. ACHADO (verificado em teste de
-- integração antes do commit): um `revoke update (label_code)` sozinho, sem
-- revogar a tabela inteira primeiro, NÃO bloqueia nada — `authenticated` já
-- tinha um GRANT UPDATE de tabela inteira (padrão de criação da tabela), e
-- em Postgres esse privilégio amplo continua valendo para qualquer coluna
-- mesmo depois de um REVOKE column-level isolado; só revogar a tabela
-- inteira e reconceder explicitamente fecha o buraco. A lista de colunas
-- concedida de volta abaixo foi levantada por auditoria real de todo
-- `.update(...)` contra `collection_items` em
-- `features/collection/repositories/collection.repository.ts` (única fonte
-- de escrita direta desta tabela no código) — `label_code` fica de fora de
-- propósito: só `ensure_label_codes()` (SECURITY DEFINER, migration
-- seguinte) consegue escrevê-la. `quantity` também fica de fora: só
-- escrita pelo trigger `sync_collection_item_quantity` (SECURITY DEFINER,
-- não precisa de GRANT para `authenticated`).
--
-- CORREÇÃO (achado real em regressão de `tests/integration/composition-rpc.test.ts`
-- ao rodar a suíte completa antes do commit): `metal_code`/
-- `secondary_metal_code`/`purity` PRECISAM continuar no GRANT, ao contrário
-- do que este comentário afirmava numa versão anterior. Só quem os escreve
-- é `set_collection_item_composition()` (Etapa "Fundação de composição") —
-- mas essa função é `SECURITY INVOKER`, DE PROPÓSITO (documentado nela: as
-- tabelas de composição não têm FORCE ROW LEVEL SECURITY, então um
-- SECURITY DEFINER bypassaria RLS silenciosamente). SECURITY INVOKER
-- executa o UPDATE com o role de quem chamou (`authenticated`), não com o
-- role do dono da função — diferente de `ensure_label_codes()` (SECURITY
-- DEFINER), que não precisa de GRANT nenhum porque roda como o owner.
-- Revogar essas 3 colunas quebrava `set_collection_item_composition()`
-- com "permission denied for table collection_items" — pego pela suíte de
-- regressão do F2/F3 antes de chegar a Production.
-- ============================================================================

alter table public.collection_items
  add column label_code text;

create sequence public.label_code_seq
  as bigint
  start with 1
  increment by 1
  no cycle;

alter table public.collection_items
  add constraint uq_collection_items_label_code unique (label_code);

comment on column public.collection_items.label_code is
  'Etapa "F4 — Numora Labels" — identificador HUMANO impresso na etiqueta física (formato NMR-0000001), NUNCA usado como identificador de rota/QR (isso é sempre collection_items.id, o UUID interno). NULL até a primeira geração de etiqueta deste item; atribuído exclusivamente por ensure_label_codes(), nunca em massa, nunca pelo client diretamente.';

-- Imutabilidade: uma vez atribuído, label_code nunca muda — mesmo padrão de
-- `prevent_numora_id_change()`. A transição NULL -> valor é permitida (é
-- assim que a atribuição acontece); valor -> outro valor nunca é.
create or replace function public.prevent_label_code_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.label_code is not null and new.label_code is distinct from old.label_code then
    raise exception 'label_code é imutável e não pode ser alterado (era %, tentativa: %)',
      old.label_code, new.label_code;
  end if;
  return new;
end;
$$;

revoke execute on function public.prevent_label_code_change() from public, anon, authenticated;

create trigger protect_label_code
  before update on public.collection_items
  for each row
  execute function public.prevent_label_code_change();

revoke update on public.collection_items from authenticated;

grant update (
  purchase_id,
  country_code,
  year,
  denomination,
  gross_weight_g,
  face_value,
  mint,
  mintage,
  history,
  trivia,
  catalog_references,
  is_public,
  photo_public,
  deleted_at,
  metal_code,
  secondary_metal_code,
  purity
) on public.collection_items to authenticated;

-- ============================================================================
-- Entitlement — reaproveita INTEGRALMENTE a arquitetura já existente
-- (plans/plan_entitlements/get_effective_plan/get_entitlement, Etapa 15.8).
-- Nenhum sistema paralelo. `limit_value = NULL` em todos os planos que
-- habilitam a feature = ilimitado (decisão explícita do owner: Pro/Premium
-- geram etiquetas sem teto artificial na V1).
-- ============================================================================
insert into public.plan_entitlements (plan_id, feature_key, enabled, limit_value)
select p.id, 'labels', (p.slug in ('pro', 'premium')), null
from public.plans p
where p.slug in ('free', 'pro', 'premium');
