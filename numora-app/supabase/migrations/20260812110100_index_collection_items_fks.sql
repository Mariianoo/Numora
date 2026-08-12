-- Supabase Advisor (unindexed_foreign_keys), 4 achados após criar
-- collection_items: country_code, metal_code, secondary_metal_code e
-- grade_id não tinham índice de cobertura. O índice composto
-- (user_id, country_code) não serve para isso — country_code não é a
-- coluna líder, então não acelera a checagem de FK (que busca só por
-- country_code/metal_code/grade_id isoladamente, tipicamente ao avaliar
-- se uma linha de countries/metals/grades pode ser apagada).
create index idx_collection_items_country_code on public.collection_items (country_code);
create index idx_collection_items_metal_code on public.collection_items (metal_code);
create index idx_collection_items_secondary_metal_code on public.collection_items (secondary_metal_code);
create index idx_collection_items_grade_id on public.collection_items (grade_id);
