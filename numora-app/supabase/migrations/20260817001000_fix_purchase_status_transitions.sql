-- ============================================================================
-- Etapa 14.3-R2 — corrige as 2 pendências da auditoria independente
-- (Etapa 14.3-R1): (1) `confirmed → draft` era permitido, reabrindo os
-- campos financeiros supostamente travados; (2) `confirmed_at` não era
-- preenchido automaticamente, dependendo do caller lembrar de setá-lo.
--
-- Evolui `check_purchase_confirmed_immutable()` (CREATE OR REPLACE — mesma
-- função, mesmo trigger `enforce_purchase_confirmed_immutable`, já
-- existente desde a Etapa 14.3) em vez de criar uma segunda função
-- redundante. Idempotente: pode ser reaplicada sem efeito colateral.
--
-- Máquina de estados final:
--   draft     -> confirmed   permitido (confirmed_at preenchido pelo trigger)
--   draft     -> cancelled   permitido
--   confirmed -> cancelled   permitido (confirmed_at preservado — o fato
--                             histórico de quando foi confirmada nunca
--                             desaparece só porque a compra foi cancelada)
--   confirmed -> draft       BLOQUEADO (reabertura ainda não existe como
--                             fluxo — Etapa 14.1-R2 §2)
--   cancelled -> draft       BLOQUEADO (estado terminal)
--   cancelled -> confirmed   BLOQUEADO (estado terminal)
--
-- Campos financeiros travados: a regra passa a valer também quando
-- `OLD.status = 'cancelled'` (não só 'confirmed') — uma compra cancelada
-- que já foi confirmada não pode ter seu histórico financeiro reescrito
-- depois; e uma compra cancelada sem nunca ter sido confirmada também não
-- deveria mudar de valor num estado terminal. `confirmed → cancelled`
-- continua bloqueando alteração financeira NA MESMA operação, porque
-- `OLD.status` (antes da atualização) ainda é 'confirmed' nesse instante.
-- ============================================================================

create or replace function public.check_purchase_confirmed_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_activation boolean := (old.status = 'draft' and new.status = 'confirmed');
begin
  -- Bloqueia toda regressão de estado. Nenhuma UI de reabertura existe
  -- ainda (Etapa 14.1-R2 §2) — essas transições não têm caminho válido
  -- hoje, então são rejeitadas no banco, não só na aplicação.
  if old.status = 'confirmed' and new.status = 'draft' then
    raise exception 'Não é possível reabrir uma compra confirmada para rascunho.'
      using errcode = 'P0001';
  end if;

  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'Não é possível reativar uma compra cancelada.'
      using errcode = 'P0001';
  end if;

  -- `confirmed_at` só é decidido aqui dentro — nunca pelo valor que o
  -- caller mandou. Na ativação (draft -> confirmed), vira `now()`
  -- incondicionalmente (ignora qualquer timestamp "falsificado" enviado
  -- junto). Em qualquer outra transição, é sempre preservado igual a
  -- `OLD.confirmed_at` — nem uma edição de `confirmed -> cancelled` nem
  -- nenhuma outra operação consegue apagar ou adiantar/atrasar esse
  -- registro histórico depois que ele existe.
  if v_is_activation then
    new.confirmed_at := now();
  else
    new.confirmed_at := old.confirmed_at;
  end if;

  -- Campos financeiros travados assim que a compra passou por 'confirmed'
  -- — inclusive depois de cancelada (OLD.status IN ('confirmed',
  -- 'cancelled')), porque o fato histórico não deve mudar só porque o
  -- status mudou de novo na mesma ou numa operação posterior.
  if old.status in ('confirmed', 'cancelled') and (
    new.total_price is distinct from old.total_price
    or new.items_amount is distinct from old.items_amount
    or new.shipping_amount is distinct from old.shipping_amount
    or new.insurance_amount is distinct from old.insurance_amount
    or new.tax_amount is distinct from old.tax_amount
    or new.discount_amount is distinct from old.discount_amount
  ) then
    raise exception 'Não é possível alterar valores financeiros de uma compra confirmada ou cancelada. Reabra a compra para edição antes de alterar (fluxo ainda não implementado — Etapa 14.1-R2 §2).'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke execute on function public.check_purchase_confirmed_immutable() from public, anon, authenticated;
