-- saves: make cloud saves tamper-EVIDENT, and force all writes through the signing Edge Function.
--
-- Pairs with the save-put / save-get functions. save-put serializes each save to `blob` (text) and stores
-- an HMAC `sig` keyed by a SERVER-ONLY secret (SAVE_HMAC_SECRET); save-get re-verifies it on read, so a row
-- edited directly in the DB (dashboard / crafted PostgREST call) fails its check and won't load. `data`
-- (jsonb) stays as a human-readable mirror for the dashboard, but `blob` + `sig` are AUTHORITATIVE.
--
-- ============================ ORDER OF OPERATIONS (read before running!) ============================
-- PART 1 (columns) is safe to run any time — additive, nullable, grandfathers existing rows.
-- PART 2 (the lockdown) REVOKES the browser's direct WRITE access, so it MUST be run LAST — only AFTER:
--   1. `supabase secrets set SAVE_HMAC_SECRET=<a long random string>`
--   2. `supabase functions deploy save-put save-get`
--   3. the updated client (cloud.js routing saves through the functions) is deployed AND verified working.
-- Run PART 2 before that and saves stop persisting (the client can no longer write the table directly).
-- ===================================================================================================

-- ---------- PART 1 — columns (safe any time) ----------
alter table public.saves
  add column if not exists blob text,   -- exact serialized save the signature covers
  add column if not exists sig  text;   -- HMAC-SHA256(SAVE_HMAC_SECRET, "<user_id>:<slot>:<blob>")

-- ---------- PART 2 — lockdown (run LAST, see ORDER above) ----------
-- Strip direct INSERT/UPDATE on `saves` from the client roles, so the ONLY way to WRITE a row is the
-- service-role save-put function (which signs it). This is what makes the signature meaningful: a player
-- can no longer craft/overwrite a row directly. SELECT and DELETE stay granted — a player reading or
-- deleting their OWN row (RLS-scoped) is not a tamper vector, and the game never trusts a direct read
-- (it loads through save-get, which verifies the signature).
revoke insert, update on public.saves from anon, authenticated;
