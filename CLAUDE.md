# CLAUDE.md

Context for Claude Code working in this repository.

## What this is

A cultivation / martial-arts **autobattler + idle game** heavily inspired by the Xianxia novel
*Reverend Insanity* (Gu cultivation). Graphics are intentionally minimal — the focus is systems.
It runs in the browser as plain ES modules with **no build step and no dependencies**.

## Run it

```bash
npm start        # serves on http://localhost:5173 via a zero-dep static server (server.js)
```

Node 18+ only (uses native ES modules + `node:http`). There is no bundler, no framework, no npm deps.
Open the URL, pick a save slot, play. Saves use the browser's `localStorage` (3 slots).

## Design brief (source of truth for mechanics)

- Autobattler. Player team **max 6**; each enemy team (wave) **max 6**.
- **Formation**: a **2×5 board** per side — 2 rows (Front/Back) × 5 lanes — set in the Team tab's
  drag-and-drop editor (≤5 per row). **Per-lane protection**: a frontliner shields the backliner in
  its *own lane* until it falls; only then can that backliner be targeted. **Column reach**: a unit can
  only strike foes within **±1 of its own lane**, reaching farther only when that window is clear.
  **Enemies target smartly** (60% dig toward the highest-ATK reachable threat's lane, 30% secure kills,
  10% weighted) — players target randomly among reachable valid foes.
- **Most encounters start with a single enemy**; team size grows slowly with floor depth.
- **Wave encounters are rare**: several enemy teams that replace one another as each is wiped.
  A wave roster may exceed 6 total (each individual wave is ≤ 6).
- A floor is **cleared** when every enemy of the encounter (all waves) is defeated → next floor unlocks.
- **450-floor tower**: 9 cultivation realms × 50 floors; **every enemy on a floor is of that band's
  realm** (floors 1–50 = rank 1 … 401–450 = rank 9). Within a band the enemy **SUB-REALM steps**
  Initial→Middle→Upper→Peak across the 50 floors (the gate floor is always Peak; immortal ranks are
  single-stage), and a **band-capped RARITY** ramps from the previous band's cap up to this band's own —
  rank 1 Common · 2 Uncommon · 3 Rare · 4 Epic · 5 Legendary · 6+ Immortal — only a *few* of the new
  rarity at the opening, building to **all** of it at the gate. So difficulty ramps within a realm and
  jumps at each boundary (the mortal→immortal wall is floor 251). **Boss every 10th floor** (10 … 450);
  bosses field the band's top rarity + a full Gu loadout and give more rewards.
