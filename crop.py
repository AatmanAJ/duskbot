#!/usr/bin/env python3
"""crop.py IN OUT x y w h [scale=2] : crop in CSS px."""
import sys
from PIL import Image
i, o = sys.argv[1], sys.argv[2]; x, y, w, h = [float(v) for v in sys.argv[3:7]]; s = float(sys.argv[7]) if len(sys.argv) > 7 else 2
im = Image.open(i); box = (max(0, int(x*s)), max(0, int(y*s)), min(im.width, int((x+w)*s)), min(im.height, int((y+h)*s)))
im.crop(box).save(o); print(o, box)
