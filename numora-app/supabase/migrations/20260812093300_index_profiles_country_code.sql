-- Supabase Advisor (unindexed_foreign_keys): `profiles.country_code`
-- (FK para countries.code, adicionada nesta mesma etapa) não tinha índice
-- de cobertura. Sem isso, toda checagem de FK e toda futura consulta
-- filtrando/agrupando por nacionalidade fariam sequential scan.
create index idx_profiles_country_code on public.profiles (country_code);
