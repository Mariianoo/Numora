-- Supabase Advisor (auth_rls_initplan): `auth.uid()` usado direto numa
-- policy é reavaliado pelo planner para CADA linha da tabela. Envolver a
-- chamada em `(select auth.uid())` faz o Postgres resolver o valor uma
-- única vez por statement (initplan), mantendo a MESMA regra de negócio —
-- apenas o plano de execução muda, nenhuma policy muda quem pode ver/
-- alterar o quê.
alter policy "profiles_select_own"
  on public.profiles
  using ((select auth.uid()) = id);

alter policy "profiles_update_own"
  on public.profiles
  using ((select auth.uid()) = id);

alter policy "coins_select_own"
  on public.coins
  using ((select auth.uid()) = user_id);

alter policy "coins_delete_own"
  on public.coins
  using ((select auth.uid()) = user_id);

-- Mesma regra de `coins_insert_own` (dono do registro + teto de 50 moedas
-- do plano free), só trocando as duas chamadas de `auth.uid()` pelo padrão
-- otimizado.
alter policy "coins_insert_own"
  on public.coins
  with check (
    (select auth.uid()) = user_id
    and (
      select count(*) from public.coins c where c.user_id = (select auth.uid())
    ) < 50
  );
