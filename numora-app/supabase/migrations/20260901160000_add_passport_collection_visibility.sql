-- ============================================================================
-- Passport V1, Fase 3 — modo de visibilidade da coleção no Passport.
--
-- Suporta os 3 estados de negócio pedidos (nenhuma moeda / toda a coleção /
-- somente selecionadas) com UM único campo por perfil, em vez de tentar
-- derivar isso de um booleano por moeda: um booleano por moeda sozinho não
-- distingue "modo = nenhuma" de "modo = selecionadas, mas nada marcado
-- ainda" (as duas UI mostrariam o mesmo estado vazio, então tecnicamente
-- tanto faz para a apresentação) — mas ele NUNCA representaria "toda a
-- coleção" sem o usuário precisar marcar moeda por moeda, o que é ruim de
-- usar numa coleção com muitas moedas. Por isso o modo vive em `profiles`
-- (afeta a coleção inteira de uma vez) e `collection_items.is_public`
-- (migration seguinte) só é consultado quando o modo é 'selected'.
--
-- Default 'none' — dado que já existem contas em Production com
-- `passport_public = true` (ver auditoria do Passport), um default
-- diferente de 'none' tornaria a coleção de usuários existentes pública
-- silenciosamente no momento em que esta migration fosse aplicada. Isso é
-- proibido pela regra do produto (preferir migração explícita e seguindo
-- opt-in a assumir publicação). Ativar 'all'/'selected' é sempre uma ação
-- deliberada do usuário, feita depois, na tela de Perfil.
-- ============================================================================

alter table public.profiles
  add column passport_collection_visibility text not null default 'none'
  check (passport_collection_visibility in ('none', 'all', 'selected'));

comment on column public.profiles.passport_collection_visibility is
  'Controla se/quais moedas aparecem na lista pública do Passport (/passport/[username]). "none" = só os agregados (contadores) aparecem, nenhuma moeda individual. "all" = toda a coleção ativa (não-lixeira) aparece. "selected" = só os collection_items com is_public = true aparecem. Nunca afeta os agregados em si (totalCoins/totalUnits/etc. sempre reflete a coleção real, mesmo com a lista de moedas oculta) nem os campos financeiros, que a RPC get_public_passport nunca leu.';

-- Mesmo padrão de profiles_column_grants.sql: RLS de linha já garante que
-- só o dono edita a própria linha; o GRANT column-level é quem decide
-- QUAIS colunas o dono pode escrever. Sem isto, `authenticated` não
-- conseguiria atualizar a coluna nova (o REVOKE amplo daquela migration
-- continua valendo para qualquer coluna não listada explicitamente).
grant update (passport_collection_visibility)
  on public.profiles
  to authenticated;
