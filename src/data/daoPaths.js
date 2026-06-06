// Dao Path registry. ~50 canonical Reverend Insanity paths.
// Each path is an independent domain of the Great Dao (NOT derived from any other path).
//
// Two axes:
//   category    — organizational/lore grouping (five_elements, three_supreme, mainstream,
//                 combat, mental, utility, minor).
//   commonality — the MECHANICAL axis: how common/easy-to-find a path is. Drives the minimum
//                 frontier floor before its Gu can be crafted, a cost multiplier, and loot/gacha
//                 weighting. Common paths are bread-and-butter; esoteric paths are deep-floor only.
//
// The Three Supreme paths (Heaven, Human, Rule) are catalogued but LOCKED — not implemented yet.

// floorReq is anchored to realm boundaries (50 floors each): common from F1, uncommon from F51 (realm 2),
// rare from F101 (realm 3), esoteric from F201 (realm 5). This gates a path's Gu CRAFTING, its resource
// DROPS (resources.js anchors to floorReq), and which paths enemy Gu loadouts can draw on (floors.js).
export const COMMONALITY = {
  common:    { key: 'common',    label: 'Common',    floorReq: 1,   costMult: 1.0, weight: 50,  color: '#9aa39a' },
  uncommon:  { key: 'uncommon',  label: 'Uncommon',  floorReq: 51,  costMult: 1.4, weight: 26,  color: '#74c0a0' },
  rare:      { key: 'rare',      label: 'Rare',      floorReq: 101, costMult: 2.2, weight: 12,  color: '#5aa7d8' },
  esoteric:  { key: 'esoteric',  label: 'Esoteric',  floorReq: 201, costMult: 3.5, weight: 4,   color: '#b07ad8' },
  supreme:   { key: 'supreme',   label: 'Supreme',   floorReq: 999, costMult: 9.0, weight: 0,   color: '#f5e58a', locked: true },
};

