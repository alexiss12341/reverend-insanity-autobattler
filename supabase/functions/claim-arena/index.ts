// @ts-nocheck
// Move a GUEST's arena team (registered under their anonymous user id) into the now-signed-in account,
// preserving its Elo + cooldown + snapshot. Auth-gated (verify_jwt=true) so we know WHO is claiming — the
// caller's verified id is the destination. Only claims when the account has no team yet (never overwrites);
// when the account ALREADY has a team the guest row is orphaned, so it's swept (deleted) instead — but only
// after confirming that id is an anonymous guest, so a spoofed guestId can't wipe a real account's team.
import { CORS, json } from "../_shared/team.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // verify_jwt=true → Supabase already validated this token; the `sub` claim is the caller's user id.
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  let userId;
  try { userId = JSON.parse(atob(token.split(".")[1])).sub; } catch { userId = null; }
  if (!userId) return json({ error: "no identity" }, 401);

  let body; try { body = await req.json(); } catch { return json({ error: "bad JSON" }, 400); }
  const guestId = String(body.guestId || "").trim();
  if (!guestId || guestId === userId) return json({ ok: true, claimed: false });

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const hdr = { apikey: key, Authorization: `Bearer ${key}` };

  // already have a team on the account? keep it — never overwrite an existing account team. But the guest's
  // row is now ORPHANED: the player abandoned that anonymous identity by signing in, and once signed in the
  // client can no longer delete it (arena-reset only deletes the CALLER's own row). So sweep it here — this is
  // what stops a reincarnated/abandoned guest team from lingering on the ladder forever after a sign-in.
  // GUARD: only ever delete a row whose owner is an ANONYMOUS guest, never a real account. player_ids are
  // PUBLIC (the list endpoint returns them), so without this an attacker could pass a victim's id as guestId
  // to wipe their team. The is_anonymous check (verified via the GoTrue admin API with the service-role key)
  // means the worst a spoofed id can touch is another throwaway guest, never a real account's standing.
  const mine = await (await fetch(`${url}/rest/v1/teams?player_id=eq.${encodeURIComponent(userId)}&select=player_id`, { headers: hdr })).json();
  if (Array.isArray(mine) && mine.length) {
    let cleaned = false;
    try {
      const gu = await (await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(guestId)}`, { headers: hdr })).json();
      const isAnon = !!(gu && (gu.is_anonymous || (gu.user && gu.user.is_anonymous)));
      if (isAnon) {
        const del = await fetch(`${url}/rest/v1/teams?player_id=eq.${encodeURIComponent(guestId)}`, {
          method: "DELETE", headers: { ...hdr, Prefer: "return=minimal" },
        });
        cleaned = del.ok; // DELETE is idempotent: a no-op (still 200) if the guest never registered
      }
    } catch (_e) { /* best-effort: never fail the sign-in claim because the orphan sweep hiccuped */ }
    return json({ ok: true, claimed: false, cleaned, reason: "account already has a team" });
  }

  // move the guest's row (Elo, cooldown, snapshot all ride along) to the account
  const r = await fetch(`${url}/rest/v1/teams?player_id=eq.${encodeURIComponent(guestId)}`, {
    method: "PATCH",
    headers: { ...hdr, "content-type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ player_id: userId }),
  });
  if (!r.ok) return json({ error: "claim failed", detail: await r.text() }, 502);
  return json({ ok: true, claimed: true });
});
