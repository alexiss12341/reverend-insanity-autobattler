# 蛊 · Demon's Ascension

A *Reverend Insanity*-inspired **cultivation autobattler / idle game**. No build step, no dependencies —
just Node 18+ and a browser.

## Play

```bash
npm start
# open http://localhost:5173
```

(`npm start` runs `server.js`, a tiny zero-dependency static server. ES modules can't load from `file://`,
so it must be served over HTTP.)

## What's in it

- **6v6 autobattler** — most fights start with a single enemy; rare **multi-wave** encounters; a **boss every 10th floor**.
- **Idle farming** — your team auto-clears a chosen floor; grind a lower floor when stuck, then push the frontier. Offline gains on reload.
- **Two currencies** — **Primeval Essence Stones 石** (low-tier resources + Gu crafting) and **Immortal Essence ✦** (gacha + ascension, earned from first-clears and bosses).
- **Gu crafting** — every Gu has a recipe; each Gu does one thing that scales with tier (1–10); **tiers 6–10 are unique** (one per world).
- **Gacha recruitment** across six rarities: Common → Uncommon → Rare → Epic → Legendary → Immortal.
- **Cultivation** — Ranks 1–9 (+ Venerable), realms multiply all stats; advance by winning.
- **3 save slots** (localStorage).

## Continue building with Claude Code

This project is set up for [Claude Code](https://docs.claude.com/en/docs/claude-code/overview).

1. Install (Node 18+):
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
   (A native installer is also available; see the docs.)
2. From this folder, start a session:
   ```bash
   cd xianxia-autobattler
   claude
   ```
   First run walks you through sign-in.
3. `CLAUDE.md` in the project root gives Claude Code the full spec, architecture map, conventions, and a
   roadmap of good next tasks, so you can just ask e.g. *"add Gu paths with set bonuses"* or
   *"give enemies Gu effects and rebalance floors 1–30."*

## Project layout

See `CLAUDE.md` for the annotated file map and data-flow notes.
