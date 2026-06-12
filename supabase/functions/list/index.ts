// @ts-nocheck
// Arena LIST — every registered team for the browse screen, sorted by arena points (Elo) desc. Routed
// through a function (not the REST API) so the frontend needs NO keys — just the project URL. Each team
// carries a lean per-member PREVIEW (the heavy `tiers` channel ladder is stripped server-side) plus its
// defender cooldown (cooldownUntil) so the UI can show a live "can't be challenged yet" countdown.
import { CORS, json } from "../_shared/team.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(
    `${url}/rest/v1/teams?select=player_id,name,points,power,realm,snapshot,cooldown_until,wins,losses&order=points.desc&limit=100`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!r.ok) return json({ error: "list failed", detail: await r.text() }, 502);
  const rows = await r.json();
  const teams = rows.map((row) => ({
    player_id: row.player_id, name: row.name, points: row.points, power: row.power, realm: row.realm,
    cooldownUntil: row.cooldown_until || null, wins: row.wins || 0, losses: row.losses || 0,
    members: ((row.snapshot && row.snapshot.team) || []).map((u) => {
      const top = (u.tiers && u.tiers[u.tiers.length - 1]) || {};
      return {
        name: u.name, rarity: u.rarity, realm: u.realm, line: u.line || null, daoPath: u.daoPath || null,
        row: u.row, lane: u.lane, gu: u.gu || [], killer: (u.killer && u.killer.name) || null,
        hp: Math.round(top.max || 0), atk: Math.round(top.atk || 0), def: Math.round(top.def || 0), spd: Math.round(top.spd || 0),
      };
    }),
  }));
  return json({ ok: true, teams });
});
