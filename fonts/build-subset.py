#!/usr/bin/env python3
"""Subset + woff2-convert the self-hosted UI fonts.

Why: the game ships its fonts (no Google Fonts / system dependency). The raw files are huge
(Noto Serif SC alone is 25 MB), so we subset every font to ONLY the glyphs the game can render:
- every codepoint that appears literally in the source (src/**/*.js, index.html, styles.css) — this
  captures all UI glyphs (CJK seals, path/realm glyphs, ⚔ ◆ ✦ ← →, CJK numerals, combo names, …),
- printable ASCII,
- plus, for the CJK fonts only, GB2312 level-1 (~3.7k common hanzi) so a player-typed Chinese name
  still renders.

Variable-weight axes are PRESERVED (one file spans its weight range). Run from anywhere:
    python fonts/build-subset.py
Requires: fonttools + brotli  (pip install fonttools brotli). Source TTFs live in fonts/_src/.
"""
import os, glob
from fontTools.subset import Subsetter, Options
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'fonts', '_src')
OUT = os.path.join(ROOT, 'fonts')

# 1) codepoints used literally in the source (so every rendered glyph is covered) + printable ASCII
cps = set(range(0x20, 0x7F))
for pat in ('src/**/*.js', 'index.html', 'styles.css'):
    for path in glob.glob(os.path.join(ROOT, pat), recursive=True):
        with open(path, encoding='utf-8') as f:
            cps.update(ord(c) for c in f.read())

# 2) GB2312 level-1 common hanzi (for dynamic, player-entered Chinese text) — CJK fonts only
gb = set()
for hi in range(0xB0, 0xD8):
    for lo in range(0xA1, 0xFF):
        try:
            gb.add(ord(bytes([hi, lo]).decode('gb2312')))
        except Exception:
            pass

latin = sorted(cps)            # Latin fonts keep only what exists (CJK requests no-op)
cjk = sorted(cps | gb)         # CJK fonts also keep common hanzi for names

# (source, output, unicodes)
JOBS = [
    (f'{SRC}/CormorantGaramond[wght].ttf',        f'{OUT}/CormorantGaramond-var.woff2',        latin),
    (f'{SRC}/CormorantGaramond-Italic[wght].ttf', f'{OUT}/CormorantGaramond-Italic-var.woff2', latin),
    (f'{SRC}/SpaceMono-Regular.ttf',              f'{OUT}/SpaceMono-Regular.woff2',            latin),
    (f'{SRC}/SpaceMono-Bold.ttf',                 f'{OUT}/SpaceMono-Bold.woff2',               latin),
    (f'{SRC}/NotoSerifSC[wght].ttf',              f'{OUT}/NotoSerifSC-var.woff2',              cjk),
    # Zhi Mang Xing only paints combat floating text (digits + Latin labels + combo glyphs, all in the
    # source), so it needs the source set, NOT GB2312 — Noto Serif SC is its fallback for any rare hanzi.
    (f'{SRC}/ZhiMangXing-Regular.ttf',            f'{OUT}/ZhiMangXing-Regular.woff2',          latin),
]

print(f'charset: {len(latin)} latin/source codepoints, {len(cjk)} with GB2312 hanzi\n')
for src, out, unicodes in JOBS:
    opt = Options()
    opt.flavor = 'woff2'
    opt.ignore_missing_unicodes = True   # Latin fonts simply skip CJK requests
    opt.notdef_outline = True
    font = TTFont(src)
    ss = Subsetter(options=opt)
    ss.populate(unicodes=unicodes)
    ss.subset(font)
    font.save(out)
    print(f'{os.path.basename(out):36} {os.path.getsize(out)//1024:>6} KB')
