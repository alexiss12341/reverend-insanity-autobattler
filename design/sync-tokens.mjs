#!/usr/bin/env node
/* ============================================================================
   sync-tokens.mjs — the single source of truth bridge between the game's CSS
   and the Claude Design "Design System" project.

   The game's authoritative design tokens live in ../theme.css ([data-theme]
   palette blocks) and ../styles.css (:root font families). This script PARSES
   those files — it never hand-copies values — so tokens.json and the upload
   bundle can never silently drift from what the game actually renders.

   Modes:
     node design/sync-tokens.mjs            # CHECK: tokens.json vs the live CSS (exit 1 on drift)
     node design/sync-tokens.mjs --write    # regenerate design/tokens.json from the CSS
     node design/sync-tokens.mjs --bundle   # build design/ds-bundle/ for upload to Claude Design

   No dependencies. Node 18+ (matches the game).
   ========================================================================== */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESIGN_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(DESIGN_DIR, '..');
const THEME_CSS = join(REPO, 'theme.css');
const STYLES_CSS = join(REPO, 'styles.css');
const FONTS_DIR = join(REPO, 'fonts');
const TOKENS_JSON = join(DESIGN_DIR, 'tokens.json');
const BUNDLE = join(DESIGN_DIR, 'ds-bundle');

// ---------- tiny CSS parser: selector -> { --var: value } (custom props only) ----------
function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }
function parseRules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g; // theme.css/:root blocks are flat (no nesting)
  let m;
  while ((m = re.exec(stripComments(css)))) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    const vars = {};
    const vre = /--([\w-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g;
    let v;
    while ((v = vre.exec(m[2]))) vars[`--${v[1]}`] = v[2].trim();
    if (Object.keys(vars).length) out.push({ selector, vars });
  }
  return out;
}

function readCss() {
  const themeRules = parseRules(readFileSync(THEME_CSS, 'utf8'))
    .filter(r => r.selector.startsWith('[data-theme'));
  // collapse duplicate selectors (last wins, mirroring the cascade within one file)
  const cssVars = {};
  for (const r of themeRules) cssVars[r.selector] = { ...(cssVars[r.selector] || {}), ...r.vars };

  // fonts: :root in styles.css
  const fonts = {};
  for (const r of parseRules(readFileSync(STYLES_CSS, 'utf8'))) {
    if (r.selector === ':root') for (const [k, val] of Object.entries(r.vars)) {
      if (['--mono', '--serif', '--cjk', '--brush'].includes(k)) fonts[k] = val;
    }
  }
  return { cssVars, fonts };
}

// ---------- static documentation layers (roles/scale — not parsed, by design) ----------
const FONT_ROLES = {
  '--serif': 'Body & headings (Cormorant Garamond). Default UI text, card bodies, titles.',
  '--mono': 'Eyebrows, labels, stats, buttons, numerals (Space Mono). Always uppercase + wide letter-spacing.',
  '--cjk': 'Chinese display glyphs / seals (Noto Serif SC). Section numerals, logos, big accents.',
  '--brush': 'Calligraphic brush accents (Zhi Mang Xing). Rare flourish, falls back to --cjk.',
};
const TYPE_SCALE = {
  note: 'px sizes the game actually uses; family/transform/tracking are the convention, not just the size.',
  eyebrow: { size: '10.5-11px', family: '--mono', transform: 'uppercase', tracking: '0.3-0.34em', color: '--muted' },
  label:   { size: '9.5px',     family: '--mono', transform: 'uppercase', tracking: '0.22em',     color: '--muted' },
  tiny:    { size: '11.5px',    family: '--serif' },
  small:   { size: '14px',      family: '--serif' },
  body:    { size: '16-18px',   family: '--serif', line: '1.45-1.6', color: '--bone-dim / --bone' },
  statVal: { size: '19px',      family: '--mono',  color: '--bone' },
  secTitle:{ size: '23px',      family: '--serif', transform: 'uppercase', tracking: '0.16em' },
  pageH1:  { size: '38px',      family: '--serif', transform: 'uppercase', tracking: '0.16em' },
  seal:    { size: '42px',      family: '--cjk',   weight: 900 },
  titleH1: { size: '96px',      family: '--cjk',   weight: 900, note: 'save/title screen only' },
};
const SHAPE = {
  radius: '2px on interactive chrome (buttons, pills, tags); 0 on scrollbars; cards & panels are square.',
  border: '1px solid var(--line); hover -> var(--line-strong); strong dividers -> var(--line-strong).',
  panelFill: 'linear-gradient(170deg, var(--bg2), var(--panel)) for cards; (180deg, var(--bg3), var(--panel)) for the topbar.',
  bodyBg: 'two faint radial blood/jade glows over var(--bg), plus a fixed film-grain (SVG noise, ~3.5% overlay) and a vignette.',
};

