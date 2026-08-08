-- `handle_new_user` só deve rodar como trigger (contexto que expõe NEW),
-- não como RPC pública — revoga o EXECUTE que o Postgres concede por
-- padrão a public/anon/authenticated em funções no schema `public`.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
