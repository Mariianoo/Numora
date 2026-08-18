-- ============================================================================
-- Etapa 15.8 (Modelo Comercial + Entitlements) — seed inicial de
-- `plan_entitlements`.
--
-- SOMENTE 2 feature_keys foram populados — os únicos que a auditoria desta
-- etapa confirmou serem recursos REAIS e já existentes no código, sem
-- inventar nenhum comportamento comercial novo:
--
--   collection_basic — gerenciar a coleção (moedas/exemplares/compras/
--     fotos/lixeira). Existe hoje, sem limite, para todo usuário
--     autenticado. enabled=true / limit_value=NULL em TODOS os planos —
--     reflete a realidade atual (nenhuma segmentação existe hoje).
--
--   public_passport — publicar Passport público (profiles.passport_public
--     + /passport/[username]). Existe hoje, sem restrição de plano.
--     enabled=true / limit_value=NULL em TODOS os planos.
--
-- DELIBERADAMENTE NÃO POPULADO (Etapa 15.8 — "não inventar comportamento
-- comercial", "pode permanecer sem entitlement até definição futura"):
--
--   collection_items (limite quantitativo) — precedente histórico existe
--     apenas na tabela morta `coins` (limite de 50, Etapa 1, sem uso
--     hoje). Não há decisão confirmada de que esse número (ou outro) se
--     aplica ao modelo atual (collection_items). DECISÃO DO OWNER
--     NECESSÁRIA antes de popular esta linha.
--
--   advanced_statistics / dashboard_advanced — o Dashboard é hoje uma
--     página única, sem nenhuma segmentação básica/avançada real no
--     código. Criar este entitlement inventaria uma distinção que não
--     existe. DECISÃO DO OWNER NECESSÁRIA se/quando o Dashboard for
--     segmentado.
--
--   exports — recurso não existe em NENHUM lugar do código (zero telas,
--     zero rotas, zero geração de CSV/PDF). Não é "recurso real ou
--     claramente planejado" o suficiente para popular agora.
--
--   image_storage / increased_storage — o único limite existente hoje
--     (3 fotos por exemplar: frente/verso/borda) é ESTRUTURAL, igual para
--     todos os planos (CHECK/UNIQUE em coin_images), não um entitlement
--     comercial diferenciável.
-- ============================================================================

insert into public.plan_entitlements (plan_id, feature_key, enabled, limit_value)
select p.id, f.feature_key, true, null
from public.plans p
cross join (values ('collection_basic'), ('public_passport')) as f(feature_key)
where p.slug in ('free', 'pro', 'premium');
