-- ============================================================================
-- Etapa "Stripe 3.2 — Versionamento de plan_prices" — evolução estrutural
-- aprovada na "Stripe 3.1" para permitir histórico de preços (grandfathering,
-- reajustes, preços programados), sem criar uma segunda tabela e sem tocar
-- em nenhuma migration anterior (`20260905100000_...`, `20260905120000_...`
-- permanecem exatamente como estão).
--
-- Nada disto cria RPC de gestão comercial, UI, scheduler/job/cron, ou
-- qualquer coisa do Stripe em si — é só schema/integridade, conforme
-- escopo desta etapa.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) effective_from — desde quando esta versão de preço é/foi a vigente.
--    Backfill das 8 linhas comerciais já existentes usa o próprio
--    `created_at` de cada linha (valor determinístico e já registrado,
--    nunca uma data arbitrária/"agora" no momento desta migration) — só
--    depois disso a coluna vira NOT NULL e ganha DEFAULT now() para
--    qualquer INSERT futuro.
-- ----------------------------------------------------------------------------
alter table public.plan_prices
  add column effective_from timestamptz;

update public.plan_prices
  set effective_from = created_at
  where effective_from is null;

alter table public.plan_prices
  alter column effective_from set not null;

alter table public.plan_prices
  alter column effective_from set default now();

comment on column public.plan_prices.effective_from is
  'Etapa "Stripe 3.2" — desde quando esta versão de preço é (ou foi) a vigente. As 8 linhas comerciais iniciais (Stripe 3) foram backfilled com o próprio created_at, nunca uma data inventada.';

-- ----------------------------------------------------------------------------
-- 2) effective_until — quando esta versão deixou de ser a vigente.
--    NULL = ainda vigente / sem data de encerramento definida. Nunca é
--    "apagar a linha" — encerrar um preço é sempre effective_until +
--    active=false, a linha permanece para sempre (grandfathering).
-- ----------------------------------------------------------------------------
alter table public.plan_prices
  add column effective_until timestamptz;

comment on column public.plan_prices.effective_until is
  'Etapa "Stripe 3.2" — quando esta versão deixou de ser a vigente (NULL = ainda vigente). Preencher este campo NUNCA é acompanhado de DELETE — preços históricos são "encerrados", nunca excluídos (decisão do proprietário, Stripe 3.2).';

-- ----------------------------------------------------------------------------
-- 3) Unicidade — a UNIQUE total (uq_plan_prices_plan_interval_currency,
--    Stripe 1) impedia qualquer histórico: só permitia 1 linha por
--    (plano, intervalo, moeda), ponto. Substituída por um ÍNDICE ÚNICO
--    PARCIAL: só uma linha pode estar `active = true` por combinação;
--    qualquer quantidade de linhas `active = false` (histórico) pode
--    coexistir livremente. As 8 linhas atuais estão todas `active = false`
--    — o novo índice não se aplica a nenhuma delas ainda, migração segura.
-- ----------------------------------------------------------------------------
alter table public.plan_prices
  drop constraint uq_plan_prices_plan_interval_currency;

create unique index uq_plan_prices_plan_interval_currency_active
  on public.plan_prices (plan_id, "interval", currency)
  where active;

comment on index public.uq_plan_prices_plan_interval_currency_active is
  'Etapa "Stripe 3.2" — substitui uq_plan_prices_plan_interval_currency (Stripe 1). Garante no máximo 1 linha active=true por (plano, intervalo, moeda) — não restringe quantas linhas históricas (active=false) existem para a mesma combinação.';

-- ----------------------------------------------------------------------------
-- 4) active exige stripe_price_id — semântica de `active`: "vendável para
--    cliente novo agora". Não faz sentido um preço vendável sem um Stripe
--    Price real por trás. `active=false` nunca significa "ninguém mais usa
--    este preço" — isso é derivado de `subscriptions.stripe_price_id`,
--    nunca desta coluna (ver seção 5).
-- ----------------------------------------------------------------------------
alter table public.plan_prices
  add constraint chk_plan_prices_active_requires_stripe_price
  check (not active or stripe_price_id is not null);

comment on constraint chk_plan_prices_active_requires_stripe_price on public.plan_prices is
  'Etapa "Stripe 3.2" — active=true (vendável para novos clientes) exige stripe_price_id preenchido. active=false permite stripe_price_id NULL (rascunho, como as 8 linhas comerciais de hoje) OU preenchido (histórico já vinculado ao Stripe).';

-- ----------------------------------------------------------------------------
-- 5) FK subscriptions.stripe_price_id -> plan_prices.stripe_price_id —
--    integridade "não apagar um preço histórico ainda em uso". `on delete
--    restrict` (explícito): remover uma linha de plan_prices enquanto
--    qualquer subscription ainda referenciar seu stripe_price_id falha,
--    nunca cascata silenciosa. Nenhuma linha em `subscriptions` existe
--    hoje (0 linhas, confirmado) — migração segura, nada a validar.
--
--    Significado de subscriptions.stripe_price_id NÃO muda: continua sendo
--    o Stripe Price efetivamente contratado pelo assinante, só que agora
--    com integridade referencial garantida pelo banco.
-- ----------------------------------------------------------------------------
alter table public.subscriptions
  add constraint subscriptions_stripe_price_id_fkey
  foreign key (stripe_price_id) references public.plan_prices (stripe_price_id)
  on delete restrict;

-- ----------------------------------------------------------------------------
-- Imutabilidade dos termos comerciais — "uma linha de plan_prices
-- representa UM preço imutável" (regra de negócio explícita, Stripe 3.2).
-- Mesmo padrão já usado neste projeto para `label_code`
-- (`prevent_label_code_change`/`protect_label_code`,
-- `20260905090000_create_label_codes.sql`):
--
--   - plan_id/interval/currency/amount NUNCA mudam depois de criados —
--     "reajustar" é sempre uma linha NOVA, nunca um UPDATE nestes campos.
--   - stripe_price_id: a transição NULL -> valor é permitida (é assim que
--     um rascunho vira um preço real, vinculado ao Stripe); valor ->
--     outro valor nunca é.
--   - active/effective_from/effective_until permanecem livremente
--     editáveis (são os campos de ciclo de vida — inclusive
--     effective_from precisa continuar editável para o proprietário poder
--     revisar/adiar um reajuste programado antes da data efetiva, decisão
--     já registrada na Stripe 3.2).
-- ----------------------------------------------------------------------------
create or replace function public.prevent_plan_price_commercial_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.plan_id is distinct from old.plan_id
     or new."interval" is distinct from old."interval"
     or new.currency is distinct from old.currency
     or new.amount is distinct from old.amount
  then
    raise exception 'plan_prices.plan_id/interval/currency/amount são imutáveis (linha %) — crie uma nova linha para uma nova versão de preço, nunca edite os termos comerciais de uma linha existente.', old.id
      using errcode = '23514';
  end if;

  if old.stripe_price_id is not null and new.stripe_price_id is distinct from old.stripe_price_id then
    raise exception 'plan_prices.stripe_price_id é imutável depois de definido (linha %, era %, tentativa: %).', old.id, old.stripe_price_id, new.stripe_price_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function public.prevent_plan_price_commercial_change() from public, anon, authenticated;

create trigger protect_plan_price_commercial_fields
  before update on public.plan_prices
  for each row
  execute function public.prevent_plan_price_commercial_change();
