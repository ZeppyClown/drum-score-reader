#!/usr/bin/env python3
"""Generate an HTML spot check for random Songsterr bar image/label pairs.

Usage:
  python ml/data-prep/spot_check_songsterr.py
  python ml/data-prep/spot_check_songsterr.py --count 10 --no-open
"""

import argparse
import json
import random
import webbrowser
from pathlib import Path

ML_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATASET_DIR = ML_DIR / 'data' / 'dataset'
DEFAULT_IMAGE_DIR = DEFAULT_DATASET_DIR / 'images'
DEFAULT_LABEL_DIR = DEFAULT_DATASET_DIR / 'labels'
DEFAULT_OUTPUT = DEFAULT_DATASET_DIR / 'spot_check_songsterr.html'


def drums_html(drums: list[str]) -> str:
    parts = []
    for drum in drums:
        if drum.startswith('midi'):
            parts.append(f'<span class="midi">{drum}</span>')
        else:
            parts.append(drum)
    return ', '.join(parts)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        '--image-dir', type=Path, default=DEFAULT_IMAGE_DIR,
        help=f'directory containing bar images (default: {DEFAULT_IMAGE_DIR})',
    )
    ap.add_argument(
        '--label-dir', type=Path, default=DEFAULT_LABEL_DIR,
        help=f'directory containing paired labels (default: {DEFAULT_LABEL_DIR})',
    )
    ap.add_argument(
        '--output', type=Path, default=DEFAULT_OUTPUT,
        help=f'HTML output path (default: {DEFAULT_OUTPUT})',
    )
    ap.add_argument('--count', type=int, default=30, help='maximum pairs to sample')
    ap.add_argument('--no-open', action='store_true', help='write HTML without opening a browser')
    args = ap.parse_args()

    if args.count < 1:
        ap.error('--count must be at least 1')

    image_dir = args.image_dir.expanduser().resolve()
    label_dir = args.label_dir.expanduser().resolve()
    output = args.output.expanduser().resolve()

    if not image_dir.is_dir():
        ap.error(f'image directory does not exist: {image_dir}')
    if not label_dir.is_dir():
        ap.error(f'label directory does not exist: {label_dir}')

    images = sorted(path for path in image_dir.glob('*.png') if 'Songsterr' in path.name)
    if not images:
        ap.error(f'no Songsterr PNG images found in {image_dir}')

    sample = random.sample(images, min(args.count, len(images)))
    rows = []
    for image_path in sorted(sample):
        label_path = label_dir / f'{image_path.stem}.json'
        if not label_path.exists():
            continue

        data = json.loads(label_path.read_text())
        beats = data.get('beats', [])
        beat_html = ''
        for beat in beats:
            rest_style = ' style="color:#888"' if beat.get('rest') else ''
            drum_text = 'rest' if beat.get('rest') else drums_html(beat['drums'])
            beat_html += (
                f'<tr{rest_style}>'
                f'<td>{beat["beat"]}</td>'
                f'<td>{beat["duration"]}</td>'
                f'<td>{drum_text}</td>'
                f'</tr>'
            )

        rows.append(f"""
        <div class="card">
          <img src="{image_path.resolve().as_uri()}" alt="{image_path.stem}">
          <div class="label">
            <div class="name">{image_path.stem}</div>
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
<title>Spot Check Songsterr — {len(rows)} bars</title>
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
<h1>Spot Check — Songsterr ({len(rows)} random bars)</h1>
<p style="color:#aaa">Check that each image matches its label. Run the script again to get a new random sample.</p>
{''.join(rows)}
</body>
</html>"""

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html)
    if not args.no_open:
        webbrowser.open(output.as_uri())
    print(f'Wrote {output}')


if __name__ == '__main__':
    main()
