-- ============================================================================
-- 011_rollback_part1.sql
-- CoinVerse — Rollback do Lote 1 (arquivos 001 a 010).
-- NÃO faz parte do fluxo normal de `supabase migration up`; execução manual
-- e deliberada apenas em caso de necessidade de reverter este lote completo
-- em ambiente ainda não-produtivo (destrutivo — apaga dados).
-- Ordem: inversa às dependências de FK.
-- ============================================================================

-- ---- RLS / policies são removidas automaticamente com DROP TABLE. ----

drop table if exists public.certificates cascade;
drop table if exists public.item_photos cascade;
drop table if exists public.grading_records cascade;

drop table if exists public.catalog_items cascade;
drop table if exists public.catalog_mints cascade;
drop table if exists public.catalog_series cascade;
drop table if exists public.catalog_countries cascade;

drop table if exists public.collection_items cascade;
drop table if exists public.collections cascade;

drop table if exists audit.error_logs cascade;
drop table if exists audit.system_logs cascade;
drop table if exists audit.audit_logs cascade;

drop table if exists public.user_sessions cascade;
drop table if exists public.user_devices cascade;
drop table if exists public.user_roles cascade;
drop table if exists public.profiles cascade;

drop function if exists public.fn_create_monthly_partition(text, text, date);
drop function if exists public.fn_is_moderator();
drop function if exists public.fn_is_admin();
drop function if exists public.fn_soft_delete();
drop function if exists public.fn_audit_trigger();
drop function if exists public.fn_set_updated_at();

drop type if exists audit_action;
drop type if exists event_participation_status;
drop type if exists wishlist_priority;
drop type if exists app_platform;
drop type if exists moderation_status;
drop type if exists admin_action_type;
drop type if exists report_status;
drop type if exists report_reason;
drop type if exists report_target_type;
drop type if exists notification_channel;
drop type if exists notification_type;
drop type if exists message_type;
drop type if exists conversation_context;
drop type if exists ai_status;
drop type if exists ai_analysis_type;
drop type if exists trade_status;
drop type if exists transaction_status;
drop type if exists offer_status;
drop type if exists listing_status;
drop type if exists photo_angle;
drop type if exists item_visibility;
drop type if exists grading_source;
drop type if exists grading_scale;
drop type if exists coin_material;
drop type if exists catalog_item_type;
drop type if exists device_type;
drop type if exists payment_status;
drop type if exists subscription_status;
drop type if exists subscription_tier;
drop type if exists user_role;

drop schema if exists analytics cascade;
drop schema if exists audit cascade;

-- Extensões (pgcrypto/pg_trgm) não são removidas: podem ser usadas por
-- outros objetos fora do escopo deste rollback.
