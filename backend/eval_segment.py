"""Measure page segmentation against the vector crop tools on the real PDF exports.

Developer tool, not part of the service:
    python3 backend/eval_segment.py [--limit N] [--source songsterr|reflow|both] [--show-misses 10]

For every page, the reference bar count comes from ml/data-prep (crop_bars.py for
Reflow, crop_bars_songsterr.py for Songsterr), whose per-song totals match the parsed
labels. page_segment works from rendered pixels instead, which is what screenshots and
photos need. Reports exact per-page matches and total bar error. Reflow file names
include student names: results stay on this machine and are never sent to a model.
"""

import argparse
import importlib.util
import sys
from pathlib import Path

import fitz

import page_segment

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'ml' / 'data'


def load_tool(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'ml' / 'data-prep' / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def vector_count(tool, page, songsterr):
    hlines = tool.extract_hlines(page)
    rows = tool.find_staff_rows(hlines)
    if songsterr:
        vlines = tool.extract_vlines(page)
        return sum(max(0, len(tool.find_bar_xs(vlines, t, b)) - 1) for t, b in rows)
    return sum(max(0, len(tool.find_bar_xs(hlines, t, b)) - 1) for t, b in rows)


def evaluate(source, limit):
    songsterr = source == 'songsterr'
    tool = load_tool('crop_bars_songsterr' if songsterr else 'crop_bars')
    folder = DATA / ('songsterr/pdf' if songsterr else 'reflow_pdf')
    pages = exact = expected_total = found_total = abs_error = 0
    misses = []
    for pdf in sorted(folder.glob('*.pdf'))[:limit]:
        document = fitz.open(pdf)
        for index, page in enumerate(document):
            expected = vector_count(tool, page, songsterr)
            if expected == 0:
                continue
            pixmap = page.get_pixmap(matrix=fitz.Matrix(page_segment.PDF_ZOOM, page_segment.PDF_ZOOM), colorspace=fitz.csGRAY)
            import numpy as np
            gray = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width)
            found = sum(len(s['bars']) for s in page_segment.segment_image(gray)['systems'])
            pages += 1
            exact += found == expected
            expected_total += expected
            found_total += found
            abs_error += abs(found - expected)
            if found != expected:
                misses.append((abs(found - expected), pdf.stem, index + 1, expected, found))
    return {'source': source, 'pages': pages, 'exact': exact, 'expected': expected_total,
            'found': found_total, 'absError': abs_error, 'misses': sorted(misses, reverse=True)}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--source', choices=['songsterr', 'reflow', 'both'], default='both')
    parser.add_argument('--limit', type=int, default=None, help='PDFs per source')
    parser.add_argument('--show-misses', type=int, default=8)
    args = parser.parse_args()
    for source in (['songsterr', 'reflow'] if args.source == 'both' else [args.source]):
        r = evaluate(source, args.limit)
        share = 100 * r['exact'] / r['pages'] if r['pages'] else 0
        print(f"{source}: {r['exact']}/{r['pages']} pages exact ({share:.1f}%), bars found {r['found']} of {r['expected']}, "
              f"total bar error {r['absError']}")
        for miss in r['misses'][:args.show_misses]:
            print(f"   off by {miss[0]}: {miss[1][:60]} page {miss[2]} (expected {miss[3]}, found {miss[4]})")
    return 0


if __name__ == '__main__':
    sys.path.insert(0, str(Path(__file__).parent))
    raise SystemExit(main())
