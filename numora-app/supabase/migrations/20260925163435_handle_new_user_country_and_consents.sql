-- ============================================================================
-- Etapa "B2 — Signup + Legal" — `handle_new_user()` passa a persistir, NA
-- CRIAÇÃO do usuário (mesma transação de auth.users), o país e os
-- consentimentos vindos da metadata de cadastro.
--
-- STATUS: candidata a promoção futura para Production — NÃO aplicada em
-- Production por esta etapa. Depende de 20260925163425_create_legal_consents.
--
-- PROBLEMA CORRIGIDO: antes, `country_code` só chegava ao profile por um
-- UPDATE posterior (callback PKCE ou update do browser). Confirmar o e-mail
-- em OUTRO navegador faz a troca PKCE falhar e o país se perdia. Agora o
-- trigger grava o país no INSERT do profile — independe de qualquer passo
-- posterior do navegador.
--
-- VALIDAÇÃO (nunca confia na metadata crua):
--   - país: só entra se for `^[A-Z]{2}$` E existir em `countries` com
--     `type = 'sovereign_state'` (mesmo universo do seletor de residência) —
--     qualquer outra coisa vira NULL (o cadastro nunca falha por isso; a
--     rota de cadastro já rejeita país inválido antes de chegar aqui);
--   - consentimentos: só são gravados quando TODOS os obrigatórios
--     (terms, privacy, age_18) trazem versão bem formada; marketing é
--     opcional e só entra junto de um conjunto obrigatório completo. Sem
--     conjunto completo NADA é gravado (tudo-ou-nada). Contas criadas sem
--     essa metadata (Admin API, convites, conta de análise, testes) seguem
--     exatamente como antes: profile sem país e sem consentimentos.
--   - o trigger nunca lança exceção por metadata inválida (evita derrubar a
--     criação de usuário).
--
-- LIMITAÇÃO CONHECIDA (registrada, não resolvida aqui): a metadata é
-- fornecida por quem chama o Supabase Auth. A rota app/api/auth/signup
-- valida versões vigentes/maioridade/país no servidor, mas uma chamada
-- DIRETA ao GoTrue (com a anon key pública) poderia enviar metadata
-- arbitrária SE o signup estiver habilitado no Supabase Auth. Hoje isso é
-- impedido por `disable_signup`; antes de abrir o cadastro é preciso um
-- "Before User Created" hook (ou equivalente) — dependência EXTERNA.
--
-- Mantém: SECURITY DEFINER, `search_path = public`, `on conflict (id) do
-- nothing`, e o REVOKE EXECUTE já aplicado (CREATE OR REPLACE preserva ACL).
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meta          jsonb;
  v_country       text;
  v_terms         text;
  v_privacy       text;
  v_age           text;
  v_marketing     text;
  v_version_regex constant text := '^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$';
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

  v_terms     := v_meta ->> 'terms_version';
  v_privacy   := v_meta ->> 'privacy_version';
  v_age       := v_meta ->> 'age_18_version';
  v_marketing := v_meta ->> 'marketing_email_version';

  if v_terms ~ v_version_regex and v_privacy ~ v_version_regex and v_age ~ v_version_regex then
    insert into public.legal_consents (user_id, document_type, document_version, source)
    values
      (new.id, 'terms',   v_terms,   'signup'),
      (new.id, 'privacy', v_privacy, 'signup'),
      (new.id, 'age_18',  v_age,     'signup')
    on conflict (user_id, document_type, document_version) do nothing;

    if v_marketing ~ v_version_regex then
      insert into public.legal_consents (user_id, document_type, document_version, source)
      values (new.id, 'marketing_email', v_marketing, 'signup')
      on conflict (user_id, document_type, document_version) do nothing;
    end if;
  end if;

  return new;
end;
$$;
