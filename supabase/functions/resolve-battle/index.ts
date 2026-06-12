// @ts-nocheck
// Arena RESOLVE-BATTLE — the AUTHORITATIVE fight + Elo update when a player challenges a registered team.
// The attacker's team is validated + recomputed server-side (same pipeline as register), the defender's
// stored snapshot is loaded, a RANDOM SEED is chosen, and resolveEncounter runs WITHOUT a timeline (just
// the verdict). Then a zero-sum Elo update (K=50) adjusts BOTH players' arena points and they're persisted.
// Returns { winner, seed, attacker:{points,delta}, defender:{points,delta,team} } — the client replays the
// exact fight from the seed (its own team vs the defender snapshot) to ANIMATE it. Shared: _shared/team.ts.
import { CORS, json, prepareTeam, ENGINE_VERSION } from "../_shared/team.ts";
import { resolveEncounter } from "../../../src/systems/battle.js";
import { arenaCanChallenge, ARENA_UP, ARENA_DOWN, ARENA_NEAREST_K } from "../../../src/data/arena.js";

const K = 50; // Elo K-factor: an EVEN match swings ±25; beating a higher-rated foe gains more, losing to one costs less.
const expectedScore = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / 400));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "bad JSON" }, 400); }

  const attacker = body.attacker || {};
  const attackerId = String(attacker.playerId || "").trim();
  const defenderId = String(body.defenderId || "").trim();
  if (!attackerId) return json({ error: "missing attacker.playerId" }, 400);
  if (!defenderId) return json({ error: "missing defenderId" }, 400);
  if (attackerId === defenderId) return json({ error: "cannot challenge yourself" }, 400);

  const prep = prepareTeam(attacker.team, attacker.ctx);
  if (prep.error) return json({ error: prep.error }, 400);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const hdr = { apikey: key, Authorization: `Bearer ${key}` };

  // load both players in one query (current Elo + the defender's stored snapshot)
  const lr = await fetch(
    `${url}/rest/v1/teams?player_id=in.(${encodeURIComponent(attackerId)},${encodeURIComponent(defenderId)})&select=player_id,name,snapshot,points,cooldown_until,wins,losses`,
    { headers: hdr },
  );
  if (!lr.ok) return json({ error: "lookup failed", detail: await lr.text() }, 502);
  const rows = await lr.json();
  const aRow = rows.find((r) => r.player_id === attackerId);
  const dRow = rows.find((r) => r.player_id === defenderId);
  if (!aRow) return json({ error: "register your team before challenging" }, 409);
  if (!dRow) return json({ error: "defender not found" }, 404);
  const defenderTeam = dRow.snapshot && dRow.snapshot.team;
  if (!Array.isArray(defenderTeam) || !defenderTeam.length) return json({ error: "defender has no team" }, 422);

  // DEFENDER COOLDOWN: a team just challenged is protected for 2 min so it can't be farmed (server-authoritative).
  const cdUntil = dRow.cooldown_until ? Date.parse(dRow.cooldown_until) : 0;
  if (cdUntil > Date.now()) {
    const secs = Math.ceil((cdUntil - Date.now()) / 1000);
    return json({ error: `That cultivator was just challenged — on cooldown for ${secs}s.`, code: "on_cooldown", retryMs: cdUntil - Date.now() }, 429);
  }

  // MATCHMAKING GATE: only challenge within the asymmetric Elo band, or your nearest-K by rating (data/arena.js).
  const ra = aRow.points ?? 1000, rb = dRow.points ?? 1000;
  if (!(rb <= ra + ARENA_UP && rb >= ra - ARENA_DOWN)) {
    const gap = Math.abs(rb - ra); // outside the band → eligible only if among the attacker's nearest K by rating
    const cr = await fetch(`${url}/rest/v1/teams?player_id=neq.${encodeURIComponent(attackerId)}&points=gt.${ra - gap}&points=lt.${ra + gap}&select=player_id&limit=${ARENA_NEAREST_K}`, { headers: hdr });
    const closer = cr.ok ? (await cr.json()).length : ARENA_NEAREST_K; // fail closed on error
    if (!arenaCanChallenge(ra, rb, closer)) return json({ error: "That opponent is outside your challenge range.", code: "out_of_range" }, 403);
  }

  // server-chosen seed → the client replays the identical fight from it for the animation
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
  const encounter = { floor: 0, isBoss: false, isWaveEncounter: false, squad: "Arena", waves: [defenderTeam] };

  let result;
  try { result = resolveEncounter(encounter, null, { seed, allyChars: prep.chars, ctx: prep.ctx }); }
  catch (e) { return json({ error: "battle failed: " + ((e && e.message) || e) }, 500); }

  // zero-sum Elo: attacker's delta = K·(score − expected); defender moves by the exact opposite.
  const attackerWon = !!result.win; // NOTE: a 3000-action timeout counts as an attacker win (v1 quirk)
  const deltaA = Math.round(K * ((attackerWon ? 1 : 0) - expectedScore(ra, rb)));
  const newA = ra + deltaA, newB = rb - deltaA;
  const aW = (aRow.wins ?? 0) + (attackerWon ? 1 : 0), aL = (aRow.losses ?? 0) + (attackerWon ? 0 : 1);
  const bW = (dRow.wins ?? 0) + (attackerWon ? 0 : 1), bL = (dRow.losses ?? 0) + (attackerWon ? 1 : 0);

  // persist both ratings (best-effort; small read-modify-write race window is acceptable at v1 volume)
  const COOLDOWN_MS = 2 * 60 * 1000; // the defender is protected for 2 min after being challenged
  const cooldownUntil = new Date(Date.now() + COOLDOWN_MS).toISOString();
  const patch = (id, body) => fetch(`${url}/rest/v1/teams?player_id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { ...hdr, "content-type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(body),
  });
  await Promise.all([patch(attackerId, { points: newA, wins: aW, losses: aL }), patch(defenderId, { points: newB, cooldown_until: cooldownUntil, wins: bW, losses: bL })]);

  return json({
    ok: true,
    winner: attackerWon ? "attacker" : "defender",
    seed, rounds: result.rounds, engineVersion: ENGINE_VERSION,
    attacker: { points: newA, delta: deltaA, wins: aW, losses: aL },
    defender: { name: dRow.name, points: newB, delta: -deltaA, team: defenderTeam, cooldownUntil, wins: bW, losses: bL },
  });
});
