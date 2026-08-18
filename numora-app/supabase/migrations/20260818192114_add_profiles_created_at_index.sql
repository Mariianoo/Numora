-- ============================================================================
-- Etapa 15.10.6 (Hardening de Performance dos KPIs P0) — índice dedicado em
-- profiles.created_at.
--
-- Achado da auditoria 15.10.5: profiles.created_at é a coluna usada (ou que
-- será usada) por todo KPI de aquisição por período — "novos usuários
-- hoje/7d/30d", "crescimento de usuários" (já consumido hoje por
-- app/admin/page.tsx via computeMemberGrowth) — e não existia nenhum índice
-- que cobrisse esse acesso. Os 4 índices pré-existentes em profiles (pkey
-- em id, country_code, numora_id, username) não ajudam nenhuma consulta por
-- data.
--
-- Índice simples (não composto): a única coluna usada em filtro/ordenação
-- por data é created_at isolada — não há nenhuma query hoje ou planejada
-- que combine created_at com outra coluna de profiles no mesmo WHERE/ORDER
-- BY, então um índice composto seria especulativo sem uso real.
--
-- Não altera tabela, coluna, trigger, RLS ou função — só adiciona o índice.
-- ============================================================================

create index if not exists idx_profiles_created_at
  on public.profiles (created_at);

comment on index public.idx_profiles_created_at is
  'Etapa 15.10.6 — suporta filtros/ordenação por profiles.created_at (novos usuários por período, crescimento de usuários no Owner Center). Sem esse índice, qualquer consulta por data forçava sequential scan.';
