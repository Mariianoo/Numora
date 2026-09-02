-- ============================================================================
-- Passport V1, Fase 3 — flag por moeda usada quando
-- `profiles.passport_collection_visibility = 'selected'` (migration
-- anterior). Só tem efeito nesse modo; nos modos 'none'/'all' a RPC
-- get_public_passport nem consulta esta coluna.
--
-- Default `false`: nenhuma moeda de nenhum usuário existente (incluindo
-- contas já com `passport_public = true`) fica marcada como pública por
-- esta migration — a decisão de tornar a coleção (parcial ou totalmente)
-- pública continua 100% opt-in, feita depois na tela de Perfil/Coleção.
--
-- Nenhum GRANT novo necessário: `authenticated` já tem UPDATE de tabela
-- completo em `collection_items` (grant padrão do Supabase para tabelas
-- novas, nunca revogado nesta tabela — confirmado por introspecção direta
-- em Production durante a auditoria do Passport) e a policy
-- `collection_items_update_own` já restringe por linha
-- (`auth.uid() = user_id`); adicionar uma coluna não muda isso.
-- ============================================================================

alter table public.collection_items
  add column is_public boolean not null default false;

comment on column public.collection_items.is_public is
  'Só tem efeito quando profiles.passport_collection_visibility = ''selected'' (o dono desta linha). Marca esta moeda para aparecer na lista pública do Passport. Nunca expõe purchase_id/custo/localização/notas — a RPC get_public_passport só lê um subconjunto fixo de colunas, sempre, independente deste flag.';

create index idx_collection_items_user_is_public
  on public.collection_items (user_id, is_public)
  where is_public = true;
