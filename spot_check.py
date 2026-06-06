#!/usr/bin/env python3
"""
spot_check.py

Opens 30 random bar images alongside their labels in the browser.
No dependencies beyond the standard library — no OpenCV needed.

Usage: python spot_check.py
"""

import json
import random
import webbrowser
from pathlib import Path

IMG_DIR = Path(__file__).parent / 'dataset' / 'images'
LBL_DIR = Path(__file__).parent / 'dataset' / 'labels'
OUT     = Path(__file__).parent / 'dataset' / 'spot_check.html'

imgs = sorted(IMG_DIR.glob('*.png'))
if not imgs:
    print("No images found. Run  python crop_bars.py  first.")
    raise SystemExit

sample = random.sample(imgs, min(30, len(imgs)))

rows = []
for img_path in sorted(sample):
    lbl_path = LBL_DIR / (img_path.stem + '.json')
    if not lbl_path.exists():
        continue

    data  = json.loads(lbl_path.read_text())
    beats = data.get('beats', [])

    beat_html = ''.join(
        f'<tr><td>{b["beat"]}</td>'
        f'<td>{b["duration"]}</td>'
        f'<td>{", ".join(b["drums"])}</td></tr>'
        for b in beats
    )

    rows.append(f"""
    <div class="card">
      <img src="{img_path.resolve()}" alt="{img_path.stem}">
      <div class="label">
        <div class="name">{img_path.stem}</div>
        <table>
          <tr><th>Beat</th><th>Duration</th><th>Drums</th></tr>
          {beat_html}
        </table>
      </div>
    </div>
    """)

html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Spot Check — {len(rows)} bars</title>
<style>
  body {{ font-family: monospace; background: #1a1a1a; color: #eee; padding: 20px; }}
  h1   {{ color: #4a9eff; }}
  .card {{
    display: flex; align-items: flex-start; gap: 20px;
    background: #2a2a2a; border-radius: 8px;
    padding: 12px; margin-bottom: 12px;
  }}
  img  {{ height: 80px; border: 1px solid #444; background: white; }}
  .name {{ color: #aaa; font-size: 11px; margin-bottom: 6px; }}
  table {{ border-collapse: collapse; font-size: 13px; }}
  th   {{ color: #4a9eff; text-align: left; padding: 2px 12px 2px 0; }}
  td   {{ padding: 2px 12px 2px 0; }}
</style>
</head>
<body>
<h1>Spot Check — {len(rows)} random bars</h1>
<p style="color:#aaa">Check that each image matches its label. Run the script again to get a new random sample.</p>
{''.join(rows)}
</body>
</html>"""

OUT.write_text(html)
webbrowser.open(str(OUT))
print(f"Opened {OUT}")
print(f"Run again to get a new random sample.")