// [id, name, category, commonality, blurb]
const RAW = [
  // ---- Five Elements (fundamental, common) ----
  ['metal',     'Metal Path',     'five_elements', 'common',   'Edges, ores, and killing sharpness — a top offensive path.'],
  ['wood',      'Wood Path',      'five_elements', 'common',   'Growth, vines, and verdant vitality; steady regeneration.'],
  ['water',     'Water Path',     'five_elements', 'common',   'Flow, tides, and cleansing currents; healing and erosion.'],
  ['fire',      'Fire Path',      'five_elements', 'common',   'Heat, combustion, ash — one of the great offensive paths.'],
  ['earth',     'Earth Path',     'five_elements', 'common',   'Stone, soil, and immovable defense.'],

  // ---- Three Supreme (locked, catalogued only) ----
  ['heaven',    'Heaven Path',    'three_supreme', 'supreme',  'A supreme, all-encompassing dao of the heavens. (Locked.)'],
  ['human',     'Human Path',     'three_supreme', 'supreme',  'A supreme dao of mankind and civilization. (Locked.)'],
  ['rule',      'Rule Path',      'three_supreme', 'supreme',  'A supreme dao of laws and decrees. (Locked.)'],

  // ---- Mainstream (common to rare) ----
  ['wind',      'Wind Path',      'mainstream',    'common',   'Speed, gusts, and unhindered movement.'],
  ['lightning', 'Lightning Path', 'mainstream',    'common',   'Thunder and arcs — violent, fast, top-tier offense.'],
  ['light',     'Light Path',     'mainstream',    'common',   'Radiance, purity, and restoration.'],
  ['dark',      'Dark Path',      'mainstream',    'common',   'Shadowed force; siphoning and corruption.'],
  ['ice',       'Ice Path',       'mainstream',    'common',   'Cold that slows, hardens, and endures.'],
  ['snow',      'Snow Path',      'mainstream',    'uncommon', 'Drifting cold; evasion and concealment.'],
  ['cloud',     'Cloud Path',     'mainstream',    'uncommon', 'Mists and vapors; mobility and obscurement.'],
  ['star',      'Star Path',      'mainstream',    'uncommon', 'Distant might; precise, far-reaching strikes.'],
  ['moon',      'Moon Path',      'mainstream',    'uncommon', 'Lunar tides; cycles of recovery and reflection.'],
  ['space',     'Space Path',     'mainstream',    'rare',     'Distance folded; teleportation and untouchability.'],
  ['time',      'Time Path',      'mainstream',    'rare',     'The rarest mainstream dao — extra actions and acceleration.'],

  // ---- Combat & Physical (uncommon, Strength/Blood common) ----
  ['sword',     'Sword Path',     'combat',        'uncommon', 'The righteous blade; sharp, disciplined offense.'],
  ['blade',     'Blade Path',     'combat',        'uncommon', 'The brutal saber — favored by demonic cultivators.'],
  ['strength',  'Strength Path',  'combat',        'common',   'Raw physical might and toughness.'],
  ['blood',     'Blood Path',     'combat',        'common',   'Lifeblood as weapon — a top offensive path, demonic-leaning.'],
  ['poison',    'Poison Path',    'combat',        'uncommon', 'Venom, plague, and lingering decay.'],
  ['bone',      'Bone Path',      'combat',        'uncommon', 'Skeletal armor and barbs; durable defense.'],
  ['transformation','Transformation Path','combat','rare',     'Reshaping the body and form; adaptive power.'],

  // ---- Mental, Spirit & Information (rare to esoteric) ----
  ['wisdom',    'Wisdom Path',    'mental',        'uncommon', 'Perception and foresight; act before the foe.'],
  ['soul',      'Soul Path',      'mental',        'rare',     'The spirit itself — devouring and fortifying souls.'],
  ['emotion',   'Emotion Path',   'mental',        'esoteric', 'Feeling weaponized; sway the heart.'],
  ['information','Information Path','mental',       'esoteric', 'Knowledge and secrets; the rarest of advantages.'],
  ['dream',     'Dream Path',     'mental',        'esoteric', 'Dream realms; Gu that exist between sleep and waking.'],

  // ---- Utility, Support & Specialty (rare to esoteric) ----
  ['enslavement','Enslavement Path','utility',     'rare',     'Binding others to your will.'],
  ['refinement','Refinement Path', 'utility',      'uncommon', 'Forging and fortifying; reinforces the cultivator.'],
  ['theft',     'Theft Path',     'utility',       'rare',     'Taking what is not yours — stats, essence, fortune.'],
  ['luck',      'Luck Path',      'utility',       'rare',     'Fortune itself; wealth and improbable outcomes.'],
  ['formation', 'Formation Path', 'utility',       'uncommon', 'Battle arrays; defensive and tactical structure.'],
  ['phantom',   'Phantom Path',   'utility',       'rare',     'Spectral doubles and feints.'],
  ['illusion',  'Illusion Path',  'utility',       'rare',     'False images that misdirect the foe.'],
  ['restriction','Restriction Path','utility',     'rare',     'Bindings and seals that lock down enemies.'],
  ['food',      'Food Path',      'utility',       'esoteric', 'Nourishment and consumption as power.'],

  // ---- Minor, Variant & Secret (rare to esoteric) ----
  ['shadow',    'Shadow Path',    'minor',         'rare',     'The cast shadow; stealth and ambush.'],
  ['sound',     'Sound Path',     'minor',         'rare',     'Resonance and sonic force.'],
  ['killing',   'Killing Path',   'minor',         'esoteric', 'The pure intent to kill, sharpened to a dao.'],
  ['weapon',    'Weapon Path',    'minor',         'esoteric', 'Mastery over arms of every kind.'],
  ['pill',      'Pill Path',      'minor',         'esoteric', 'Alchemical pills and concoctions.'],
  ['painting',  'Painting Path',  'minor',         'esoteric', 'Worlds and weapons drawn into being.'],
  ['enchantment','Enchantment Path','minor',       'esoteric', 'Imbuing and empowering through inscription.'],
  ['qi',        'Qi Path',        'combat',        'common',   'Formless qi marshalled into raw force — a once-declining, now-flourishing path akin to Strength.'],
];

// Single-glyph CJK accent per path (authentic Reverend Insanity dao naming) — used as decorative
// seals/labels in the UI. Distinct glyphs chosen where paths would otherwise collide (phantom 魅 vs
// illusion 幻). Falls back to 蛊 for anything unmapped.
export const PATH_CJK = {
  metal: '金', wood: '木', water: '水', fire: '火', earth: '土',
  heaven: '天', human: '人', rule: '律',
  wind: '风', lightning: '雷', light: '光', dark: '暗', ice: '冰',
  snow: '雪', cloud: '云', star: '星', moon: '月', space: '空', time: '时',
  sword: '剑', blade: '刀', strength: '力', blood: '血', poison: '毒', bone: '骨', transformation: '化',
  wisdom: '智', soul: '魂', emotion: '情', information: '讯', dream: '梦',
  enslavement: '奴', refinement: '炼', theft: '窃', luck: '运', formation: '阵',
  phantom: '魅', illusion: '幻', restriction: '禁', food: '食',
  shadow: '影', sound: '音', killing: '杀', weapon: '兵', pill: '丹', painting: '画',
  enchantment: '符', qi: '气',
};

export const PATHS = {};
for (const [id, name, category, commonality, blurb] of RAW) {
  PATHS[id] = { id, name, category, commonality, blurb, cjk: PATH_CJK[id] || '蛊' };
}

export const pathList = () => Object.values(PATHS);
export const PATH = (id) => PATHS[id] || null;
export const commOf = (id) => COMMONALITY[(PATHS[id] || {}).commonality] || COMMONALITY.common;
export const pathColor = (id) => commOf(id).color;
export const pathName = (id) => (PATHS[id] || { name: id }).name;
export const pathCjk = (id) => (PATHS[id] || {}).cjk || '蛊';
export const pathFloorReq = (id) => commOf(id).floorReq;
export const pathCostMult = (id) => commOf(id).costMult;
export const isPathLocked = (id) => !!commOf(id).locked;

