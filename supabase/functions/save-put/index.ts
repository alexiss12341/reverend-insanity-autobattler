// @ts-nocheck
// Cloud save WRITE — the SOLE writer to the `saves` table (the browser's direct INSERT/UPDATE privilege is
// revoked; see the lockdown migration). JWT-gated (verify_jwt=true): the owner is the VERIFIED token `sub`,
// so a player can only ever write their OWN slot — never craft a row for another user_id. The save is
// serialized to a `blob` and HMAC-signed with the server-only secret, making the stored row tamper-EVIDENT:
// a later direct DB edit invalidates the signature and save-get refuses to load it.
import { CORS, json, callerId, hmacHex, sigMessage, SAVE_SLOTS, MAX_BLOB } from "../_shared/saves.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const userId = callerId(req);
  if (!userId) return json({ error: "sign in to save" }, 401);

  const secret = Deno.env.get("SAVE_HMAC_SECRET");
  if (!secret) return json({ error: "save signing not configured" }, 500); // fail closed if the secret is unset

  let body; try { body = await req.json(); } catch { return json({ error: "bad JSON" }, 400); }
  const slot = body.slot | 0;
  if (slot < 0 || slot >= SAVE_SLOTS) return json({ error: "bad slot" }, 400);
  if (!body.data || typeof body.data !== "object") return json({ error: "missing data" }, 400);

  const blob = JSON.stringify(body.data);          // exact bytes we sign + store (text round-trips losslessly)
  if (blob.length > MAX_BLOB) return json({ error: "save too large" }, 413);
  const sig = await hmacHex(secret, sigMessage(userId, slot, blob));

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // Upsert keyed on (user_id, slot). `data` (jsonb) is kept as a human-readable mirror for the dashboard;
  // `blob` + `sig` are the AUTHORITATIVE, verified copy that save-get reads.
  const resp = await fetch(`${url}/rest/v1/saves?on_conflict=user_id,slot`, {
    method: "POST",
    headers: {
      apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ user_id: userId, slot, data: body.data, blob, sig, updated_at: new Date().toISOString() }),
  });
  if (!resp.ok) return json({ error: "db write failed", detail: await resp.text() }, 502);
  return json({ ok: true });
});
