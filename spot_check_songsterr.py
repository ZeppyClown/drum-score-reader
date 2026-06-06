#!/usr/bin/env python3
"""
spot_check_songsterr.py

Opens up to 30 random Songsterr bar images that contain at least one unresolved
midi{n} note. midi{n} entries are highlighted in red.

Usage: python spot_check_songsterr.py
"""

import json
import random
import webbrowser
from pathlib import Path

IMG_DIR = Path(__file__).parent / 'dataset' / 'images'
LBL_DIR = Path(__file__).parent / 'dataset' / 'labels'
OUT     = Path(__file__).parent / 'dataset' / 'spot_check_songsterr.html'


def has_midi(beats: list) -> bool:
    return any(
        d.startswith('midi')
        for b in beats
        for d in b.get('drums', [])
    )


def drums_html(drums: list[str]) -> str:
    parts = []
    for d in drums:
        if d.startswith('midi'):
            parts.append(f'<span class="midi">{d}</span>')
        else:
            parts.append(d)
    return ', '.join(parts)


imgs = sorted(p for p in IMG_DIR.glob('*.png') if 'Songsterr' in p.name)
if not imgs:
    print("No Songsterr images found. Run  python3.12 crop_bars_songsterr.py  first.")
    raise SystemExit

# Only keep images whose label contains at least one midi{n} note
midi_imgs = []
for img_path in imgs:
    lbl_path = LBL_DIR / (img_path.stem + '.json')
    if not lbl_path.exists():
        continue
    try:
        data = json.loads(lbl_path.read_text())
        if has_midi(data.get('beats', [])):
            midi_imgs.append(img_path)
    except Exception:
        pass

if not midi_imgs:
    print("No bars with midi{n} notes found in dataset/labels/.")
    raise SystemExit

print(f"Found {len(midi_imgs)} bars with midi{{n}} notes. Sampling 30.")
sample = random.sample(midi_imgs, min(30, len(midi_imgs)))

rows = []
for img_path in sorted(sample):
    lbl_path = LBL_DIR / (img_path.stem + '.json')
    data  = json.loads(lbl_path.read_text())
    beats = data.get('beats', [])

    beat_html = ''.join(
        f'<tr><td>{b["beat"]}</td>'
        f'<td>{b["duration"]}</td>'
        f'<td>{drums_html(b["drums"])}</td></tr>'
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
<title>Spot Check — midi notes ({len(rows)} bars)</title>
<style>
  body {{ font-family: monospace; background: #1a1a1a; color: #eee; padding: 20px; }}
  h1   {{ color: #f4a261; }}
  .card {{
    display: flex; align-items: flex-start; gap: 20px;
    background: #2a2a2a; border-radius: 8px;
    padding: 12px; margin-bottom: 12px;
  }}
  img  {{ height: 80px; border: 1px solid #444; background: white; }}
  .name {{ color: #aaa; font-size: 11px; margin-bottom: 6px; }}
  table {{ border-collapse: collapse; font-size: 13px; }}
  th   {{ color: #f4a261; text-align: left; padding: 2px 12px 2px 0; }}
  td   {{ padding: 2px 12px 2px 0; }}
  .midi {{ color: #e63946; font-weight: bold; }}
</style>
</head>
<body>
<h1>Spot Check — bars with unresolved midi{{n}} notes ({len(rows)} shown, {len(midi_imgs)} total)</h1>
<p style="color:#aaa">Only bars containing at least one <span class="midi">midi{{n}}</span> entry are shown. Run again for a new sample.</p>
{''.join(rows)}
</body>
</html>"""

OUT.write_text(html)
webbrowser.open(str(OUT))
print(f"Opened {OUT}")
print(f"Run again to get a new random sample.")
