-- ============================================================================
-- 001_extensions_and_schemas.sql
-- CoinVerse — Extensões e schemas base.
-- Idempotente: seguro reexecutar.
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_trgm;    -- busca textual auxiliar (fallback a GIN/tsvector)

create schema if not exists audit;         -- audit_logs, system_logs, error_logs
create schema if not exists analytics;     -- user_events, aggregated_metrics

comment on schema audit is 'Logs de auditoria e técnicos — tabelas imutáveis, escrita restrita a service_role.';
comment on schema analytics is 'Telemetria de uso e métricas agregadas.';
