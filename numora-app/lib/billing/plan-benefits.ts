/**
 * lib/billing/plan-benefits.ts
 * Etapa "Official Launch Foundation — Bloco A" — lista comercial de
 * benefícios por plano, fonte ÚNICA para `PricingSelector` (página de
 * planos) e `UpgradeToProDialog` (paywalls) — nunca duas listas paralelas
 * que possam divergir.
 *
 * Só descreve o que existe de verdade HOJE (cada item Pro tem um
 * entitlement real: `collection_items` ilimitado, `dashboard_advanced`,
 * `labels`, `exports`). Recursos planejados do Premium aparecem SEMPRE
 * marcados "(em breve)" — nunca como se já existissem (D1/D3/D4): não há
 * Insights nem Map implementados.
 */

export const FREE_BENEFITS: readonly string[] = ['Até 50 moedas ativas na coleção', 'Passport público']

export const PRO_BENEFITS: readonly string[] = ['Coleção ilimitada', 'Dashboard avançado', 'Numora Labels', 'Exportação CSV', 'Exportação XLSX']

export const PREMIUM_BENEFITS: readonly string[] = ['Tudo do Pro', 'Numora Insights (em breve)', 'Map (em breve)']
