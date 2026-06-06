// The six shared rarity tiers, used by NPCs, loot, and resources.
export const RARITY_ORDER = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Immortal'];

// Weights sum to 100, so each is its exact %-chance per pull.
export const RARITIES = {
  Common:    { key: 'Common',    tier: 1, weight: 51,   color: '#9aa39a' },
  Uncommon:  { key: 'Uncommon',  tier: 2, weight: 28.5, color: '#74c0a0' },
  Rare:      { key: 'Rare',      tier: 3, weight: 14.3, color: '#5aa7d8' },
  Epic:      { key: 'Epic',      tier: 4, weight: 5,    color: '#b07ad8' },
  Legendary: { key: 'Legendary', tier: 5, weight: 1,    color: '#d8a64a' },
  Immortal:  { key: 'Immortal',  tier: 6, weight: 0.2,  color: '#f5e58a' },
};

// NPC stat templates per rarity (autobattler base stats + cultivation potential).
// (Gu equip slots are no longer set here — they derive from cultivation realm; see data/realms.js guSlots.)
export const NPC_TEMPLATES = {
  // startRealm (realm index): recruits start by rarity and are cultivated up. Immortal tops out at
  // Rank 3 Initial (realm 8); each rarity below steps DOWN 2 small realms (Legendary R2 Upper=6,
  // Epic R2 Initial=4, Rare R1 Upper=2), and Common/Uncommon/Rare are three distinct RANK 1 stages
  // (Common Initial=0, Uncommon Middle=1, Rare Upper=2).
  Common:    { hp: 90,  atk: 16, def: 7,  spd: 10, aptitude: 1.0, startRealm: 0 },
  Uncommon:  { hp: 115, atk: 22, def: 10, spd: 11, aptitude: 1.3, startRealm: 1 },
  Rare:      { hp: 150, atk: 32, def: 13, spd: 13, aptitude: 1.7, startRealm: 2 },
  Epic:      { hp: 200, atk: 46, def: 18, spd: 15, aptitude: 2.2, startRealm: 4 },
  Legendary: { hp: 280, atk: 68, def: 26, spd: 18, aptitude: 2.9, startRealm: 6 },
  Immortal:  { hp: 420, atk: 105,def: 40, spd: 22, aptitude: 3.8, startRealm: 8 },
};

export const rarityColor = (key) => (RARITIES[key] || RARITIES.Common).color;
export const rarityTier  = (key) => (RARITIES[key] || RARITIES.Common).tier;
