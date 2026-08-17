-- ============================================================================
-- Etapa 14.3 — Migration 1 (aditiva) da nova arquitetura financeira.
--
-- Aprovada em Etapa 14 (auditoria) → 14.1/14.1-R2 (design do modelo de custo)
-- → 14.2 (auditoria de migração, 0 collection_items/collection_units reais,
-- 2 purchases órfãs legítimas confirmadas, backfill NÃO necessário agora).
--
-- Modelo: purchase_id/custo migram de collection_items para collection_units
-- (achado 14.1-R2 §4-5: um item só pode apontar para 1 purchase hoje, o que
-- é insuficiente para "mesma emissão, aquisições em datas diferentes" —
-- corrigido em collection.repository.ts nesta mesma etapa). NENHUMA coluna
-- antiga é removida (collection_items.purchase_id/unit_cost_override ficam
-- DEPRECATED, não apagadas — dual-write mantém o Dashboard atual
-- funcionando sem alteração, ver relatório da etapa).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- purchases: status (draft/confirmed/cancelled) + composição opcional de
-- custo. total_price permanece a fonte da verdade do total pago — os campos
-- abaixo são detalhamento opcional, nunca substituto.
-- ----------------------------------------------------------------------------
alter table public.purchases
  add column status          text not null default 'draft'
                                check (status in ('draft', 'confirmed', 'cancelled')),
  add column items_amount    numeric(12, 2) check (items_amount is null or items_amount >= 0),
  add column shipping_amount numeric(12, 2) check (shipping_amount is null or shipping_amount >= 0),
  add column insurance_amount numeric(12, 2) check (insurance_amount is null or insurance_amount >= 0),
  add column tax_amount      numeric(12, 2) check (tax_amount is null or tax_amount >= 0),
  add column discount_amount numeric(12, 2) check (discount_amount is null or discount_amount >= 0),
  add column confirmed_at    timestamptz;

comment on column public.purchases.status is
  'draft = editável livremente; confirmed = valores financeiros congelados (ver trigger enforce_purchase_confirmed_immutable); cancelled = não conta mais como investimento ativo, mas nunca é apagada (Etapa 14.1-R2 §2). Nenhuma UI de confirmação existe ainda (Etapa 14.3) — todas as purchases criadas hoje permanecem em draft até essa etapa futura.';
comment on column public.purchases.items_amount is
  'Detalhamento opcional de total_price. Quando preenchido junto com shipping/insurance/tax/discount, a soma deve aproximar total_price (validado em aplicação, não-bloqueante — Etapa 14.1-R2 §11). NULL = não detalhado, o rateio trata total_price inteiro como items_amount (compatível com 100% do dado existente).';

-- ----------------------------------------------------------------------------
-- collection_units: origem e custo histórico por EXEMPLAR (Etapa 14.1-R2).
-- purchase_id nullable de propósito: nem todo exemplar tem uma purchase
-- (trade/gift/unknown, ver cost_type).
-- ----------------------------------------------------------------------------
alter table public.collection_units
  add column purchase_id uuid references public.purchases (id) on delete set null,
  add column unit_cost   numeric(12, 2) check (unit_cost is null or unit_cost >= 0),
  add column cost_origin text not null default 'auto'
               check (cost_origin in ('auto', 'manual')),
  add column cost_type   text not null default 'unknown'
               check (cost_type in ('purchase', 'trade', 'gift', 'unknown')),
  add constraint chk_collection_units_cost_type_purchase_id
    check ((cost_type = 'purchase') = (purchase_id is not null));

comment on column public.collection_units.purchase_id is
  'Qual purchase originou ESTE exemplar físico — Etapa 14.3. Substitui, para dado novo, o papel que collection_items.purchase_id tinha (esse campo fica deprecated: só suporta 1 purchase por item inteiro, insuficiente para "mesma emissão, aquisições em datas diferentes"). ON DELETE SET NULL: apagar a purchase nunca apaga o exemplar, só desvincula (mesma semântica já usada em collection_items.purchase_id).';
