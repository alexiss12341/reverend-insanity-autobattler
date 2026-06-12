-- saves: denormalize the owning account's email + display name onto each row.
--
-- The authoritative identity already lives in auth.users (linked via saves.user_id); these two
-- columns are a denormalized, dashboard-visible copy. They are filled SERVER-SIDE by a trigger that
-- reads auth.users, so the client can't spoof them (uploadSave is an unvalidated client upsert) and
-- they always reflect the true OAuth record. Google rows get email + full name; Discord rows get the
-- username (+ email when the email scope was granted). Guest (anonymous) rows stay null until the
-- player signs in and their saves are claimed under the real account.
--
-- HISTORY NOTE: this was APPLIED MANUALLY via the Supabase SQL Editor on 2026-06-13, NOT via
-- `supabase db push`. It lives here for version history. The rest of the schema (saves/teams tables,
-- RLS, arena columns) was likewise dashboard-made and is not yet captured as migrations, so this file
-- is a fragment, not a full baseline — if you ever adopt the CLI migration workflow, run
-- `supabase db pull` first to baseline the existing schema. Every statement below is idempotent, so
-- re-running it (dashboard or db push) is a safe no-op.

-- 1. Columns. account_email = Google/Discord email; account_name = display name.
alter table public.saves
  add column if not exists account_email text,
  add column if not exists account_name  text;

-- 2. Trigger fn: fill both from auth.users for the row's owner.
--    SECURITY DEFINER so it can read the auth schema; empty search_path forces full qualification.
create or replace function public.saves_fill_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select
    coalesce(u.email, u.raw_user_meta_data->>'email'),
    coalesce(
      u.raw_user_meta_data->>'full_name',
      u.raw_user_meta_data->>'name',
      u.raw_user_meta_data->>'user_name',
      u.raw_user_meta_data->>'preferred_username',
      u.email
    )
  into new.account_email, new.account_name
  from auth.users u
  where u.id = new.user_id;
  return new;
end;
$$;

-- 3. Fire it on every insert + update (upserts hit both paths).
drop trigger if exists trg_saves_fill_account on public.saves;
create trigger trg_saves_fill_account
  before insert or update on public.saves
  for each row execute function public.saves_fill_account();

-- 4. One-time backfill for rows that already existed before the trigger.
update public.saves s
set account_email = coalesce(u.email, u.raw_user_meta_data->>'email'),
    account_name  = coalesce(
      u.raw_user_meta_data->>'full_name',
      u.raw_user_meta_data->>'name',
      u.raw_user_meta_data->>'user_name',
      u.raw_user_meta_data->>'preferred_username',
      u.email)
from auth.users u
where u.id = s.user_id;
