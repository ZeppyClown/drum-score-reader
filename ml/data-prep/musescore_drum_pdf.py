"""Guitar Pro charts → drums-only PDFs drawn by MuseScore (a third, book-like drawing style).

    python3 ml/data-prep/musescore_drum_pdf.py [ml/data/songsterr_musescore] [--mscore PATH]

For each .gp file MuseScore makes one PDF per instrument; the drum part is saved to
<folder>/pdf/<name>.pdf. Files already converted are skipped, so it can be re-run.
"""
import argparse
import base64
import json
import os
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
def percussion_part_names(chart):
    """Names MuseScore will give the chart's percussion tracks (those drawn on a percussion clef).

    Tracks are often named after the drummer, so the name alone cannot find them. MuseScore
    numbers repeated names: the second "Dave Grohl" becomes "Dave Grohl (1)".
    """
    root = ET.fromstring(zipfile.ZipFile(chart).read('Content/score.gpif'))
    names = [(track.findtext('Name') or '').strip() for track in root.find('Tracks')]
    clefs = {bar.get('id'): bar.findtext('Clef') for bar in root.find('Bars')}
    percussion = {index for master in root.find('MasterBars')
                  for index, bar in enumerate(master.findtext('Bars', '').split()) if clefs.get(bar) == 'Neutral'}
    return [name if not names[:index].count(name) else f'{name} ({names[:index].count(name)})'
            for index, name in enumerate(names) if index in percussion]


def drum_pdf(mscore, chart, workdir):
    """Returns (part name, pdf bytes, how many percussion parts there were), or raises ValueError."""
    out = Path(workdir) / 'parts.json'
    out.unlink(missing_ok=True)
    subprocess.run([mscore, '--score-parts-pdf', str(chart), '-o', str(out)],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=300)
    if not out.is_file():
        raise ValueError('MuseScore could not open it')
    parts = json.loads(out.read_text())
    wanted = percussion_part_names(chart)
    drums = [(name, base64.b64decode(data)) for name, data in zip(parts['parts'], parts['partsBin']) if name.strip() in wanted]
    if not drums:
        raise ValueError(f"no part named {wanted} among: {parts['parts']}")
    # ponytail: with several percussion tracks (drum kit plus tambourine, pads...) the kit is
    # taken to be the one with the most music, measured by PDF size. Count notes if this picks wrong.
    name, pdf = max(drums, key=lambda part: len(part[1]))
    return name, pdf, len(drums)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('folder', nargs='?', type=Path, default=ROOT / 'ml' / 'data' / 'songsterr_musescore')
    parser.add_argument('--mscore', default='/Volumes/T9/MuseScore 4.app/Contents/MacOS/mscore')
    args = parser.parse_args()
    out_dir = args.folder / 'pdf'
    out_dir.mkdir(exist_ok=True)
    done = failed = 0
    with tempfile.TemporaryDirectory(dir=out_dir) as workdir:   # same drive as the charts
        for chart in sorted(args.folder.glob('*.gp')):
            target = out_dir / f'{chart.stem}.pdf'
            if target.is_file():
                done += 1
                continue
            try:
                name, pdf, candidates = drum_pdf(args.mscore, chart, workdir)
                target.write_bytes(pdf)
                done += 1
                print(f"ok    {chart.name}  ({name}){f'  CHECK: chosen from {candidates} percussion parts' if candidates > 1 else ''}", flush=True)
            except (ValueError, subprocess.TimeoutExpired, KeyError, ET.ParseError, zipfile.BadZipFile) as error:
                failed += 1
                print(f'FAIL  {chart.name}: {error}', flush=True)
    print(f'{done} drum PDFs in {out_dir.relative_to(ROOT) if out_dir.is_relative_to(ROOT) else out_dir}; {failed} failed')


if __name__ == '__main__':
    main()
