-- ============================================================================
-- Etapa "5.9 — Paywall Técnico (limite de 50 collection_items)":
--
-- 1) plan_entitlements — feature_key='collection_items': Free
--    enabled=true/limit_value=50; Pro/Premium enabled=true/limit_value=NULL
--    (ilimitado, mesma convenção documentada desde a Etapa 15.8: NULL =
--    sem teto). Reaproveita a arquitetura de entitlement já existente —
--    nenhuma tabela nova.
--
-- 2) collection_item_insert_allowed() — função SECURITY DEFINER
--    SELF-SCOPED (auth.uid() interno, SEM parâmetro de usuário — decisão
--    tomada durante a implementação: eliminar completamente a superfície
--    de "chamar para o user_id de outro" em vez de só confiar que os
--    chamadores sempre passariam auth.uid(); mesmo padrão de
--    get_my_entitlement()/get_my_subscription()). Compartilhada entre o
--    caminho de INSERT (RLS WITH CHECK, precisa de GRANT para
--    `authenticated` porque a policy é avaliada com o papel do usuário) e
--    o caminho de RESTORE (trigger BEFORE UPDATE, abaixo — não precisa de
--    GRANT porque triggers não exigem EXECUTE do papel que dispara o DML,
--    mesmo padrão já usado em enforce_subscription_user_matches_billing_customer).
--
--    NUNCA aceita contagem do chamador — sempre COUNT(*) real dentro da
--    própria função, contra o índice parcial já existente
--    (collection_items_active_idx). Adquire pg_advisory_xact_lock por
--    usuário ANTES de contar, fechando a race condition de "duas criações
--    simultâneas passam pela mesma contagem" sem SERIALIZABLE/retry/
--    contador desnormalizado (revisão técnica da Fase 5.9, aprovada
--    explicitamente). VOLATILE de propósito (nunca STABLE/IMMUTABLE — tem
--    efeito de lock e o resultado depende do estado concorrente do banco).
--
--    Ser diretamente chamável como RPC por `authenticated` é uma
--    consequência aceita (não um descuido): é self-scoped, retorna só um
--    boolean sobre a PRÓPRIA conta do chamador, sem parâmetro, sem
--    vazamento de dado de terceiro — mesmo perfil de risco já aceito para
--    get_my_entitlement()/get_my_subscription() nesta base de código.
--
-- 3) enforce_collection_item_restore_limit() + trigger enforce_restore_limit
--    (BEFORE UPDATE FOR EACH ROW em collection_items) — ÚNICA forma
--    correta de comparar OLD/NEW no Postgres. RLS WITH CHECK NÃO tem
--    acesso a OLD (só existe old/new como record variables dentro de
--    funções de trigger) — a revisão técnica da Fase 5.9 rejeitou
--    explicitamente qualquer tentativa de reconstruir OLD via subquery
--    dentro de uma expressão de RLS (semântica de visibilidade não
--    garantida pela documentação do Postgres para esse padrão). Só aciona
--    o enforcement quando OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS
--    NULL (restauração de verdade) — qualquer outra UPDATE (edição normal
--    de um item já ativo, inclusive de um usuário Free acima do limite por
--    grandfathering, ou um soft delete) passa direto, sem sequer chamar
--    collection_item_insert_allowed().
--
-- 4) Policy "collection_items_insert_own" — WITH CHECK reescrito via
--    ALTER POLICY para incluir `collection_item_insert_allowed()`,
--    mantendo INTACTAS as validações já existentes (auth.uid()=user_id,
--    integridade de purchase_id). A policy de UPDATE
--    ("collection_items_update_own") NÃO é alterada — continua protegendo
--    só ownership/purchase_id; o novo trigger é uma camada ADICIONAL,
--    independente de RLS.
--
-- 5) check_collection_item_limit() — RPC self-scoped (auth.uid()),
--    PURAMENTE informativa para a UX (mesmo padrão de
--    LabelsRepository.isEnabled()/get_my_entitlement() — "só UX, nunca a
--    barreira real"). A barreira real é exclusivamente (2)+(3)+(4).
--    Retorna exatamente os campos pedidos no design (current_count,
--    "limit", allowed, plan_slug, is_unlimited) — "remaining" foi
--    deliberadamente OMITIDO por ser trivialmente derivável no cliente
--    (limit - current_count), evitando um campo redundante.
--
-- Nenhuma tabela nova, nenhuma coluna nova, nenhum índice novo — o índice
-- parcial `collection_items_active_idx (user_id) WHERE deleted_at IS NULL`
-- (Etapa Lixeira) já cobre exatamente a query de COUNT(*) usada aqui.
-- ============================================================================

insert into public.plan_entitlements (plan_id, feature_key, enabled, limit_value)
select p.id, 'collection_items', true, case p.slug when 'free' then 50 else null end
from public.plans p
where p.slug in ('free', 'pro', 'premium')
on conflict (plan_id, feature_key) do nothing;

-- ----------------------------------------------------------------------------

create function public.collection_item_insert_allowed()
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_limit integer;
  v_count integer;
begin
  if v_user_id is null then
    return false;
  end if;

  -- Lock transacional por usuário — fecha a race condition de duas
  -- criações/restaurações simultâneas lendo a mesma contagem antes de
  -- qualquer uma commitar. Libera sozinho no fim da transação.
  perform pg_advisory_xact_lock(hashtext('collection_items_insert'), hashtext(v_user_id::text));

  select ge.limit_value into v_limit
  from public.get_entitlement(v_user_id, 'collection_items') ge;

  if v_limit is null then
    return true; -- Pro/Premium/courtesy: ilimitado
  end if;

  select count(*) into v_count
  from public.collection_items c
  where c.user_id = v_user_id
    and c.deleted_at is null;

  return v_count < v_limit;
end;
$$;

comment on function public.collection_item_insert_allowed() is
  'Etapa "5.9" — self-scoped (auth.uid()), nunca aceita contagem do chamador. Adquire pg_advisory_xact_lock por usuário e conta collection_items ativos em tempo real contra o entitlement resolvido via get_entitlement(). Chamada pela policy de INSERT e pelo trigger de RESTORE de collection_items — única barreira real do limite de 50.';

revoke all on function public.collection_item_insert_allowed() from public, anon;
grant execute on function public.collection_item_insert_allowed() to authenticated;

-- ----------------------------------------------------------------------------

create function public.enforce_collection_item_restore_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if old.deleted_at is not null and new.deleted_at is null then
    if not public.collection_item_insert_allowed() then
      raise exception 'Limite de moedas ativas do plano atual foi atingido — não é possível restaurar esta moeda.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.enforce_collection_item_restore_limit() is
  'Etapa "5.9" — trigger BEFORE UPDATE: só aciona o limite quando a linha transiciona de deletada (OLD.deleted_at IS NOT NULL) para ativa (NEW.deleted_at IS NULL) — uma restauração de verdade. Qualquer outra UPDATE (edição normal, soft delete) passa direto, preservando o grandfathering de usuários já acima do limite.';

revoke all on function public.enforce_collection_item_restore_limit() from public, anon, authenticated;

create trigger enforce_restore_limit
  before update on public.collection_items
  for each row
  execute function public.enforce_collection_item_restore_limit();

-- ----------------------------------------------------------------------------
-- Mantém INTEGRALMENTE o WITH CHECK original (ownership + integridade de
-- purchase_id) e adiciona o enforcement do limite como uma condição extra.
-- ----------------------------------------------------------------------------
alter policy "collection_items_insert_own" on public.collection_items
  with check (
    (select auth.uid()) = user_id
    and (
      purchase_id is null
      or exists (
        select 1 from public.purchases p
        where p.id = purchase_id and p.user_id = (select auth.uid())
      )
    )
    and public.collection_item_insert_allowed()
  );

-- ----------------------------------------------------------------------------

create function public.check_collection_item_limit()
returns table (
  allowed boolean,
  current_count integer,
  "limit" integer,
  plan_slug text,
  is_unlimited boolean
)
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_limit integer;
  v_plan_slug text;
  v_count integer;
begin
  select ge.limit_value, ge.plan_slug into v_limit, v_plan_slug
  from public.get_entitlement(v_user_id, 'collection_items') ge;

  select count(*) into v_count
  from public.collection_items c
  where c.user_id = v_user_id
    and c.deleted_at is null;

  if v_limit is null then
    return query select true, v_count, null::integer, v_plan_slug, true;
  else
    return query select (v_count < v_limit), v_count, v_limit, v_plan_slug, false;
  end if;
end;
$$;

comment on function public.check_collection_item_limit() is
  'Etapa "5.9" — self-scoped (auth.uid()), PURAMENTE informativa para a UX (mesmo padrão de get_my_entitlement()/LabelsRepository.isEnabled()) — nunca a barreira real, que é collection_item_insert_allowed() + trigger de restore + RLS. "limit"=NULL significa ilimitado (is_unlimited=true).';

revoke all on function public.check_collection_item_limit() from public, anon;
grant execute on function public.check_collection_item_limit() to authenticated;
