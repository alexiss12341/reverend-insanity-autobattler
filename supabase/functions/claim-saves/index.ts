// @ts-nocheck
// Move a GUEST's cloud saves (rows under their anonymous user id) into the now-signed-in account, RE-SIGNED
// under the account's id. JWT-gated (verify_jwt=true) so the destination is the VERIFIED caller — a player
// can only ever claim INTO their own account. Mirrors claim-arena (which moves the arena team).
//
// WHY RE-SIGN, not just re-key: each save's HMAC binds the blob to owner+slot (sigMessage). A guest save is
// signed with the GUEST's id, so a bare `update user_id` would make save-get see a mismatch and refuse it as
// tampered. So we re-serialize each save from its `data` mirror and re-sign it with the ACCOUNT's id (this
// function holds the server secret), then delete the guest rows we moved.
//
// NEVER OVERWRITES: only EMPTY account slots are filled. If the account's slots are all taken, the guest's
// saves stay under the guest id (still recoverable) — same "don't clobber an existing thing" rule as claim-arena.
import { CORS, json, callerId, hmacHex, sigMessage, SAVE_SLOTS, MAX_BLOB } from "../_shared/saves.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const userId = callerId(req);                 // destination account = the verified caller
  if (!userId) return json({ error: "sign in to claim saves" }, 401);

  const secret = Deno.env.get("SAVE_HMAC_SECRET");
  if (!secret) return json({ error: "save signing not configured" }, 500);

  let body; try { body = await req.json(); } catch { return json({ error: "bad JSON" }, 400); }
  const guestId = String(body.guestId || "").trim();
  if (!guestId || guestId === userId) return json({ ok: true, claimed: 0 }); // nothing to do

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const hdr = { apikey: key, Authorization: `Bearer ${key}` };

  // which slots does the account already use? never overwrite them
  const accRes = await fetch(`${url}/rest/v1/saves?user_id=eq.${encodeURIComponent(userId)}&select=slot`, { headers: hdr });
  if (!accRes.ok) return json({ error: "lookup failed", detail: await accRes.text() }, 502);
  const used = new Set((await accRes.json()).map((r) => r.slot));
  const free = [];
  for (let s = 0; s < SAVE_SLOTS; s++) if (!used.has(s)) free.push(s);
  if (!free.length) return json({ ok: true, claimed: 0, reason: "account already has saves" });

  // the guest's saves — the full object lives in the `data` jsonb mirror, which we re-serialize + re-sign
  const gRes = await fetch(`${url}/rest/v1/saves?user_id=eq.${encodeURIComponent(guestId)}&select=slot,data&order=slot`, { headers: hdr });
  if (!gRes.ok) return json({ error: "lookup failed", detail: await gRes.text() }, 502);
  const guestRows = await gRes.json();
  if (!guestRows.length) return json({ ok: true, claimed: 0 });

  let claimed = 0;
  const movedSlots = [];
  for (const g of guestRows) {
    if (!free.length) break;                    // account full → leave the rest under the guest id
    if (!g.data || typeof g.data !== "object") continue;
    const blob = JSON.stringify(g.data);
    if (blob.length > MAX_BLOB) continue;
    const slot = free.shift();
    const sig = await hmacHex(secret, sigMessage(userId, slot, blob));
    const put = await fetch(`${url}/rest/v1/saves?on_conflict=user_id,slot`, {
      method: "POST",
      headers: { ...hdr, "content-type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: userId, slot, data: g.data, blob, sig, updated_at: new Date().toISOString() }),
    });
    if (put.ok) { claimed++; movedSlots.push(g.slot); }
    else free.unshift(slot);                     // write failed → return the slot, try the next save
  }

  // remove the guest rows we successfully moved (best-effort)
  if (movedSlots.length) {
    await fetch(`${url}/rest/v1/saves?user_id=eq.${encodeURIComponent(guestId)}&slot=in.(${movedSlots.join(",")})`, {
      method: "DELETE", headers: { ...hdr, Prefer: "return=minimal" },
    });
  }

  return json({ ok: true, claimed });
});