comment on column public.collection_units.unit_cost is
  'Custo histórico CONGELADO deste exemplar (Etapa 14.1-R2 §1) — nunca recalculado automaticamente após a purchase de origem virar confirmed. NULL = custo desconhecido (ver cost_type), nunca interpretar como R$0.';
comment on column public.collection_units.cost_origin is
  'auto = resultado do rateio determinístico (Etapa 14.1-R2 §9); manual = valor informado explicitamente pelo usuário para este exemplar específico.';
comment on column public.collection_units.cost_type is
  'Origem do exemplar: purchase (tem purchase_id), trade (entidade trades ainda não existe — Etapa 14 §10, fora de escopo), gift (custo 0 ou estimado, sem purchase_id), unknown (sem informação — default de todo exemplar legado/novo até ter uma origem explícita).';

create index idx_collection_units_purchase on public.collection_units (purchase_id);

-- ----------------------------------------------------------------------------
-- Trigger de imutabilidade financeira pós-confirmação (Etapa 14.1-R2 §1-2).
-- Mantida na mesma migration (não numa migration separada): é uma única
-- função pequena, mesmo padrão já usado em check_sale_quantity/
-- check_collection_unit_not_last (criadas junto com a tabela que protegem,
-- não em migration própria) — criar um arquivo só para isto adicionaria
-- overhead sem nenhum ganho de segurança/rollback.
--
-- Nenhuma UI de confirmação existe ainda: esta trigger só passa a ter
-- efeito prático quando `status` puder ser levado a 'confirmed' por algum
-- caminho futuro — hoje é proteção preparada, não uma regra ativa no
-- dia-a-dia (nenhuma purchase real ou de teste sai de 'draft' via app).
-- ----------------------------------------------------------------------------
create or replace function public.check_purchase_confirmed_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'confirmed' and (
    new.total_price is distinct from old.total_price
    or new.items_amount is distinct from old.items_amount
    or new.shipping_amount is distinct from old.shipping_amount
    or new.insurance_amount is distinct from old.insurance_amount
    or new.tax_amount is distinct from old.tax_amount
    or new.discount_amount is distinct from old.discount_amount
  ) then
    raise exception 'Não é possível alterar valores financeiros de uma compra confirmada. Reabra a compra para edição antes de alterar (fluxo ainda não implementado — Etapa 14.1-R2 §2).'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke execute on function public.check_purchase_confirmed_immutable() from public, anon, authenticated;

create trigger enforce_purchase_confirmed_immutable
  before update on public.purchases
  for each row
  execute function public.check_purchase_confirmed_immutable();

-- ----------------------------------------------------------------------------
-- RLS — collection_units passa a aceitar escrita de purchase_id; sem
-- checagem de ownership, um usuário poderia apontar um exemplar seu para a
-- purchase de outro usuário (mesma classe de risco que
-- collection_items_insert_own/update_own já protege hoje contra purchase_id
-- — reaproveitando exatamente o mesmo padrão, um nível abaixo).
-- ----------------------------------------------------------------------------
drop policy "collection_units_insert_own" on public.collection_units;

create policy "collection_units_insert_own"
  on public.collection_units
  for insert
  with check (
    exists (
      select 1 from public.collection_items c
      where c.id = collection_units.collection_item_id and c.user_id = (select auth.uid())
    )
    and (
      purchase_id is null
      or exists (
        select 1 from public.purchases p
        where p.id = collection_units.purchase_id and p.user_id = (select auth.uid())
      )
    )
  );

drop policy "collection_units_update_own" on public.collection_units;

create policy "collection_units_update_own"
  on public.collection_units
  for update
  using (
    exists (
      select 1 from public.collection_items c
      where c.id = collection_units.collection_item_id and c.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.collection_items c
      where c.id = collection_units.collection_item_id and c.user_id = (select auth.uid())
    )
    and (
      purchase_id is null
      or exists (
        select 1 from public.purchases p
        where p.id = collection_units.purchase_id and p.user_id = (select auth.uid())
      )
    )
  );