// ---------- build tokens.json ----------
function buildTokens() {
  const { cssVars, fonts } = readCss();
  return {
    $meta: {
      name: "Demon's Ascension - Design Tokens",
      source: 'Generated from theme.css + styles.css by design/sync-tokens.mjs. Do not hand-edit; run `node design/sync-tokens.mjs --write`.',
      themeAttrs: {
        'data-theme': 'mode-accent, e.g. dark-crimson (default), dark-azure|gold|jade|ink, light-crimson|...',
        'data-paper': 'rice (default) | porcelain - light-mode paper tone only',
        'data-glow': 'off (default) | neon - dark-mode bloom only',
      },
      defaultTheme: 'dark-crimson',
      semanticNote: 'Currency/meaning colors (jade essence, stone/brass, immstone) and the rarity ladder t1-t10 shift only dark<->light, never by accent. The accent only changes the --blood family + backgrounds.',
    },
    fonts: Object.fromEntries(Object.entries(fonts).map(([k, v]) => [k, { value: v, role: FONT_ROLES[k] }])),
    typeScale: TYPE_SCALE,
    shape: SHAPE,
    // authoritative machine mirror of the live CSS, selector -> custom props
    cssVars,
  };
}

// ---------- defaults.css: resolve the default theme onto :root so designs render even with no data-theme ----------
function buildDefaultsCss(cssVars, fonts) {
  const merged = {
    ...fonts,
    ...(cssVars['[data-theme^="dark"]'] || {}),
    ...(cssVars['[data-theme="dark-crimson"]'] || {}),
  };
  const body = Object.entries(merged).map(([k, v]) => `  ${k}:${v};`).join('\n');
  return `/* defaults.css - the default theme (dark-crimson) resolved onto :root.
   Generated by design/sync-tokens.mjs. This is the fallback palette so a design
   renders fully styled even before a [data-theme] is set on an ancestor.
   Set data-theme="dark-azure" (etc.) on a wrapper to switch; themes.css wins. */
:root{
${body}
}
`;
}

// ---------- entry styles.css for the bundle ----------
function buildEntryCss() {
  // self-host the four faces; bundle keeps them under ./fonts/
  return `/* styles.css - Claude Design entry sheet for "Demon's Ascension".
   Rendered designs receive only this file's @import closure, so everything the
   look needs is reachable from here. Generated by design/sync-tokens.mjs --bundle. */

@font-face{font-family:'Cormorant Garamond';font-style:normal;font-weight:400 700;font-display:swap;src:url('fonts/CormorantGaramond-var.woff2') format('woff2')}
@font-face{font-family:'Cormorant Garamond';font-style:italic;font-weight:400 700;font-display:swap;src:url('fonts/CormorantGaramond-Italic-var.woff2') format('woff2')}
@font-face{font-family:'Noto Serif SC';font-style:normal;font-weight:200 900;font-display:swap;src:url('fonts/NotoSerifSC-var.woff2') format('woff2')}
@font-face{font-family:'Space Mono';font-style:normal;font-weight:400;font-display:swap;src:url('fonts/SpaceMono-Regular.woff2') format('woff2')}
@font-face{font-family:'Space Mono';font-style:normal;font-weight:700;font-display:swap;src:url('fonts/SpaceMono-Bold.woff2') format('woff2')}
@font-face{font-family:'Zhi Mang Xing';font-style:normal;font-weight:400;font-display:swap;src:url('fonts/ZhiMangXing-Regular.woff2') format('woff2')}

@import "tokens/defaults.css";   /* :root fallback palette (default theme) */
@import "components/base.css";    /* the game's real component CSS */
@import "tokens/themes.css";      /* [data-theme] palettes - switchable, win over :root */
`;
}