- **Idle**: the team auto-farms a chosen **cleared** floor; each background run takes as long as the
  team actually needs to clear it (paced by the fight's simulated duration, **not** a fixed tick). If
  stuck on the frontier, farm a lower floor to grind, then return. Offline progress is estimated on load.
- **Three currencies**:
  - **Primeval Essence Stones (石)** — buys crafting resources (the **Market** stocks every floor-droppable resource you've *unlocked*: gated by **cleared floors** — you must have beaten the floor a resource drops from — AND your **roster's highest rank** — a resource's rarity tier must be ≤ that rank, e.g. a rank-3 roster gets no tier-4/Epic resources; price climbs steeply per tier, `economy.js resourceCost/marketUnlocked/shopResources`) and funds Gu crafting. (Equipment/weapons/armor were removed for now.) Internally the state field + recipe cost key are `stones` (renamed from `gold`; `state.js migrateSave` carries old saves over), the loot effect kind is `stone_find`, and the top-bar element id is `t-stones`. The brass accent *colour* used for crit popups, win text and the stones readout is the `--stone` CSS variable (`#c79a45`) + its `.stone` style class — it's a colour, not the currency, but shares the name now.
  - **Immortal Essence (✦)** — funds gacha recruitment and ascension. Earned as a lump on the **first
    clear** of a floor (bosses far more), plus a small renewable **trickle from farming any cleared
    floor** (so recruiting a bigger team isn't gated behind progression). Crafting no longer uses it.
  - **Immortal Essence Stones (仙石)** — the **fuel that powers IMMORTAL-rank Gu** (tier 6+). State field
    `immortalStones`; top-bar id `t-imm-stones` (hidden until unlocked); colour `--immstone` (`#a874d8`) +
    `.immstone`. **LOCKED until immortal Rank 6** — `state.js immortalUnlocked()` (any roster cultivator at
    realm ≥ `IMMORTAL_START`) gates BOTH the top-bar readout AND the faucet, so floors grant none while the
    roster is mortal. **Faucet**: a renewable per-clear yield (`economy.js rollImmortalStones`, floor-scaled,
    ×boss + Fortune/Luck/prestige). **Sink/gate**: an immortal Gu is **inert** whenever the pool is empty —
    `cultivation.js effectiveStats` skips any equipped tier-6+ Gu (no effects, essence, or resonance) when
    `S().immortalStones ≤ 0`, so it adds nothing in battle. Each clear also burns
    `economy.js immortalGuUpkeep()` (`IMM_STONE_UPKEEP_PER_GU` × the active team's immortal-Gu count) — netted
    in `main.js distributeRewards` (live) + `applyOffline` (offline). Mortal Gu (tier 1-5) are unaffected;
    enemy immortal Gu are built in `floors.js` (not via `effectiveStats`) so they never read this pool. A
    **one-time `state.js migrateSave` purge** (guarded by `immGuPurged`, born-true in `newGame`) wipes every
    immortal Gu a pre-currency save held — equipped or in inventory — releasing their unique claims and
    scrubbing killer-move references, and pays a flat **2250 ✦ Immortal Essence** in compensation.
- **Gu**: each does exactly ONE thing; only its magnitude scales with tier (1–10). Stat-Gu (atk/def/hp)
  grant a **% of the wielder's attribute base** (so they stay relevant at depth); spd-Gu stay flat.
  Tiers 1–5 common; **tiers 6–10 are unique** (one copy per world, ever).
  **Every Gu is crafted from a recipe** (primeval stones + resources; **no essence**). Recipes are **generated**
  (`gu.js recipeFor`): the **primary material is the Gu's OWN Dao path's signature resource** (rarity
  scales with tier — common Gu T1–5 use the path's Uncommon resources, unique T6–10 the deeper
  Rare→Immortal ones) plus a small **universal binder**; stones = tier base × the path's commonality cost
  mult **× the Gu's budget ratio** (`bp / budgetOf(tier)`, mirroring `essenceCost` — a drawback inflates
  `bp`, so negative-stat Gu cost MORE stones; pure Gu = ratio 1). **GU TAGS** drive refinement: a Gu's
  tags are its **positive effect kinds** (+ a generic `status` tag if it inflicts one — `gu.js guTags`).
  Tier 2+ recipes consume **same-path Gu exactly ONE TIER LOWER** as refinement fodder, and that fodder
  must **cover the output Gu's tags**: every consumed fodder carries ≥1 of the output's tags (no off-tag
  filler), their union covers ALL of them, and ≥2 are spent (e.g. a `[ATK, SPD]` T5 needs one ATK + one
  SPD T4 of that path; a `[ATK]` Gu needs two ATK-carrying T4s — `crafting.js selectFodder/refineSpec`,
  never a unique tier 6+). Paths whose tier-directly-below doesn't exist craft from materials alone. There
  is **no separate "fusion" mechanic** (removed).
- **Resources**: universal materials **and** path-bound resources (one set per Dao Path × rarity tier,
  carrying a `daoPath`) all **drop from floors**, spread across the 450-floor tower by tier — each path's
  resources occupy their own floor window, **anchored to the path's craft-gate floor** so a path's basic
  materials drop once its Gu unlock. Path resources are the **crafting materials for that path's Gu**
  (see above). (A future Holy Land may additionally cultivate them at sites.)
- **Six rarity tiers** shared by NPCs and items/resources:
  Common, Uncommon, Rare, Epic, Legendary, Immortal — used by gacha and loot.
- **Cultivation** (Reverend Insanity ladder): Ranks 1–9 × {Initial, Middle, Upper, Peak}, then Venerable.
  **Mortal breakthroughs (ranks 1–5) are PURCHASED, not XP-driven**: combat grants only comprehension +
  resources (no XP), and a cultivator advances one realm step by spending **Primeval Essence Stones (石)**
  on a **fallible** breakthrough (`systems/cultivation.js` `breakthroughCost`/`breakthroughChance`/
  `attemptBreakthrough`). Cost is anchored to the attribute points the step grants (so big-realm boundary
  crossings cost ~8× a sub-stage). **Success chance = 70% from APTITUDE + 30% from highest dao COMPREHENSION
  level**, each a gradient up to a per-small-realm-ramping target: `aptThreshold(realm)=(9+realm)/16`
  (boundaries 0.75/1.00/1.25/1.50) and `compTarget = comprehensionCap(realm)×(substage+1)/4` (the rank's
  comp cap at the boundary) — so 100% needs aptitude ≥ threshold AND a rank-capped comprehension; clamped
  [0,1]. **Big-realm boundary crossings are FLOOR-GATED** (`breakthroughFloorReq`): rank 2 ← clear Floor 50,
  rank 3 ← 100, rank 4 ← 150, rank 5 ← 200 (sub-realm steps ungated). **Failure** spends the stones only — **no injury, no Dao Wound**
  at any step (sub-realm or big-realm boundary); breakthrough RNG can never harm a cultivator, so you just
  re-attempt once you can afford it. (The old temporary-injury debuff was retired; `injuryUntil`/
  `injuryMult`/`isInjured` remain in the code but are now inert.) Realm multiplies all stats. **Aptitude**
  does NOT affect cultivation speed; it sets **aperture capacity** — the % of the essence pool a
  cultivator can fill (`apertureCapacity = min(1, aptitude/2.5)` in `attributes.js`; 2.5 = 100% =
  Extreme; grades A 80–99 · B 60–79 · C 40–59 · D 20–39); it also scales essence **regen** (same shape
  at half the harshness — `apertureRegenFactor = (1+capacity)/2`). Aptitude additionally drives
  **breakthrough success** (the 70% portion, above) AND **scales attribute-point gains**: each mortal
  breakthrough grants its base points PLUS `floor(base × max(0,aptitude−aptThreshold(realm))/aptThreshold)`
  for aptitude over that step's threshold (`aptitudeStepBonus`/`aptitudePointBonus` fold into `playerPool`),
  so a high-aptitude cultivator banks far more attributes from the same realms (no penalty below threshold). The pool itself = **INT base
  (`40+INT×4`) × essence QUALITY (`essenceQuality`, ×`ESSENCE_QUALITY_PER_RANK` per big realm/rank, in
  `realms.js`) × capacity** — so INT and each rank grow the aperture, aptitude caps the usable fraction. **Essence GATES combat** (`battle.js`
  `channelFactor`): each action channels the Gu loadout's essence cost — each Gu's base tier cost
  **rank-adjusted** (`guEssenceCostFor`: ×0.75 per rank the wielder is ABOVE the Gu's tier, ×1.5 per
  rank the Gu is ABOVE the wielder), so over-reaching with a high Gu at a low realm is costly while a
  veteran channels low Gu near-free. If the aperture can't cover the total the channel factor drops
  toward a 0.4 floor — but that factor only saps the **Gu-ADDED** attack, NOT the unaided base swing
  (`battle.js effAtk` floors at `atkBase`, the atk minus its Gu atk%; `effectiveStats`/`enemyUnit` both
  expose it). So a starved loadout merely under-delivers its bonus — **equipping Gu can never make a unit
  hit softer than bare-handed**; aperture capacity just caps how much EXTRA a heavy loadout delivers.
  (The Phase-4 essence *economy* beyond this is still deferred.)
- **Dao paths — two per-path stats** (`systems/dao.js`): **Comprehension** (0–10, grown by fighting with
  that path's Gu, hard-capped by rank) scales each Gu vs its tier — under-comprehension penalises, over
  rewards; level 10 is a Venerable prerequisite. **Dao Marks** (immortal-only, gained by passing
  tribulations) amplify a path's Gu by `1 + marks/1000`.
- **Onboarding / new player** (three pieces, all gated to genuine newcomers via `state.onboarding =
  {active,dismissed,tipsSeen}`; `newGame` sets `active:true`, `migrateSave` marks pre-existing saves
  `active:false` so veterans see nothing):
  1. **New-game starter choice** — after naming, a **Dao path** picker (the common paths, `floorReq≤50`),
     then a **rank-1 Gu** picker of that path, then an **archetype** picker. The chosen path becomes the
     player's **Dao Affinity** (`player.affinity=[path]`), the chosen Gu is granted into `guInv`
     **UNEQUIPPED** (the First-Steps "Equip your starter Gu" step teaches slotting it), and the chosen
     **archetype LINE** is stamped onto the player (`player.line`, applied at the player's Epic rarity —
     see `data/traits.js`). The path card previews what the path excels at + its **signature immortal Gu**
     (`gu.js signatureImmortalGu` = `gu_{path}_sig_quad`); each **archetype card shows the line's full
     rarity ladder** (Common→Immortal effects) with the granted Epic tier highlighted (`ui.js
     starterArchetypePicker`, fed by `traits.js LINE_ORDER`/`lineTierEffects`/`lineCjk`/`lineBlurb`).
  2. **First-Steps floating widget** — a dismissible bottom-right checklist (6 state-derived steps:
     allocate → equip starter Gu → clear F1 → recruit → refine → breakthrough) in its own `#onboard-host`
     div (outside `#content`, so tab re-renders don't clobber it). Re-openable any time via the **Guide**.
  3. **First-visit tab tips** — a one-time `toast(...,'tip')` the first time each tab is opened.
  The **Codex tab is the beginner's manual** (nav label "典 Guide"): a sectioned how-to covering
  attributes, big/small realms, breakthroughs, aptitude/aperture, Gu, refining, dao paths, the Market,
  and combat/idle. See `onboarding-system.md` memory.

## Architecture / file map

```
index.html            # shell: title screen, top bar, nav (incl. "典 Guide" = Codex), #toast-host +
                      #   #onboard-host (First-Steps widget lives here, outside #content), mounts src/main.js
styles.css            # editorial "character design sheet" theme — blood/bone palette, film grain +
                      #   vignette overlays, Cormorant Garamond / Noto Serif SC / Space Mono; tier colors --t1..--t10
server.js             # zero-dependency static dev server (npm start)
src/
  state.js            # the single mutable state object + new-game factory + localStorage saves.
                      #   newGame(slot,name,starter): starter={path,guId,line} sets player.affinity + grants the
                      #   starter Gu UNEQUIPPED + stamps player.line; also seeds state.onboarding. migrateSave marks old saves onboarded.
  main.js             # ORCHESTRATOR: boot/title, self-paced idle loop, floor-running, rewards, global `G` API.
                      #   New-game flow is a modal chain (pendingNew): startNew→starterName→starterPath→
                      #   starterBack→starterGu→starterArchetype (+starterArchetypeBack). Onboarding: G.dismissOnboard / G.startOnboarding (re-arm on any save).
  ui.js               # all rendering (tabs, animated arena via playTimeline(), inventory, feed, modal, toast). Reads state, no logic.
                      #   ONBOARDING: ONBOARD_STEPS + renderOnboard() (the #onboard-host widget) + TAB_TIPS +
                      #   maybeShowTip(tab); both hooked at the end of render(). Starter pickers
                      #   starterPathPicker()/starterGuPicker()/starterArchetypePicker() (the last shows each
                      #   line's full rarity ladder, granted Epic tier highlighted). viewCodex() is the beginner GUIDE (TOC + sections).
                      #   DESIGN HELPERS: pagehead(cjk,eyebrow,title,sub) per tab + secHead(n,title,meta) (CJK
                      #   numerals 零壹貳…) for in-page sections. viewCharacter(id) is the HERO per-character
                      #   SHEET (identity seal, vitals, attribute board, combat grid, cultivation/dao spec rows,
                      #   Gu loadout cards) — a 'char' PSEUDO-TAB opened via G.openChar → UI.openCharSheet(id)
                      #   (no nav button highlights). Team-tab member cards are clickable summaries that open it;
                      #   attribute allocation + Gu equipping live on the sheet (their G handlers re-render the
                      #   ACTIVE view, e.g. UI.render(activeTab), not a hardcoded 'team'/'dao').
  data/               # pure data + generators (no state mutation)
    attributes.js     # STAT CORE (Phase 1 overhaul): 5 attributes (str/agi/con/int/luck) → derived
                      #   stats. NO realm multiplier — all power is in realm-granted attribute POINTS.
                      #   deriveStats(attrs): raw stats LINEAR, % stats diminishing toward a cap via an
                      #   ABSOLUTE half-saturation constant STAT_K (=40). NOT realm-relative — the old
                      #   B=pool/5 model was ABOLISHED (it perversely made deeper cultivators scale WORSE:
                      #   a 200-AGI immortal slower than a 30-AGI rank-1). Every % stat (spd/crit/evasion/
                      #   hit/potency/resist/...) is now monotonic in its raw attribute, realm-independent.
                      #   Shared by cultivation.js (allies) + floors.js (enemies via ROLE_WEIGHTS).
    status.js         # 9 battle statuses (Phase 3): registry (base%/duration/magnitude rule) + thematic
                      #   path→status map (fire→Burn, ice→Frozen, …) + statusForPath. Gu inflict via path.
                      #   DoTs (Burn/Poison/Bleed) = fixed 2-action, UNCAPPED independent instances (each
                      #   application its own timer+damage; per-tick = sum of live instances, stored as arrays).
                      #   A status Gu's inflict CHANCE + base DoT DAMAGE (base burn/poison/bleed) are AUTHORED
                      #   per-Gu on gu.effect.chance/.dmg (data/gu.js, tier-scaled defaults) — read directly,
                      #   no runtime tier math; each status Gu rolls its OWN status per hit.
                      #   control debuffs (Slow/Weaken/Sunder/Frail) last 1–2 actions by INFLICTING GU's
                      #   tier (statusDuration, STATUS_DUR_TIER); Stun/Frozen always 1. Frozen = skip-CC
                      #   (Stun+5%), dispelledByFire flag → fire/Burn shatters it.
    rarities.js       # 6 rarity tiers + NPC stat templates (legacy `base`; rarity now = attribute floor + bonus pool)
    realms.js         # cultivation realm names, multiplier, xp curve
    gu.js             # Gu library: tier, single effect, daoPath tag, uniqueness (~244 Gu; every common &
                      #   mainstream path has 2-3 per tier 1-5). guTags(gu) = positive effect kinds (+ generic
                      #   `status`) — the keywords refinement must cover. Recipes GENERATED by
                      #   recipeFor(path,tier,bp): path's OWN signature resource (primary) + universal binder;
                      #   stones scale by bp/budgetOf(tier) (drawbacks cost more). Onboarding helpers:
                      #   starterGusForPath(path) (curated T1 picker list) + signatureImmortalGu(path).
    daoPaths.js       # ~50 Dao Path registry: category + commonality (drives crafting floor-gate,
                      #   cost, loot weight) + a single-glyph `cjk` accent per path (pathCjk(id), used as
                      #   UI seals/labels). Three Supreme paths catalogued but LOCKED.
    resources.js      # universal + generated path-bound resources (daoPath), all floor-dropped & spread across the 450 floors by tier; resourcesForFloor / resourcesForPath
    combos.js         # KILLER MOVES skeleton (player-authored special moves, headless-safe). A move is
                      #   ASSEMBLED, never enumerated: assemble(archetypeId, coreGu, supportGu) → spec{name,cjk,ops}.
                      #   EQUIP = 1 CORE Gu whose effect DOMAIN == the archetype's favored domain + 2+ SUPPORT Gu all of the
                      #   CORE's Dao path (validateKiller). 27 ARCHETYPES (ARCHETYPE_ORDER) each = favored DOMAIN + delivery +
                      #   op template; path flavors name+status. DOMAINS are combos-local (KM_TAG_DOMAIN, DECOUPLED from gu.js
                      #   TAG_SLOT): offense=atk/crit/critDmg/hit/armorPen/LIFESTEAL · guard=def/critRes/statusRes/thorns ·
                      #   motion=spd/evasion · mystic=potency/status/lucky · VIGOR=hp/regen/essPool/essRcv (guInDomain/guDomains).
                      #   FAVORABILITY (synergy) = purity of the same-path support toward the favored domain (0.6→1.0). mult =
                      #   DELIVERY_MULT(single 3.0≫reach 1.0≫all 0.7 per target) × depthFactor(set count) × tierFactor × favorability.
                      #   OP DSL: damage(mult/hits/exec/perStatus)·status(from:set,stacks)·heal·cleanse·buff(atk/def/spd/thorns/
                      #   evasion)·shield·taunt·essence(signed: + restore allies / − drain foes). autoConfigure(loadout)={core,
                      #   support,archetype} (enemies + player "Suggest"). KILLER_COST_MULT, KILLER_COOLDOWN(=3); describeOps/
                      #   synergyLabel/nearestCore/archetypeDomain for UI.
    npcs.js           # gacha recruit roster: NAMED_HEROES = canon Reverend Insanity characters keyed by all 6
                      #   rarities, each tiered by PEAK cultivation rank (Immortal=Venerable/rank9 … Common=rank1/
                      #   mortal). nameForRarity(rarity) picks within the rolled tier (dupes allowed). Fang Yuan is
                      #   the PLAYER, never a recruit. Recruit start realm is fixed by rarity in rarities.js
                      #   NPC_TEMPLATES.startRealm — Immortal tops at Rank 3 Initial (realm 8), −2 small realms
                      #   per rarity down (Leg 6 · Epic 4 · Rare 2), and Common/Uncommon/Rare are 3 distinct rank-1
                      #   stages (0/1/2). See memory recruit-roster-system.md.
    floors.js         # 9 realms × 50 = 450-floor tower; deterministic encounter/wave/boss gen. Enemies mix
                      #   spirit BEASTS + CULTIVATORS, built with FULL PARITY to allies: enemyUnit gives each foe the
                      #   SAME baseAttr(rarity) per-attr FLOOR + the real rank-1→realm point pool (enemyPool =
                      #   poolAtIndex(realmIdx) + rarityBonus + aptitudePointBonus), distributed by ROLE (tank/bruiser/
                      #   skirmisher/striker), then the SAME deriveStats allies use — a player & enemy of matched realm/
                      #   rarity/build derive identical stats. Cultivators wield a floor-themed Gu loadout, beasts a few
                      #   wild Gu (enemyGuLoadout/floorThemePaths) + comp/marks. SUB-REALM: floorRealmIndex STEPS the foe's
                      #   realm Initial→Middle→Upper→Peak across the band (stored as `realm`, shown in the arena tooltip;
                      #   gate floor = Peak; immortal ranks single-stage) — so its pool reflects e.g. a true Rank 2 Middle.
                      #   RARITY (enemyRarity) is BAND-CAPPED: cap = rank (1 Common · 2 Uncommon · 3 Rare · 4 Epic ·
                      #   5 Legendary · 6+ Immortal); within a band it ramps from the previous cap to this cap (pTop =
                      #   0.12 + 0.9·within) — a few at the opening → ALL at the gate; bosses take the cap. Rarity → aptitude
                      #   + trait TIER + the attribute floor/pool. Each floor draws a coherent SQUAD theme (SQUADS: role→
                      #   line + optional team AURA via applyEnemyAura) — the per-floor gimmick. That role→LINE ALSO
                      #   picks each rank-3+ cultivator's KILLER MOVE archetype (LINE_KILLER: wall→guard · vanguard/slayer/
                      #   assassin/reaver→offense · tempest→motion · afflictor→mystic), and steers its loadout to field a
                      #   matching-domain CORE (enemyGuLoadout coreDomain) so the move fits BOTH its archetype AND its Dao
                      #   path (path = name/status flavor); lineKillerConfig builds it, generic autoConfigure is the fallback.
                      #   DIFFICULTY = a multiplier on
                      #   the INVESTED pool only (never the rarity floor): within-band SAWTOOTH difficultyMult = DIFF_START
                      #   0.5 → DIFF_END 2.0 (UNIFORM across all ranks; old EARLY_POWER removed) × ×BOSS_POOL_MULT 1.35 for
                      #   bosses — so vs an equal player a band runs ×0.5 (gentle opening) → ~×2.66 at the gate boss; Gu +
                      #   same-path resonance are the player's margin. Knobs: DIFF_START/DIFF_END/BOSS_POOL_MULT at top of floors.js.
                      #   placeWave = deliberate, role-aware formation templates (FORMS); floorRealm/MAX_FLOORS
  systems/            # game logic; import `state`, mutate via functions
    cultivation.js    # effectiveStats(char)=attr-base×(Gu% ×comprehension×resonance×markAmp)×prestige−wounds−injury; breakthroughCost/Chance + attemptBreakthrough (mortal, stone-purchased & fallible)
    battle.js         # resolveEncounter(enc,onLog,{record}): ATB movement-gauge auto-battle; record:true
                      #   emits an animatable timeline (steps: dt + gauge snaps + acts); returns simTime
                      #   for idle pacing (fightWallMs/PLAYBACK_MS). Enemies carry effects + comp/marks.
                      #   KILLER MOVES: dealHit (shared per-hit math, factored from takeAction) + executeKillerMove (generic
                      #   op interpreter: damage(exec/perStatus)/status/heal/cleanse/buff/shield/taunt/essence — all 27 archetypes). u.killer fires
                      #   when ess≥u.comboCost (SURPLUS-ONLY, on top of channeling) AND u.killerCd≤0 → spends comboCost,
                      #   applyTopTier (full power, no channel), cooldown=KILLER_COOLDOWN. damageUnit routes ALL damage through
                      #   u.shield (temp HP, no decay, stacks, soaks DoTs too; statuses still land). Timed buff_*/taunt_t live
                      #   in u.statuses (positive mirror of slow/weaken; effAtk/effSpd/effDef + the hit-roll evasion add them).
                      #   serializeAct carries combo{name,cjk}+hits[] + shield in hp snaps; statusSnap tags buffs (b:1+mag).
                      #   attachKiller (allies, from ch.killer={core,support,archetype}) / floors.js lineKillerConfig→autoConfigure (enemies, archetype by trait LINE) build u.killer.
    dao.js            # Comprehension (use-driven, rank-capped, tier-vs-level mult) + Dao Marks (tribulation-driven, 1+marks/1000 amp), aperture caps, attainment tiers (labels/gates), resonance
    tribulation.js    # ascension, tribulations (solo trials, tier-scaled mark gains), Dao Wounds/death, Venerable capstone (needs Comp 10 + Supreme attainment)
    gacha.js          # pull(n): rarity roll + recruit; PITY system; dismiss() recruit → essence refund
    crafting.js       # canCraft/craft(): recipes (stones+resources, no essence); refines from spare same-path Gu EXACTLY one tier lower whose TAGS cover the output's (selectFodder = tag set-cover, ≥2, all on-tag; refineSpec/refineApplies for UI); unique enforcement; path floor-gate
    fusion.js         # REMOVED — empty stub; higher-tier Gu come only from crafting now
    economy.js        # floor rewards, first-clear essence + renewable farmEssence trickle, stone Market (shopResources/marketUnlocked: gated by cleared floors + roster rank; resourceCost by rarity tier)
    prestige.js       # reincarnation: Sovereign Souls + permanent boons (Might/Fortune/Insight)
tests/                # headless suites (npm test → tests/run.mjs): core, formation, immortal, features
```

### Data flow

`main.js` runs the loop and event handlers → calls `systems/*` (which mutate `state.current`)
→ calls `ui.render(tab)` to repaint from state → `state.save()` persists. UI never holds game logic;
it only reads state and calls `window.G.*`. Keep that separation when extending.

### Conventions

- `S()` returns the live state object (`state.current`). `uid(prefix)` mints ids.
- A character's realm is a single integer index (see `data/realms.js`): 0..19 are the mortal stages
  (ranks 1-5 × Initial/Middle/Upper/Peak, advanced by stone-purchased breakthroughs); 20..23 are immortal ranks 6-9 (no sub-stages,
  tribulation-driven). `MORTAL_PEAK`=19, `IMMORTAL_START`=20, `MAX_REALM`=23 (=Venerable). `rankOf()`
  returns a 0-based rank index (5..8 for ranks 6..9), so tribulation tiers use `rankOf(realm)+1`.
- Gu effect `kind`s consumed by the battle engine: `atk, def, hp, spd` (stat) and
  `lifesteal, crit, dodge, thorns, burn, regen, extra_turn, stone_find` (effect bundle). Add new kinds in
  BOTH `systems/cultivation.js` (effectiveStats) and `systems/battle.js`. A Gu may also carry an
  attainment-gated dormant `effect2 = { kind, value, atRank }` (applied by `effectiveStats` once the
  wielder is immortal and has reached that attainment rank in the Gu's path; see `gu.js` `dormant()`).
- `effectiveStats` layers: **attribute-derived base** (5 attrs → `deriveStats`, NO realm mult), then Gu
  effects × comprehension(level-vs-tier) × resonance(same-path count) × markAmp(immortal, `1+marks/1000`),
  then × Dao-Wound penalty × prestige Might. (Equipment was removed for now — `equip`/`equipment` state
  fields remain inert for easy restore.) **Stat-Gu (atk/def/hp) scale as a PERCENTAGE
  of the attribute base** (`STAT_PCT`/`BURN_PCT`/`REGEN_PCT` tables in `gu.js`) so they stay relevant at
  any floor — a flat "+55 ATK" would vanish against attribute-scaled deep stats. **SPD-Gu stay flat**
  (base SPD is bounded); Burn scales off caster ATK, Regen off Max HP. Mark amp on % bonuses is capped
  (`STAT_MULT_CAP`) to prevent runaway; it (and SPD/burn/regen) skip mark amp. Economy gains run through
  `prestigeGainMult()`. Keep all combat scaling inside `effectiveStats` so battle stays a pure consumer.
  **Comprehension** is earned +1 per combat action per equipped path-Gu, banked in `main.js
  commitComprehension` after each fight (battle stays pure).
- New event handlers must be added to the `G` object in `main.js` and called via `onclick="G.x()"`.
- Battle engine (`systems/battle.js`): combatants act on a **movement gauge** that fills at their SPD;
  reaching `THRESHOLD` (1000) triggers an action and resets the gauge to 0 — actions always cost the
  full gauge (no overflow), so SPD = action frequency. Formation is a **2×5 board** per side (rows
  front/back × 5 lanes); each combatant carries `row` + `lane`. **Per-lane protection** (`targetList`):
  a front unit is always targetable; a back unit only when its lane has no living front unit. On top
  of that, `chooseTarget` enforces **column reach**: a unit only strikes foes within ±1 of its own
  lane, expanding beyond that only when the window holds no valid target. Players pick at random among
  the reachable valid foes; **enemies use a targeting brain** (`chooseTarget`, roll 1-100):
  60% attack the valid unit in the highest-ATK foe's lane (digging through its shield), 30% secure a
  kill (lowest HP), 10% threat-weighted random — recomputed every action. Player tiles come from the
  Team tab's drag editor (`G.placeAt`/`dropTile`/`benchChar`, repaired by `normalizeFormation`);
  enemies are auto-placed by `floors.js placeWave`. Turn order is purely gauge-driven, unrelated to
  formation. With `{record:true}`, `resolveEncounter` emits a step **timeline** (gauge snaps + actions
  + each unit's row/lane, each step carrying its `dt`) that `ui.playTimeline` animates on **two facing
  grids**, plus a `simTime`; the **self-paced idle loop** schedules each farm run after
  `fightWallMs(simTime)` (shared `PLAYBACK_MS`), so clear speed = the team's real speed.
- No external libraries. No build tooling. Keep it dependency-free.
- Dao Paths (`data/daoPaths.js`): every Gu has a `daoPath`. Each path has a `category` (lore) and a
  `commonality` (`common`/`uncommon`/`rare`/`esoteric`/`supreme`) which is the mechanical axis. Its
  `floorReq` is **realm-boundary-aligned** — common F1, **uncommon F51, rare F101, esoteric F201** — and
  gates THREE things in lockstep: (1) crafting that path's Gu (`crafting.js`), (2) where its signature
  resources drop (`resources.js` anchors each path's tier ladder to `floorReq` and spreads deeper), and
  (3) which paths enemy Gu loadouts may use (`floors.js enemyGuLoadout` filters by `floorReq <= floor`),
  so floors 1-50 field only common-path Gu, 51+ add uncommon, 101+ rare, 201+ esoteric. Plus a cost
  multiplier and loot weight. The Three Supreme paths (Heaven/Human/Rule) are `supreme` and LOCKED.
  When adding a Gu, give it a valid non-locked `daoPath`.

## Current status

Implemented and working: cultivation + breakthroughs, an **animated** ATB movement-gauge battle (unit
blocks with HP + charge bars, clash + floating-damage popups via `ui.playTimeline`) with flexible
front/back rows (drag-and-drop or buttons, any split), enemies that carry themed combat effects **plus
precoded Comprehension + Dao Marks** scaled to their realm/difficulty, rare multi-wave + boss floors, a
**self-paced idle loop** (each background farm run takes as long as the team needs to clear the floor) +
offline progress, primeval-stone/essence economy with **first-clear essence and a renewable farm-essence trickle**,
resource farming + drops, a stone resource shop (**equipment removed for now**), an **Inventory** tab, ~50 Dao
Paths, ~244 path-tagged Gu (every common & mainstream path stocked 2-3 deep at tiers 1-5), Gu crafting (stones+resources, **no essence**; higher tiers **refined from spare
same-path Gu exactly one tier lower**) with unique enforcement, gacha across 6 rarities with a **pity** system and
**dismiss-for-essence**, the full **immortal tier** (ascension → tribulations → Dao Marks → Dao
Wounds/death → Demon Venerable capstone), the **Dao-path progression** — **Comprehension** (use-driven,
rank-capped, tier-vs-level effectiveness, for everyone) and **Dao Marks** (`1+marks/1000`, immortals) —
plus same-path **resonance**, a **prestige/reincarnation** layer (Sovereign Souls + Might/Fortune/Insight
boons), and 3 saves. **Beginner onboarding**: a new-game **starter choice** (name → Dao path → rank-1 Gu
→ archetype, which sets the player's affinity + archetype line), a **First-Steps checklist widget**, **first-visit tab tips**, and the
**Codex repurposed as a sectioned beginner's guide** ("典 Guide") — re-armable any time via `G.startOnboarding`.

**Pending / deferred (designed, not built):** the **Holy Land** subsystem — immortal-aperture resource
sites that produce path resources and steer the tribulation's path by resource mix; the **704
path/universal resources are already generated** in `resources.js` for it. Also a Phase 2 **tiered
immortal essence** economy (Green Grape → … → Yellow Apricot). The Holy Land needs a grade-roll-at-
ascension rule (still TBD). See the project memory file `dao-path-system.md`.

Tests: `npm test` runs ~292 headless assertions across core, formation, immortal-tier, feature, and killer-move suites.
(The immortal/Venerable suite is RNG-driven and slightly **flaky** — a 1–3 failure count confined to the
tribulation/"became Venerable" assertions is pre-existing noise, not a regression; re-run to confirm. See
`test-suite-flakiness.md` memory.)

Balance (rough): essence + comprehension costs are intentionally large/long-haul; the immortal-tier power
gulf (mark amplification × realm) is deliberately huge. Tuning knobs: `floors.js: enemyUnit` (enemy
scaling + comp/mark bands), `economy.js` (drops, `firstClearEssence`/`farmEssence`), `systems/tribulation.js`
(tribulation tiers + mark gains, wound severity), `systems/dao.js` (`COMP_INCR` cost curve, comp rank caps,
`markAmp`, aperture caps, attainment ladder, resonance), and `PLAYBACK_MS` in `battle.js` (battle/idle pace).

Deliberately thin / good next tasks:
- **Holy Land subsystem** + **Phase 2 tiered essence** (both designed in memory, not built).
- **Three Supreme paths** (Heaven/Human/Rule) are catalogued but LOCKED — a future unlock/quest could open them.
- ~~Gu killer-moves~~ — **BUILT** (player-authored special moves; see `data/combos.js` + the killer-moves
  memory). 27 archetypes across 5 domains; equip = 1 favored-domain CORE + 2+ same-path SUPPORT; favorability
  = support's domain-purity. (Tempest is a pure self-haste — the extra-action/`gauge` idea was cut.)
  **PROGRESSION GATE** (`combos.js KILLER_UNLOCK_FLOOR=100 / KILLER_MIN_RANK=3`): killer moves unlock only
  after the player clears **Floor 100** AND only on **Rank 3+** cultivators — enforced authoritatively in
  `battle.js attachKiller` (allies: both checks; gated → `u.killer` stays undefined) and `floors.js enemyUnit`
  (enemies: rank≥3 only, since the Floor-100 unlock is player-side), mirrored by the UI lock in `ui.js`
  (`killerUnlocked`/`csKiller` lock panel + `killerSummary`). Future polish: per-archetype magnitude/cost
  tuning + richer arena VFX for AoE.
- **Equipment** (weapons/armor) was REMOVED for now (inert `equip`/`equipment` fields remain) — could
  return with affixes/set bonuses. **Boss mechanics/telegraphs**, **drag-reorder within a row**.
  (Enemy formations + full cultivator Gu/gear loadouts are now implemented.)

## Gotchas

- ES modules need to be served over HTTP (hence `server.js`); opening `index.html` from `file://` fails.
- `ui.js` and `main.js` touch the DOM; only `data/*` and `systems/*` are safe to import in headless tests.
- Only `window.G` is exposed for the browser (`window.S` is NOT) — drive/inspect via `G.*` + `localStorage`
  in console/eval, not `S()`.
- **Deleting a save slot doesn't stick if it's still the current game.** `G.deleteSlot(i)` only clears the
  localStorage key; it leaves `state.current` pointing at that game, and the 20s autosave heartbeat
  (`setInterval(save, 20000)` in `main.js` boot) then resurrects the slot. To make a delete stick, switch
  `state.current` to a different slot first (continue/start another), then delete. (For test cleanup,
  prefer leaving the disposable slot, or delete only after loading a different one.)
- Onboarding (widget + tips) only appears when `state.onboarding.active` — fresh new games only. A
  pre-existing/migrated save shows nothing until the player hits **Start First-Steps** in the Guide tab
  (`G.startOnboarding`). When verifying, test on a brand-new game, not a continued legacy save.
