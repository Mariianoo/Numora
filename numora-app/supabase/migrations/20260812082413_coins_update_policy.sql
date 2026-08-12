-- Permite ao dono de uma moeda editá-la. Sem policy de update, a UI de
-- edição (Fase 0, Etapa 3) não teria como persistir alterações mesmo que
-- o usuário só tente editar a própria moeda.
--
-- `using` restringe quais linhas são visíveis/alteráveis pela operação;
-- `with check` valida o estado APÓS a alteração — sem ele, seria possível
-- (em tese) reatribuir `user_id` de uma moeda para outro usuário. As duas
-- cláusulas usam `(select auth.uid())` em vez de `auth.uid()` direto,
-- padrão recomendado pelo Supabase Advisor (auth_rls_initplan) para evitar
-- reavaliação da função por linha — as demais policies de `coins`/`profiles`
-- são migradas para esse mesmo padrão em migration separada nesta fase.
create policy "coins_update_own"
  on public.coins
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
