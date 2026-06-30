-- 009_pipeline_metrics.sql
-- Adds pipeline_metrics JSONB to daily_sheets so every upload records which
-- engines ran, whether escalation was triggered, and the corroboration rate.
-- This enables trend analysis over time (escalation rate, flag frequency, etc.)
-- without having to parse SSE logs.
--
-- Schema of the JSONB object stored per upload:
--   primary_engine   TEXT    — 'gemini' | 'haiku' | 'haiku-primary-fallback'
--   escalated        BOOLEAN — true if paid Claude Haiku escalation ran
--   tie_broken       BOOLEAN — true if free OpenRouter tie-breaker resolved the dispute
--   auto_corrected   BOOLEAN — true if vol_today substitution or FINAL_CLAMP applied
--   corroborated     INT     — count of values found in OCR word lists
--   unverified       INT     — count of values NOT found in OCR word lists
--   qwen_ok          BOOLEAN — Qwen3-VL-8B returned usable results
--   mistral_ok       BOOLEAN — Mistral OCR 3 returned usable results
--   confidence_boost DECIMAL — net confidence adjustment from cross-validation

ALTER TABLE daily_sheets
  ADD COLUMN IF NOT EXISTS pipeline_metrics JSONB;

COMMENT ON COLUMN daily_sheets.pipeline_metrics IS
  'OCR pipeline telemetry per upload: primary_engine, escalated, tie_broken, auto_corrected, corroborated, unverified, qwen_ok, mistral_ok, confidence_boost';
