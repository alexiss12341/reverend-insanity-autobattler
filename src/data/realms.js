// Cultivation realms, faithful to Reverend Insanity's ladder, with the canonical
// rank 5 -> rank 6 pivot:
//
//   MORTAL  (Gu Master, ranks 1-5): realm index 0..19 = rank*4 + stage.
//           Four stages each (Initial/Middle/Upper/Peak). Advanced by cultivation XP.
//   IMMORTAL (Gu Immortal, ranks 6-9): realm index 20..23, ONE big realm per rank, NO stages.
//           Advanced by surviving TRIBULATIONS, not XP (see systems/tribulation.js).
//   Rank 9 (realm 23) IS the Venerable rank — Immortal Venerable, or Demon Venerable on the
//           demonic path. Reaching it requires the four Venerable conditions (the capstone).
export const RANK_NAMES = ['Rank 1', 'Rank 2', 'Rank 3', 'Rank 4', 'Rank 5', 'Rank 6', 'Rank 7', 'Rank 8', 'Rank 9'];
export const STAGES = ['Initial', 'Middle', 'Upper', 'Peak'];

export const MORTAL_PEAK = 19;  // Rank 5 Peak — the ceiling of mortal (XP) cultivation
export const IMMORTAL_START = 20; // Rank 6 Initial entry (post-ascension)
export const MAX_REALM = 23;    // Rank 9 = Venerable

export const isImmortalRealm = (realm) => realm >= IMMORTAL_START;
// Rank index 0..8 for any realm.
export const rankOf = (realm) => (realm <= MORTAL_PEAK ? Math.floor(realm / 4) : 5 + (realm - IMMORTAL_START));

// ---- Gu equip slots scale with cultivation realm ----
// Every cultivator opens with 3 Gu slots at Rank 1 and gains +1 per BIG realm (rank) up to Rank 5
// (= 7 slots). Growth stops there, so immortal ranks 6-9 stay at the Rank-5 ceiling of 7.
export const GU_SLOTS_BASE = 3;     // Rank 1 starting slots
export const GU_SLOTS_RANK_CAP = 5; // slots stop growing after Rank 5
export const guSlots = (realm) => GU_SLOTS_BASE + Math.min(rankOf(realm) + 1, GU_SLOTS_RANK_CAP) - 1;
// Per-character slot count = realm-derived base + any granted bonus (e.g. prestige Insight on the player).
export const guSlotsOf = (ch) => guSlots(ch ? ch.realm : 0) + ((ch && ch.bonusSlots) || 0);

export function realmName(realm) {
  if (realm >= MAX_REALM) return 'Venerable';
  if (realm <= MORTAL_PEAK) return `${RANK_NAMES[Math.floor(realm / 4)]} ${STAGES[realm % 4]}`;
  return RANK_NAMES[rankOf(realm)]; // immortal ranks have no sub-stage
}

export function realmClass(realm) {
  if (realm >= MAX_REALM) return 'Venerable';
  return realm <= MORTAL_PEAK ? 'Gu Master' : 'Gu Immortal';
}

// Stat multiplier from realm. Smooth mortal curve, then large spikes per immortal rank
// to reflect the gulf between Gu Master and Gu Immortal.
export function realmMult(realm) {
  const r = Math.min(realm, MAX_REALM);
  if (r <= MORTAL_PEAK) return Math.pow(1.15, r);
  const base = Math.pow(1.15, MORTAL_PEAK);
  return base * Math.pow(3, r - MORTAL_PEAK); // rank6 ×3, rank7 ×9, rank8 ×27, rank9 ×81 (over base)
}

// Essence/aperture QUALITY rises each BIG realm (rank): higher-rank primeval essence is denser, so the
// same aperture effectively holds more. A multiplier on the essence pool that steps at each rank
// boundary (not the Initial/Middle/Upper/Peak sub-stages — quality changes per big realm). `rankIdx`
// is 0-based (rank 1 = 0). ESSENCE_QUALITY_PER_RANK is the per-rank growth (tune to taste).
export const ESSENCE_QUALITY_PER_RANK = 1.35;
export const essenceQualityByRank = (rankIdx) => Math.pow(ESSENCE_QUALITY_PER_RANK, Math.max(0, rankIdx | 0));
export const essenceQuality = (realm) => essenceQualityByRank(rankOf(realm));

// (Mortal breakthroughs are no longer XP-driven — they are PURCHASED with Primeval Essence Stones and
//  can fail; see systems/cultivation.js `breakthroughCost` / `breakthroughChance` / `attemptBreakthrough`.)
