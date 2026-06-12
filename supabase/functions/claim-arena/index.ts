// @ts-nocheck
// Move a GUEST's arena team (registered under their anonymous user id) into the now-signed-in account,
// preserving its Elo + cooldown + snapshot. Auth-gated (verify_jwt=true) so we know WHO is claiming — the
// caller's verified id is the destination. Only claims when the account has no team yet (never overwrites).
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

  // already have a team on the account? keep it — never overwrite an existing account team
  const mine = await (await fetch(`${url}/rest/v1/teams?player_id=eq.${encodeURIComponent(userId)}&select=player_id`, { headers: hdr })).json();
  if (Array.isArray(mine) && mine.length) return json({ ok: true, claimed: false, reason: "account already has a team" });

  // move the guest's row (Elo, cooldown, snapshot all ride along) to the account
  const r = await fetch(`${url}/rest/v1/teams?player_id=eq.${encodeURIComponent(guestId)}`, {
    method: "PATCH",
    headers: { ...hdr, "content-type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ player_id: userId }),
  });
  if (!r.ok) return json({ error: "claim failed", detail: await r.text() }, 502);
  return json({ ok: true, claimed: true });
});
