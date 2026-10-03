-- ============================================================================
-- Etapa "B2.5.4 — Rate limiting do signup" — contador distribuído em Postgres
-- para POST /api/auth/signup (serverless/multi-instância: nenhum estado em
-- memória do processo).
--
-- STATUS: candidata a promoção futura para Production — NÃO aplicada em
-- Production por esta etapa (só repositório/DEV).
--
-- MODELO: janela fixa por bucket. Um bucket é uma chave calculada no servidor
-- (`ip:<sha256>` / `email:<sha256>`) — nenhum IP nem e-mail em claro chega a
-- esta tabela. ATENÇÃO: o hash é SHA-256 SEM pepper, ou seja, PSEUDONIMIZAÇÃO e
-- não anonimização (o espaço de IPv4 e de e-mails conhecidos é enumerável): trate
-- `bucket_key` como dado pessoal pseudonimizado, nunca como dado anônimo.
-- `consume_signup_rate_limit` é uma ÚNICA instrução
-- `insert ... on conflict do update`: o Postgres serializa as atualizações da
-- mesma linha, então N requisições simultâneas incrementam o contador N vezes
-- (sem corrida de leitura-e-escrita) e exatamente `p_limit` delas são aceitas.
--
-- TTL: linhas com janela vencida são sobrescritas no próximo acesso ao bucket
-- e as abandonadas há mais de 1 dia são removidas de forma oportunista (2% das
-- chamadas, em lotes de 500) — sem cron/scheduler.
--
-- ACESSO: tabela com RLS ligada e NENHUMA policy (anon/authenticated nunca
-- tocam); a função é SECURITY DEFINER e executável só por service_role.
-- ============================================================================

create table public.signup_rate_limits (
  bucket_key   text        primary key check (char_length(bucket_key) between 1 and 200),
  window_start timestamptz not null,
  hit_count    integer     not null check (hit_count >= 0)
);

create index signup_rate_limits_window_start_idx on public.signup_rate_limits (window_start);

alter table public.signup_rate_limits enable row level security;
revoke all on table public.signup_rate_limits from public, anon, authenticated;

comment on table public.signup_rate_limits is
  'Etapa B2.5.4 — contadores de rate limit do signup público (janela fixa). IP/e-mail nunca são gravados em claro: a chave é um hash SHA-256 sem pepper calculado no servidor (dado PSEUDONIMIZADO, não anônimo). Sem policies: só service_role (via consume_signup_rate_limit).';

create or replace function public.consume_signup_rate_limit(
  p_bucket         text,
  p_limit          integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now    timestamptz := clock_timestamp();
  v_window interval;
  v_start  timestamptz;
  v_count  integer;
begin
  if p_bucket is null or char_length(p_bucket) not between 1 and 200 then
    raise exception 'bucket inválido' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'limite inválido' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'janela inválida' using errcode = '22023';
  end if;

  v_window := make_interval(secs => p_window_seconds);

  insert into public.signup_rate_limits as r (bucket_key, window_start, hit_count)
  values (p_bucket, v_now, 1)
  on conflict (bucket_key) do update
    set window_start = case when r.window_start + v_window <= v_now then v_now else r.window_start end,
        hit_count    = case when r.window_start + v_window <= v_now then 1 else least(r.hit_count + 1, p_limit + 1) end
  returning r.window_start, r.hit_count into v_start, v_count;

  if random() < 0.02 then
    delete from public.signup_rate_limits
    where bucket_key in (
      select s.bucket_key
      from public.signup_rate_limits s
      where s.window_start < v_now - interval '1 day'
      limit 500
    );
  end if;

  return query
    select
      v_count <= p_limit,
      case
        when v_count <= p_limit then 0
        else greatest(1, least(p_window_seconds, ceil(extract(epoch from (v_start + v_window - v_now)))::integer))
      end;
end;
$$;

revoke all on function public.consume_signup_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_signup_rate_limit(text, integer, integer) to service_role;

comment on function public.consume_signup_rate_limit(text, integer, integer) is
  'Etapa B2.5.4 — consome 1 tentativa do bucket (janela fixa, atômico). Devolve allowed e retry_after_seconds (0 quando permitido). Só service_role.';
