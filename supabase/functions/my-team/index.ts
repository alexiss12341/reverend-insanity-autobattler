// @ts-nocheck
// Arena MY-TEAM — does the CALLER already have a registered defense team? JWT-gated (verify_jwt=true) so the
// only row ever read is the one keyed by the verified `sub`. The client's one-time defense-resync migration
// uses this to re-register ONLY players who already have a (possibly stale, past-reincarnation) team, instead
// of auto-enrolling someone who never registered. Authoritative where the public `list` isn't — list is capped
// at the top 100 by Elo, so it can't be trusted to contain the caller.
import { CORS, json, callerId } from "../_shared/team.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const playerId = callerId(req);
  if (!playerId) return json({ error: "no identity" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(
    `${url}/rest/v1/teams?player_id=eq.${encodeURIComponent(playerId)}&select=player_id,points`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!r.ok) return json({ error: "lookup failed", detail: await r.text() }, 502);
  const rows = await r.json();
  const exists = Array.isArray(rows) && rows.length > 0;
  return json({ ok: true, exists, points: exists ? (rows[0].points ?? null) : null });
});
