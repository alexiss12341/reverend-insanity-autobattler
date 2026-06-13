// @ts-nocheck
// Shared helpers for the signed cloud-save Edge Functions (save-put / save-get).
//
// The save is serialized to a `blob` and HMAC'd with a SERVER-ONLY secret (SAVE_HMAC_SECRET, set via
// `supabase secrets set` — it NEVER ships to the browser). So a row edited directly in the database
// (the dashboard, a crafted PostgREST call, anything outside save-put) fails verification on the way back
// out and refuses to load. This is the cloud equivalent of the localStorage signature in state.js, but
// because the secret isn't in the client it's REAL tamper-evidence, not just deterrence.
//
// IMPORTANT — what this does NOT do: it can't stop a player cheating through a MODIFIED CLIENT, because
// save-put will dutifully sign whatever the authenticated owner sends. Stopping that needs server-side
// validation of the save's CONTENTS (plausible currency/realm vs cleared floors, etc.) — a separate layer.
import { CORS, json, callerId } from "./team.ts";
export { CORS, json, callerId };

export const SAVE_SLOTS = 2; // cloud accounts hold up to 2 save slots (mirrors CLOUD_MAX_SAVES in cloud.js)
export const MAX_BLOB = 4_000_000; // ~4 MB hard ceiling on a serialized save (abuse guard)

// HMAC-SHA256(secret, msg) → lowercase hex, via Deno-native Web Crypto.
export async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The signed message binds the blob to its OWNER + SLOT, so a valid (blob,sig) pair can't be lifted onto
// another user_id or moved to a different slot.
export const sigMessage = (userId, slot, blob) => `${userId}:${slot}:${blob}`;

// Length-checked constant-time-ish hex compare (don't leak the sig through early-exit timing).
export function sigEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
