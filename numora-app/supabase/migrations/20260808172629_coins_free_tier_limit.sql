-- Limite de moedas do plano free (50 por usuário). Sem sistema de
-- pagamento ainda — o limite é fixo aqui; quando houver planos pagos,
-- isto passa a consultar a tabela/coluna de plano do usuário em vez de
-- um número fixo.
alter policy "coins_insert_own"
  on public.coins
  with check (
    auth.uid() = user_id
    and (
      select count(*) from public.coins c where c.user_id = auth.uid()
    ) < 50
  );
