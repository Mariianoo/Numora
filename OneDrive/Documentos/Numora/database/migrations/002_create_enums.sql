-- ============================================================================
-- 002_create_enums.sql
-- CoinVerse — Enumerações do sistema (ver DATABASE_ARCHITECTURE.md, seção 5).
-- Padrão idempotente: DO block + EXCEPTION duplicate_object (CREATE TYPE não
-- suporta IF NOT EXISTS nativamente).
-- ============================================================================

do $$ begin
  create type user_role as enum ('visitor','user','verified_seller','moderator','admin','system','ai');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_tier as enum ('free','premium','pro');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_status as enum ('active','past_due','cancelled','expired','trialing');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('pending','succeeded','failed','refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type device_type as enum ('web','ios','android','desktop');
exception when duplicate_object then null; end $$;

do $$ begin
  create type catalog_item_type as enum ('coin','banknote','medal','token');
exception when duplicate_object then null; end $$;

do $$ begin
  create type coin_material as enum ('gold','silver','copper','bronze','nickel','aluminum','bimetallic','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type grading_scale as enum ('sheldon_70','mercosul_10','custom');
exception when duplicate_object then null; end $$;

do $$ begin
  create type grading_source as enum ('self_reported','community','professional','ai');
exception when duplicate_object then null; end $$;

do $$ begin
  create type item_visibility as enum ('private','collection_only','public');
exception when duplicate_object then null; end $$;

do $$ begin
  create type photo_angle as enum ('front','back','edge','certificate','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type listing_status as enum ('draft','active','paused','sold','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type offer_status as enum ('pending','accepted','rejected','cancelled','expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type transaction_status as enum ('pending','paid','shipped','completed','disputed','refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type trade_status as enum ('pending','accepted','rejected','cancelled','completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ai_analysis_type as enum ('recognition','condition_estimate','value_estimate','authenticity_check');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ai_status as enum ('queued','processing','completed','failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type conversation_context as enum ('direct','marketplace_listing','trade_proposal','support');
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_type as enum ('text','image','system');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_type as enum (
    'new_offer','offer_accepted','new_message','trade_proposal','wishlist_match',
    'achievement_unlocked','system_announcement','moderation_update'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_channel as enum ('in_app','push','email');
exception when duplicate_object then null; end $$;

do $$ begin
  create type report_target_type as enum ('listing','message','user','catalog_item','event');
exception when duplicate_object then null; end $$;

do $$ begin
  create type report_reason as enum ('fraud','counterfeit','spam','harassment','inappropriate_content','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type report_status as enum ('open','in_review','resolved','dismissed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type admin_action_type as enum (
    'role_change','content_removal','account_suspension','account_reinstatement',
    'catalog_edit','report_resolution'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type moderation_status as enum ('pending','in_review','approved','rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app_platform as enum ('web','ios','android');
exception when duplicate_object then null; end $$;

do $$ begin
  create type wishlist_priority as enum ('low','medium','high');
exception when duplicate_object then null; end $$;

do $$ begin
  create type event_participation_status as enum ('interested','confirmed','attended','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type audit_action as enum (
    'insert','update','delete','login','logout','permission_change','export','access_denied'
  );
exception when duplicate_object then null; end $$;
