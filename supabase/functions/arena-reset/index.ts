// @ts-nocheck
// Arena RESET — wipes the caller's arena standing on REINCARNATION. Deletes their `teams` row, which both
// REMOVES their registered defense team from the ladder AND clears their Elo rating + win/loss record. After
// this the player is "unranked" until they register a fresh defense team (which then starts at the default
// rating with a 0–0 record, exactly like a brand-new player). JWT-gated (verify_jwt=true): the only row ever
// touched is the one keyed by the caller's VERIFIED `sub`, so a player can only ever reset THEIR OWN standing.
import { CORS, json, callerId } from "../_shared/team.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const playerId = callerId(req);
  if (!playerId) return json({ error: "no identity" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // DELETE is idempotent — a no-op when the player never registered a team (returns 200 either way).
  const r = await fetch(`${url}/rest/v1/teams?player_id=eq.${encodeURIComponent(playerId)}`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=minimal" },
  });
  if (!r.ok) return json({ error: "reset failed", detail: await r.text() }, 502);
  return json({ ok: true, reset: true });
});