// ---------- base.css: the game's styles.css with its @font-face block removed (bundle re-declares fonts) ----------
function buildBaseCss() {
  let css = readFileSync(STYLES_CSS, 'utf8');
  // drop the leading self-hosted @font-face declarations (bundle's entry owns those, with correct paths)
  css = css.replace(/@font-face\s*\{[^}]*\}\s*/g, '');
  return `/* base.css - the game's component CSS (from styles.css), @font-face stripped.
   Generated by design/sync-tokens.mjs --bundle. Source of truth: ../../styles.css. */
${css}`;
}

function run() {
  const mode = process.argv[2];
  const { cssVars, fonts } = readCss();

  if (mode === '--write') {
    writeFileSync(TOKENS_JSON, JSON.stringify(buildTokens(), null, 2) + '\n');
    console.log(`wrote ${TOKENS_JSON}`);
    console.log(`  ${Object.keys(cssVars).length} theme blocks, ${Object.keys(fonts).length} font families`);
    return;
  }

  if (mode === '--bundle') {
    rmSync(BUNDLE, { recursive: true, force: true });
    mkdirSync(join(BUNDLE, 'tokens'), { recursive: true });
    mkdirSync(join(BUNDLE, 'components'), { recursive: true });
    mkdirSync(join(BUNDLE, 'fonts'), { recursive: true });

    writeFileSync(join(BUNDLE, 'styles.css'), buildEntryCss());
    writeFileSync(join(BUNDLE, 'components', 'base.css'), buildBaseCss());
    writeFileSync(join(BUNDLE, 'tokens', 'themes.css'), readFileSync(THEME_CSS, 'utf8'));
    writeFileSync(join(BUNDLE, 'tokens', 'defaults.css'), buildDefaultsCss(cssVars, fonts));
    writeFileSync(join(BUNDLE, 'tokens', 'tokens.json'), JSON.stringify(buildTokens(), null, 2) + '\n');

    let nf = 0;
    for (const f of readdirSync(FONTS_DIR)) {
      if (f.endsWith('.woff2')) { copyFileSync(join(FONTS_DIR, f), join(BUNDLE, 'fonts', f)); nf++; }
    }
    console.log(`built ${BUNDLE}`);
    console.log(`  styles.css + components/base.css + tokens/{themes,defaults}.css + tokens.json + ${nf} fonts`);
    console.log(`  (README.md is authored by hand - not overwritten)`);
    return;
  }

  // default: CHECK tokens.json against live CSS
  let tokens;
  try { tokens = JSON.parse(readFileSync(TOKENS_JSON, 'utf8')); }
  catch { console.error('tokens.json missing or invalid - run: node design/sync-tokens.mjs --write'); process.exit(1); }

  const drift = [];
  const expect = buildTokens();
  // fonts
  for (const k of Object.keys(expect.fonts)) {
    if (tokens.fonts?.[k]?.value !== expect.fonts[k].value)
      drift.push(`font ${k}: tokens.json=${tokens.fonts?.[k]?.value} css=${expect.fonts[k].value}`);
  }
  // cssVars
  const ev = expect.cssVars, tv = tokens.cssVars || {};
  for (const sel of Object.keys(ev)) {
    if (!tv[sel]) { drift.push(`missing theme block: ${sel}`); continue; }
    for (const [k, v] of Object.entries(ev[sel])) {
      if (tv[sel][k] !== v) drift.push(`${sel} ${k}: tokens.json=${tv[sel][k]} css=${v}`);
    }
    for (const k of Object.keys(tv[sel])) if (!(k in ev[sel])) drift.push(`${sel} ${k}: in tokens.json but not in CSS`);
  }
  for (const sel of Object.keys(tv)) if (!ev[sel]) drift.push(`stale theme block in tokens.json: ${sel}`);

  if (drift.length) {
    console.error(`tokens.json is out of sync with the CSS (${drift.length}):`);
    for (const d of drift) console.error('  - ' + d);
    console.error('\n  Fix: node design/sync-tokens.mjs --write   (then re-run --bundle to push)');
    process.exit(1);
  }
  console.log('tokens.json matches theme.css + styles.css');
}

run();
