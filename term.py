#!/usr/bin/env python3
"""term.py TEXTFILE OUT.png [--cols 100] : draw real terminal output as a 2x PNG."""
import sys, textwrap
from PIL import Image, ImageDraw, ImageFont
src, out = sys.argv[1], sys.argv[2]
cols = int(sys.argv[sys.argv.index("--cols") + 1]) if "--cols" in sys.argv else 100
S = 2
reg = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 13 * S, index=0)
bold = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 13 * S, index=1)
rows = []
for l in open(src).read().rstrip("\n").split("\n"):
    cmd = l.startswith("$ ")
    parts = textwrap.wrap(l, cols, subsequent_indent="    " if cmd else " " * (len(l) - len(l.lstrip()) + (1 if l.lstrip().startswith(chr(34)) else 0)), replace_whitespace=False, drop_whitespace=False) or [""]
    rows += [(p, cmd) for p in parts]
cw = reg.getlength("M"); lh = 20 * S; pad = 26 * S
W = int(cw * max(len(r[0]) for r in rows)) + pad * 2; W = max(W, 560 * S); H = lh * len(rows) + pad * 2
im = Image.new("RGB", (W, H), (22, 22, 26)); d = ImageDraw.Draw(im)
for i, (t, cmd) in enumerate(rows):
    y = pad + i * lh
    if cmd and t.startswith("$ "):
        d.text((pad, y), "$", font=reg, fill=(124, 124, 138)); d.text((pad + cw * 2, y), t[2:], font=bold, fill=(255, 255, 255))
    else:
        d.text((pad, y), t, font=bold if cmd else reg, fill=(255, 255, 255) if cmd else (214, 214, 222))
im.save(out); print(out, im.size)
