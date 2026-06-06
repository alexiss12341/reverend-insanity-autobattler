// Battle STATUSES — Phase 3 of the stat/combat overhaul (see memory `stat-combat-overhaul.md`).
// Nine debuffs a Gu can inflict on a successful hit. A status-Gu only declares WHICH status (derived
// from its Dao path below) — magnitudes are FORMULAIC (scale off caster/target at apply-time), so no
// per-Gu numbers are stored. The inflict chance at hit-time is clamp[1%,99%]( base + Potency − target
// StatusResist ); duration is counted in the VICTIM's own actions. Pure data — no state, no imports.
//
//  kind semantics consumed by systems/battle.js:
//   - dot 'casterAtk'      → each instance deals mag × caster ATK per victim action
//   - dot 'targetMaxHp'    → each instance deals mag × victim max HP per action (bypasses armor; vs tanks)
//     ALL DoTs (Burn/Poison/Bleed) are UNCAPPED & INDEPENDENT: every application is a SEPARATE instance
//     with its own 2-action timer and its own per-tick damage (locked at apply-time). Instances
//     accumulate (no stack cap) and each expires on its own; per-tick total = sum of that type's live
//     instances (battle.js stores these as an array per DoT type).
//   - debuff 'spd'|'atk'|'def' → the victim's effective stat is ×(1 − mag) while active
//   - debuff 'taken'       → the victim takes ×(1 + mag) damage while active (Frail)
//     Debuffs last dur..durMax actions depending on the INFLICTING GU's tier (see statusDuration).
//   - stun                 → the victim's action is skipped while active (always exactly 1 action)
//   - dispelledByFire       → the status is shattered when the victim is hit by a fire-path move,
//                             damaged by a burn aura, or inflicted with Burn (see Frozen)

export const STATUS = {
  // DoTs: fixed 2-action duration. UNCAPPED & INDEPENDENT — every application is its own instance that
  // ticks (mag × source) and expires on its own timer; instances accumulate with no stack limit.
  burn:   { label: 'Burn',   base: 0.40, dur: 2, dot: 'casterAtk',   mag: 0.30 },
  poison: { label: 'Poison', base: 0.35, dur: 2, dot: 'casterAtk',   mag: 0.12 },
  bleed:  { label: 'Bleed',  base: 0.35, dur: 2, dot: 'targetMaxHp', mag: 0.04 },
  // Control debuffs: duration RANGES dur..durMax with the inflicting Gu's tier (1 action for low-tier
  // Gu, up to durMax for higher-tier ones — see statusDuration). Not stackable; re-applying refreshes.
  slow:   { label: 'Slow',   base: 0.30, dur: 1, durMax: 2, debuff: 'spd',   mag: 0.25 },
  weaken: { label: 'Weaken', base: 0.30, dur: 1, durMax: 2, debuff: 'atk',   mag: 0.25 },
  sunder: { label: 'Sunder', base: 0.30, dur: 1, durMax: 2, debuff: 'def',   mag: 0.25 },
  frail:  { label: 'Frail',  base: 0.25, dur: 1, durMax: 2, debuff: 'taken', mag: 0.25 },
  // Hard CC: always exactly 1 action.
  stun:   { label: 'Stun',   base: 0.20, dur: 1, stun: true },
  // Frozen: a 1-action freeze (skips the next action) that lands 5% more often than Stun, but is
  // SHATTERED early by fire — a fire-path hit, a burn aura, or a Burn status melts it. The fire
  // counter-play is the trade-off for the higher inflict chance.
  frozen: { label: 'Frozen', base: 0.25, dur: 1, stun: true, dispelledByFire: true },
};

export const STATUS_TYPES = Object.keys(STATUS);
export const isStatus = (t) => !!STATUS[t];

// Tier at/above which a variable-duration debuff (Slow/Weaken/Sunder/Frail) lasts its full durMax
// rather than its base dur. So a low-tier control Gu imposes the brief version, a higher-tier one the
// longer version — the duration "depends on the Gu used," not a single fixed value.
export const STATUS_DUR_TIER = 4;

// Duration (in the victim's own actions) a Gu of `tier` imposes for `type`. Fixed-duration statuses
// (DoTs at dur=2, Stun/Frozen at 1) ignore tier; variable ones (durMax set) return dur for low-tier
// Gu and durMax for tier ≥ STATUS_DUR_TIER.
export function statusDuration(type, tier) {
  const def = STATUS[type]; if (!def) return 1;
  if (!def.durMax) return def.dur;
  return (tier || 1) >= STATUS_DUR_TIER ? def.durMax : def.dur;
}

// NOTE: a DoT instance's "base burn / base poison / base bleed" (per-tick damage fraction) and a
// status's inflict CHANCE are NOT derived here — they are authored per-Gu on `gu.effect.dmg` /
// `gu.effect.chance` (data/gu.js) and flow in as the rider's `mag` / `base`. This registry only
// supplies the thematic mapping, durations, and fallback defaults (STATUS[type].base / .mag).

// Dao path → the status its Gu inflict on hit (thematic). Paths absent here inflict nothing — their
// Gu are pure stat/utility. Every one of the nine statuses has at least one thematic home. The frost
// paths split: Ice freezes solid (Frozen), while Snow drifts and impedes (Slow).
export const STATUS_BY_PATH = {
  fire: 'burn',
  poison: 'poison',
  blade: 'bleed', sword: 'bleed', bone: 'bleed',
  ice: 'frozen', snow: 'slow',
  lightning: 'stun',
  shadow: 'weaken', dark: 'weaken',
  metal: 'sunder', earth: 'sunder',
  killing: 'frail', star: 'frail',
};

// The status a Gu of `path` inflicts, as { type, base }, or null.
export function statusForPath(path) {
  const type = STATUS_BY_PATH[path];
  return type ? { type, base: STATUS[type].base } : null;
}
