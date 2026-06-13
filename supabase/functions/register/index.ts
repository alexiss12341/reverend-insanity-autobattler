// @ts-nocheck
// Arena REGISTER — the SOLE writer to the `teams` table. Validates + recomputes a team server-side
// (buildSnapshot, which preserves FORMATION row/lane + KILLER-MOVE setups) and upserts it as that player's
// defense team. Writes with the service-role key (the browser key can only read). Anti-cheat: stops
// injected stats + impossible teams; not legal-but-unearned saves. Shared pipeline in _shared/team.ts.
import { CORS, json, prepareTeam, callerId, ENGINE_VERSION } from "../_shared/team.ts";
import { buildSnapshot } from "../../../src/systems/battle.js";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "bad JSON" }, 400); }

  // Identity comes from the VERIFIED token (verify_jwt=true), never from the body — so a player can only
  // ever write their OWN defense team. The old free-text body.playerId let anyone overwrite anyone's team.
  const playerId = callerId(req);
  const name = String(body.name || "").trim().slice(0, 40);
  if (!playerId) return json({ error: "sign in to register an arena team" }, 401);

  const prep = prepareTeam(body.team, body.ctx);
  if (prep.error) return json({ error: prep.error }, 400);

  let snapshot;
  try { snapshot = buildSnapshot(prep.chars, prep.ctx); }
  catch (e) { return json({ error: "snapshot failed: " + ((e && e.message) || e) }, 500); }

  const power = snapshot.reduce((s, u) => { const t = u.tiers[u.tiers.length - 1]; return s + (t.atk + t.def + t.max); }, 0);
  const realm = prep.chars.reduce((mx, c) => Math.max(mx, c.realm), 0);

  const rowData = {
    player_id: playerId, name: name || "Anonymous", power: Math.round(power), realm,
    snapshot: { v: ENGINE_VERSION, name: name || "Anonymous", team: snapshot },
    updated_at: new Date().toISOString(),
  };

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resp = await fetch(`${url}/rest/v1/teams`, {
    method: "POST",
    headers: {
      apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rowData),
  });
  if (!resp.ok) return json({ error: "db write failed", detail: await resp.text() }, 502);

  return json({ ok: true, power: rowData.power, realm, members: snapshot.length });
});
