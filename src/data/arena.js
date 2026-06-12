// Arena matchmaking — which opponents a given Elo may challenge. SHARED by the frontend (ui.js gates the
// challenge list) AND the resolve-battle Edge Function (server-side enforcement), so the two never drift.
//
// ASYMMETRIC HYBRID:
//  - an asymmetric Elo BAND — you may punch UP further than you can punch down (climbing is encouraged);
//  - a NEAREST-K fallback — your closest K opponents by rating are ALWAYS challengeable, so a thin/early
//    ladder never leaves you with no one to fight. As the pool fills in around you, the band does the work.
export const ARENA_UP = 300;      // challengeable up to this many Elo ABOVE your rating
export const ARENA_DOWN = 150;    // …and down to this many BELOW your rating (asymmetric)
export const ARENA_NEAREST_K = 8; // fallback: your nearest K opponents by rating are always eligible

// Eligible to challenge when the opponent is inside the asymmetric band, OR among your nearest K by rating.
// `closerCount` = how many OTHER registered teams sit strictly closer to your rating than this opponent.
export function arenaCanChallenge(myPts, oppPts, closerCount) {
  const inBand = oppPts <= myPts + ARENA_UP && oppPts >= myPts - ARENA_DOWN;
  return inBand || closerCount < ARENA_NEAREST_K;
}
