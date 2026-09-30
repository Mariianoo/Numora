-- ============================================================================
-- Etapa "B2.1 — Hardening" — fronteira de confiança do consentimento legal.
--
-- STATUS: candidata a promoção futura para Production — NÃO aplicada em
-- Production por esta etapa (só repositório/DEV). SUPERSEDE a parte de
-- consentimentos de 20260925163435_handle_new_user_country_and_consents:
-- ao promover, aplicar as três migrations B2 em ordem (esta é idempotente
-- sobre a anterior) — o resultado final é o `handle_new_user()` abaixo.
--
-- PROBLEMA: `raw_user_meta_data` é fornecida por QUEM CHAMA o Supabase Auth.
-- Com a anon key pública, qualquer cliente pode chamar o GoTrue direto (sem
-- passar pelo servidor do Numora) com metadata arbitrária — inclusive
-- versões de Termos/Privacidade e "18+" já preenchidas. Um trigger que
-- gravasse `legal_consents` a partir dessa metadata produziria PROVA
-- JURÍDICA FALSA de aceite (o oposto do objetivo da tabela). Um "Before User
-- Created" hook não resolve sozinho: ele só recebe `user_metadata`, e-mail e
-- IP — sem headers/origem — e não distingue o cadastro oficial de uma
-- chamada direta sem um segredo compartilhado (que não pode ser criado
-- nesta etapa) e não é configurável/verificável a partir do repositório.
--
-- SOLUÇÃO: a metadata deixa de ser prova de qualquer coisa jurídica. O
-- trigger volta a criar SÓ o profile (nome, e-mail e país validado — dados
-- não jurídicos; o país já é editável pelo próprio usuário via RLS). As
-- linhas de `legal_consents` só são gravadas pelo SERVIDOR do Numora
-- (`service_role`, lib/legal/signup-consents.ts), depois de validar
-- flag/CAPTCHA/versões vigentes/18+/país e de confirmar que o usuário
-- acabou de ser criado. Uma conta criada por chamada direta ao GoTrue nunca
-- terá linha em `legal_consents` — ausência de prova, nunca prova falsa.
--
-- Mantém: SECURITY DEFINER, `search_path = public`, `on conflict (id) do
-- nothing`, o REVOKE EXECUTE já aplicado (CREATE OR REPLACE preserva a ACL),
-- a validação do país (`^[A-Z]{2}$` + `countries.type = 'sovereign_state'`,
-- inválido → NULL) e o comportamento sem metadata (Admin API, convites,
-- conta de análise, testes) — inalterado.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meta    jsonb;
  v_country text;
begin
  v_meta := case
    when jsonb_typeof(new.raw_user_meta_data) = 'object' then new.raw_user_meta_data
    else '{}'::jsonb
  end;

  v_country := v_meta ->> 'country_code';
  if v_country is null
     or v_country !~ '^[A-Z]{2}$'
     or not exists (
       select 1 from public.countries c where c.code = v_country and c.type = 'sovereign_state'
     ) then
    v_country := null;
  end if;

  insert into public.profiles (id, email, name, country_code)
  values (
    new.id,
    new.email,
    coalesce(v_meta ->> 'name', v_meta ->> 'full_name'),
    v_country
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Cria o profile (nome/e-mail/país validado) na criação do usuário. NÃO grava consentimentos legais: a metadata do cliente não é prova de aceite — ver lib/legal/signup-consents.ts (escrita só pelo servidor).';