// Grouping helper for UI.
export const CATEGORY_LABELS = {
  five_elements: 'Five Elements', three_supreme: 'Three Supreme', mainstream: 'Mainstream',
  combat: 'Combat & Physical', mental: 'Mental / Spirit / Info', utility: 'Utility & Support', minor: 'Minor & Variant',
};

// ---- Gu-system data (see plan: Gu Types & Effects) -------------------------------------------------
// Per-path SIGNATURE AFFINITY: the effect-kinds this path emphasises. A Gu line whose kind is in its
// path's affinity gets a flat ×1.10 magnitude bonus (data/guBudget.js AFFINITY), and these drive each
// path's multi-effect signature Gu. Effect-kind keys match systems/cultivation.js effectiveStats.
export const PATH_AFFINITY = {
  metal: ['def','atk','armorPen','crit'], wood: ['regen','hp','thorns','def'],
  water: ['regen','evasion','def','atk'], fire: ['atk','crit','critDmg'],
  earth: ['def','hp','thorns','armorPen'],
  wind: ['spd','evasion','hit'], lightning: ['atk','crit','spd','critDmg'], light: ['regen','hp','crit'],
  dark: ['lifesteal','atk','evasion'], ice: ['def','hp','atk'], snow: ['evasion','spd','def'],
  cloud: ['evasion','spd','regen'], star: ['atk','crit','critDmg'], moon: ['regen','hp','evasion'],
  space: ['evasion','spd','essPool'], time: ['spd','essRcv','evasion'],
  sword: ['atk','crit','critDmg','armorPen'], blade: ['atk','crit','lifesteal'],
  strength: ['atk','hp','def','armorPen'], blood: ['atk','lifesteal','hp'],
  poison: ['potency','atk','regen'], bone: ['def','hp','thorns'], transformation: ['atk','hp','def','evasion'],
  wisdom: ['crit','hit','critDmg','spd'], soul: ['potency','lifesteal','statusRes'],
  emotion: ['potency','evasion','critRes'], information: ['hit','crit','potency'], dream: ['potency','evasion','essRcv'],
  enslavement: ['potency','atk','hp'], refinement: ['def','hp','essPool'], theft: ['lifesteal','armorPen','essRcv'],
  luck: ['lucky','crit','evasion'], formation: ['def','hp','thorns'], phantom: ['evasion','spd','critRes'],
  illusion: ['evasion','potency','critRes'], restriction: ['potency','def','thorns'], food: ['hp','regen','lifesteal'],
  shadow: ['evasion','crit','lifesteal'], sound: ['atk','potency','hit'], killing: ['crit','critDmg','armorPen','atk'],
  weapon: ['atk','crit','armorPen','def'], pill: ['regen','hp','essPool','essRcv'], painting: ['atk','def','evasion'],
  enchantment: ['potency','evasion','critRes'], qi: ['atk','hp','def','armorPen'],
};

// Per-path inflictable STATUSES (exactly 2 — primary, secondary). Status keys match data/status.js
// STATUS registry. Replaces the old rigid one-status STATUS_BY_PATH; every path inflicts ≥2 so Potency
// is always useful. Paths absent here (Three Supreme, locked) inflict nothing.
export const PATH_STATUSES = {
  fire: ['burn','frail'], water: ['slow','weaken'], wood: ['poison','slow'], metal: ['bleed','sunder'],
  earth: ['sunder','slow'], wind: ['slow','weaken'], lightning: ['stun','frail'], light: ['frail','weaken'],
  dark: ['weaken','frail'], ice: ['frozen','slow'], snow: ['slow','frozen'], cloud: ['slow','weaken'],
  star: ['frail','stun'], moon: ['weaken','slow'], space: ['stun','slow'], time: ['slow','stun'],
  sword: ['bleed','sunder'], blade: ['bleed','weaken'], strength: ['stun','sunder'], blood: ['bleed','weaken'],
  poison: ['poison','weaken'], bone: ['sunder','bleed'], transformation: ['weaken','frail'],
  wisdom: ['frail','weaken'], soul: ['weaken','frail'], emotion: ['stun','weaken'], information: ['frail','weaken'],
  dream: ['stun','slow'], enslavement: ['stun','weaken'], refinement: ['sunder','weaken'], theft: ['weaken','slow'],
  luck: ['frail','weaken'], formation: ['slow','stun'], phantom: ['weaken','frail'], illusion: ['stun','weaken'],
  restriction: ['stun','slow'], food: ['poison','weaken'], shadow: ['weaken','frail'], sound: ['stun','weaken'],
  killing: ['frail','bleed'], weapon: ['bleed','sunder'], pill: ['poison','weaken'], painting: ['slow','weaken'],
  enchantment: ['weaken','frail'], qi: ['stun','sunder'],
};

export const pathAffinity = (id) => PATH_AFFINITY[id] || [];
export const pathStatuses = (id) => PATH_STATUSES[id] || [];
