-- ============================================================================
-- Etapa 15.8 (Modelo Comercial + Entitlements) — OWNER vs ADMIN para
-- configuração comercial.
--
-- ACHADO: `plans_admin_write` (Etapa 15.3) e a antiga
-- `plan_features_admin_write` (renomeada `plan_entitlements_admin_write_
-- deprecated` na migration anterior) usam `is_platform_admin()` — isso
-- permite que um ADMIN comum (não owner) altere planos/entitlements, o
-- que contraria a exigência explícita desta etapa: "ADMIN não deve
-- automaticamente ganhar permissão para alterar planos ou entitlements
-- ... OWNER ≠ ADMIN". `plan_prices` (Etapa 15.7) já nasceu correta,
-- usando `is_platform_owner()` — esta migration alinha `plans` e
-- `plan_entitlements` ao mesmo padrão.
--
-- Nenhuma migration antiga foi editada — esta é uma migration NOVA que
-- substitui as policies de escrita por DROP + CREATE, mesmo padrão já
-- usado na Etapa 15.7-R1.
-- ============================================================================

drop policy "plans_admin_write" on public.plans;

create policy "plans_owner_write"
  on public.plans
  for all
  using (public.is_platform_owner())
  with check (public.is_platform_owner());

drop policy "plan_entitlements_admin_write_deprecated" on public.plan_entitlements;

create policy "plan_entitlements_owner_write"
  on public.plan_entitlements
  for all
  using (public.is_platform_owner())
  with check (public.is_platform_owner());
