// @ts-nocheck
// Cloud save READ — the SOLE reader of the `saves` table for the client (direct SELECT is revoked). JWT-gated
// (verify_jwt=true): returns ONLY the caller's own slots, keyed off the verified token `sub`. Every row's
// HMAC is re-verified against the server-only secret; a row whose `blob` was edited out-of-band fails and is
// returned as { data: null, tampered: true } so the client refuses to load it.
//
// Legacy rows written before signing existed (blob/sig null) are GRANDFATHERED through — which is safe,
// because once the lockdown migration revokes direct client writes, no NEW unsigned row can be created: an
// unsigned row can now only be a pre-existing legacy save (re-signed on its next save-put) or one written by
// the service role itself. So "accept unsigned" no longer opens a bypass the way it would for the client.
import { CORS, json, callerId, hmacHex, sigMessage, sigEqual } from "../_shared/saves.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const userId = callerId(req);
  if (!userId) return json({ error: "sign in to load" }, 401);

  const secret = Deno.env.get("SAVE_HMAC_SECRET");
  if (!secret) return json({ error: "save signing not configured" }, 500);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(
    `${url}/rest/v1/saves?user_id=eq.${encodeURIComponent(userId)}&select=slot,data,blob,sig,updated_at&order=slot`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!r.ok) return json({ error: "db read failed", detail: await r.text() }, 502);
  const rows = await r.json();

  const saves = [];
  for (const row of rows) {
    if (row.blob == null || row.sig == null) { // legacy unsigned row (pre-HMAC) — grandfather it through
      saves.push({ slot: row.slot, data: row.data, updated_at: row.updated_at, tampered: false });
      continue;
    }
    const want = await hmacHex(secret, sigMessage(userId, row.slot, row.blob));
    if (sigEqual(want, row.sig)) {
      saves.push({ slot: row.slot, data: JSON.parse(row.blob), updated_at: row.updated_at, tampered: false });
    } else { // blob no longer matches its signature → edited outside save-put → refuse to hand back the data
      saves.push({ slot: row.slot, data: null, updated_at: row.updated_at, tampered: true });
    }
  }
  return json({ ok: true, saves });
});
