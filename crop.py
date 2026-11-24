#!/usr/bin/env python3
"""crop.py IN OUT x y w h [scale=2] : crop in CSS px, with macOS sips (no Pillow needed)."""
import subprocess, sys
i, o = sys.argv[1], sys.argv[2]; x, y, w, h = [float(v) for v in sys.argv[3:7]]; s = float(sys.argv[7]) if len(sys.argv) > 7 else 2
subprocess.run(["sips", "-c", str(int(h*s)), str(int(w*s)), "--cropOffset", str(int(y*s)), str(int(x*s)), i, "--out", o], check=True, capture_output=True)
print(o)
