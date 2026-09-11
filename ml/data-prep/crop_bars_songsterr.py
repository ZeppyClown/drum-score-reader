#!/usr/bin/env python3
"""
crop_bars_songsterr.py

Crops per-bar images from Songsterr PDF exports and pairs them with the
GP7-generated label JSON files in labels/.

HOW BAR DETECTION WORKS (Songsterr vs Reflow):
  Reflow draws per-bar staff segments → bar boundaries are horizontal segment endpoints.
  Songsterr draws full-width staff lines → no horizontal endpoints to use.
  Instead, Songsterr draws explicit vertical bar lines that span exactly the staff height.
  This script detects those vertical lines to find bar boundaries.

NAME MATCHING:
  PDF names and GP7 label names differ (e.g. "The Spirit Of Radio Drum Tab by Rush
  _ Songsterr Tabs with Rhythm" vs "Rush The Spirit Of Radio Drum Tab Apr 2 2026").
  Song titles are auto-extracted by stripping "Rush", "Drum Tab", dates, and
  "by Rush _ Songsterr ..." suffixes from both sides, then matched by title.

Reads:  songsterr/pdf/      Songsterr-exported PDFs
        labels/              GP7-parsed label JSONs (<gp7_stem>_bar001.json …)
Writes: dataset/images/      Cropped bar PNGs
        dataset/labels/      Copies of matched label JSONs
        dataset/debug/       Annotated pages (only with --save-debug)

Install: pip install pymupdf opencv-python numpy
Usage:
  python crop_bars_songsterr.py                          # all PDFs
  python crop_bars_songsterr.py --dry-run                # count bars, save nothing
  python crop_bars_songsterr.py --song "Tom Sawyer"      # one song by title
  python crop_bars_songsterr.py --save-debug             # save annotated debug pages
  python crop_bars_songsterr.py --diagnose               # inspect PDF structure
"""

import argparse
import re
import shutil
import sys
from pathlib import Path

import cv2
import fitz
import numpy as np

# ── Paths ─────────────────────────────────────────────────────────────────────
ML_DIR = Path(__file__).resolve().parent.parent
DEFAULT_PDF_DIR = ML_DIR / 'data' / 'songsterr' / 'pdf'
DEFAULT_LABEL_DIR = ML_DIR / 'data' / 'labels'
DEFAULT_OUTPUT_DIR = ML_DIR / 'data' / 'dataset'

DPI   = 150
SCALE = DPI / 72

# ── Tuning ────────────────────────────────────────────────────────────────────
HLINE_MIN_WIDTH   = 25   # pt: retains miniature bars while filtering short notation strokes
STAFF_LINE_GAP    = 2    # pt: y-values closer than this → same staff line cluster
STAFF_ROW_GAP     = 8    # pt: gap to previous cluster; larger → new staff row
STAFF_SPACING_MIN = 4    # pt: minimum gap between consecutive lines in a five-line staff
STAFF_SPACING_MAX = 7    # pt: maximum gap between consecutive lines in a five-line staff
STAFF_SPACING_TOL = 1.5  # pt: maximum variation among the four staff-line gaps
VLINE_MAX_DX      = 2    # pt: max horizontal drift to count as "vertical"
VLINE_Y_TOL       = 4    # pt: how closely a vertical line must match staff top/bottom
MIN_BAR_PX        = 40   # px: bar lines closer than this are duplicates / double bars
PAD_Y             = 50   # px: vertical padding on each bar crop
PAD_X             = 4    # px: horizontal padding on each bar crop


# ── Name matching ─────────────────────────────────────────────────────────────

_BANDS = [
    'rush', 'nirvana', 'metallica', 'led zeppelin', 'ac dc',
    'green day', 'foo fighters', 'james brown', 'bob marley',
    'phil collins', 'the police', 'the eagles', 'eagles',
]

_DATE_RE = re.compile(
    r'\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|'
    r'jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
    r'\.?\s*\d{0,2},?\s*\d{4}\b'
    r'|\b\d{2}-\d{2}-\d{4}\b'
    r'|\b20\d{2}\b',
    re.IGNORECASE,
)

# Confirmed source/PDF title equivalences that cannot be derived mechanically.
# Keep this explicit: broad fuzzy matching could silently pair the wrong song.
_TITLE_ALIASES = {
    "its a mans mans mans world": "its a mans world",
}


def _normalise_title(name: str) -> str:
    """Strip band names, dates, 'Drum Tab', 'by Band', 'Songsterr...' to get bare song title."""
    s = name
    # Strip mm-dd-yyyy BEFORE replacing dashes (avoids "05 30" residue after dash→space)
    s = re.sub(r'\d{2}-\d{2}-\d{4}', '', s)
    # Normalise AC_DC-Song-date separators to spaces
    s = s.replace('_', ' ').replace('-', ' ')
    s = s.lower()
    # Remove Songsterr suffix
    if 'songsterr' in s:
        s = s[:s.index('songsterr')]
    # Remove "drum tab" and everything after
    if 'drum tab' in s:
        s = s[:s.index('drum tab')]
    # Remove dates (written month names and bare years)
    s = _DATE_RE.sub('', s)
    # Strip any residual lone numbers (e.g. leftover "05 30" after date stripping)
    s = re.sub(r'\b\d{1,4}\b', '', s)
    # Remove " by [band]"
    for band in _BANDS:
        s = re.sub(r'\bby\s+' + re.escape(band) + r'\b', '', s)
    # Remove leading band name
    for band in sorted(_BANDS, key=len, reverse=True):  # longest first avoids partial matches
        s = re.sub(r'^\s*' + re.escape(band) + r'\s+', '', s)
    # Strip punctuation that varies between sources (commas, apostrophes, periods)
    s = re.sub(r"[',.]", '', s)
    # Normalise whitespace
    s = re.sub(r'\s+', ' ', s).strip()
    return _TITLE_ALIASES.get(s, s)


def build_name_map(label_dir: Path) -> dict[str, list[Path]]:
    """
    Returns { normalised_title: [label_bar_paths...] } for every GP7-parsed label group.
    """
    groups: dict[str, list[Path]] = {}
    for lbl in sorted(label_dir.glob('*_bar*.json')):
        stem = lbl.stem                     # e.g. "Rush Tom Sawyer Drum Tab_bar003"
        song_stem = re.sub(r'_bar\d+$', '', stem)   # strip "_bar003"
        title = _normalise_title(song_stem)
        groups.setdefault(title, []).append(lbl)
    return groups


def find_labels_for_pdf(pdf_path: Path, name_map: dict[str, list[Path]]) -> list[Path]:
    title = _normalise_title(pdf_path.stem)
    if title in name_map:
        return sorted(name_map[title])
    # Fallback: prefix match (handles "jammin'" vs "jammin", title length differences)
    candidates = [k for k in name_map if k and (k.startswith(title) or title.startswith(k))]
    if len(candidates) == 1:
        return sorted(name_map[candidates[0]])
    return []


# ── Step 1: horizontal lines → staff rows ─────────────────────────────────────

def extract_hlines(page: fitz.Page) -> list[dict]:
    hlines: list[dict] = []
    for path in page.get_drawings():
        for item in path['items']:
            if item[0] == 'l':
                p1, p2 = item[1], item[2]
                dx = abs(p2.x - p1.x)
                dy = abs(p2.y - p1.y)
                if dy < 1 and dx >= HLINE_MIN_WIDTH:
                    hlines.append({
                        'y': (p1.y + p2.y) / 2,
                        'x0': min(p1.x, p2.x),
                        'x1': max(p1.x, p2.x),
                        'width': dx,
                    })
            elif item[0] == 're':
                r = item[1]
                if r.height < 1 and r.width >= HLINE_MIN_WIDTH:
                    hlines.append({
                        'y': r.y0 + r.height / 2,
                        'x0': r.x0,
                        'x1': r.x1,
                        'width': r.width,
                    })
    return hlines


def find_staff_rows(hlines: list[dict]) -> list[tuple[float, float]]:
    if not hlines:
        return []

    from collections import defaultdict

    segment_groups: defaultdict[tuple[float, float], list[dict]] = defaultdict(list)
    for line in hlines:
        key = (
            round(line['x0'] * 2) / 2,
            round(line['x1'] * 2) / 2,
        )
        segment_groups[key].append(line)

    staff_hlines: list[dict] = []
    for lines in segment_groups.values():
        ys = sorted(line['y'] for line in lines)
        clusters: list[list[float]] = [[ys[0]]]
        for y in ys[1:]:
            if y - clusters[-1][-1] <= STAFF_LINE_GAP:
                clusters[-1].append(y)
            else:
                clusters.append([y])

        centers = [sum(cluster) / len(cluster) for cluster in clusters]
        has_staff_geometry = False
        for start in range(len(centers) - 4):
            gaps = [
                centers[index + 1] - centers[index]
                for index in range(start, start + 4)
            ]
            if (
                all(STAFF_SPACING_MIN <= gap <= STAFF_SPACING_MAX for gap in gaps)
                and max(gaps) - min(gaps) <= STAFF_SPACING_TOL
            ):
                has_staff_geometry = True
                break

        if has_staff_geometry:
            staff_hlines.extend(lines)

    if not staff_hlines:
        return []

    ys = sorted(line['y'] for line in staff_hlines)

    y_clusters: list[float] = []
    group = [ys[0]]
    for y in ys[1:]:
        if y - group[-1] <= STAFF_LINE_GAP:
            group.append(y)
        else:
            y_clusters.append(sum(group) / len(group))
            group = [y]
    y_clusters.append(sum(group) / len(group))

    rows: list[tuple[float, float]] = []
    row: list[float] = [y_clusters[0]]
    for y in y_clusters[1:]:
        if y - row[-1] <= STAFF_ROW_GAP:
            row.append(y)
        else:
            if len(row) >= 2:
                rows.append((min(row), max(row)))
            row = [y]
    if len(row) >= 2:
        rows.append((min(row), max(row)))

    return rows


def find_staff_span(hlines: list[dict], top_y: float, bot_y: float) -> tuple[float, float]:
    """Return the widest horizontal staff span inside one detected row."""
    candidates = [
        line for line in hlines
        if top_y - STAFF_LINE_GAP <= line['y'] <= bot_y + STAFF_LINE_GAP
    ]
    if not candidates:
        return (0.0, 0.0)
    widest = max(candidates, key=lambda line: line['width'])
    return (widest['x0'], widest['x1'])


# ── Step 2: vertical bar lines → bar x-positions ─────────────────────────────

def extract_vlines(page: fitz.Page) -> list[dict]:
    """Return all near-vertical line segments."""
    vlines: list[dict] = []
    for path in page.get_drawings():
        for item in path['items']:
            if item[0] == 'l':
                p1, p2 = item[1], item[2]
                dx = abs(p2.x - p1.x)
                dy = abs(p2.y - p1.y)
                if dx <= VLINE_MAX_DX and dy > 5:
                    vlines.append({
                        'x':  (p1.x + p2.x) / 2,
                        'y0': min(p1.y, p2.y),
                        'y1': max(p1.y, p2.y),
                    })
    return vlines


def find_bar_xs(vlines: list[dict], top_y: float, bot_y: float) -> list[float]:
    """
    Bar lines in Songsterr PDFs are vertical lines whose top and bottom
    match the staff row top/bottom within VLINE_Y_TOL points.
    """
    xs: set[float] = set()
    for v in vlines:
        if abs(v['y0'] - top_y) <= VLINE_Y_TOL and abs(v['y1'] - bot_y) <= VLINE_Y_TOL:
            xs.add(round(v['x'] * 2) / 2)

    sorted_xs = sorted(xs)

    # Deduplicate x-positions within 1pt (double bar lines drawn as two close lines)
    deduped: list[float] = []
    for x in sorted_xs:
        if not deduped or x - deduped[-1] > 1:
            deduped.append(x)

    # Filter pairs that are too close in pixels (repeat signs, thick bar lines)
    filtered: list[float] = []
    for x in deduped:
        if not filtered or (x - filtered[-1]) * SCALE >= MIN_BAR_PX:
            filtered.append(x)

    return filtered


# ── Step 3: render and crop ───────────────────────────────────────────────────

def render_gray(page: fitz.Page) -> np.ndarray:
    mat = fitz.Matrix(SCALE, SCALE)
    pix = page.get_pixmap(matrix=mat, colorspace=fitz.csGRAY)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).copy()
    return arr.reshape(pix.height, pix.width)


def crop_bars(gray: np.ndarray,
              staff_rows: list[tuple[float, float]],
              bar_xs_per_row: list[list[float]],
              staff_spans: list[tuple[float, float]]) -> list[np.ndarray]:
    """Crop complete bars and join measures that wrap across staff rows."""
    ph, pw = gray.shape
    crops: list[np.ndarray] = []
    pending_fragments: list[np.ndarray] = []

    def crop_region(top_y: float, bot_y: float,
                    left_x: float, right_x: float) -> np.ndarray:
        yt = max(0,  int(top_y * SCALE) - PAD_Y)
        yb = min(ph, int(bot_y * SCALE) + PAD_Y)
        xl = max(0,  int(left_x  * SCALE) - PAD_X)
        xr = min(pw, int(right_x * SCALE) + PAD_X)
        return gray[yt:yb, xl:xr].copy()

    def join_fragments(fragments: list[np.ndarray]) -> np.ndarray:
        height = max(fragment.shape[0] for fragment in fragments)
        width = sum(fragment.shape[1] for fragment in fragments)
        joined = np.full((height, width), 255, dtype=gray.dtype)
        offset = 0
        for fragment in fragments:
            top = (height - fragment.shape[0]) // 2
            joined[top:top + fragment.shape[0], offset:offset + fragment.shape[1]] = fragment
            offset += fragment.shape[1]
        return joined

    for (top_y, bot_y), bar_xs, (span_left, span_right) in zip(
        staff_rows,
        bar_xs_per_row,
        staff_spans,
    ):
        if pending_fragments:
            if not bar_xs:
                pending_fragments.append(crop_region(
                    top_y, bot_y, span_left, span_right,
                ))
                continue
            pending_fragments.append(crop_region(
                top_y, bot_y, span_left, bar_xs[0],
            ))
            crops.append(join_fragments(pending_fragments))
            pending_fragments = []

        for i in range(len(bar_xs) - 1):
            crops.append(crop_region(
                top_y, bot_y, bar_xs[i], bar_xs[i + 1],
            ))

        if (
            bar_xs
            and (span_right - bar_xs[-1]) * SCALE >= MIN_BAR_PX
        ):
            pending_fragments = [crop_region(
                top_y, bot_y, bar_xs[-1], span_right,
            )]

    return crops


# ── Debug visualisation ───────────────────────────────────────────────────────

def make_debug_image(gray: np.ndarray,
                     staff_rows: list[tuple[float, float]],
                     bar_xs_per_row: list[list[float]]) -> np.ndarray:
    ph, pw = gray.shape
    vis = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    for (top_y, bot_y), bar_xs in zip(staff_rows, bar_xs_per_row):
        yt = max(0,  int(top_y * SCALE) - PAD_Y)
        yb = min(ph, int(bot_y * SCALE) + PAD_Y)
        cv2.rectangle(vis, (0, yt), (pw - 1, yb), (0, 200, 0), 1)
        for x in bar_xs:
            xp = int(x * SCALE)
            cv2.line(vis, (xp, yt), (xp, yb), (0, 0, 255), 1)
    return vis


# ── Diagnostic mode ───────────────────────────────────────────────────────────

def diagnose_pdf(pdf_path: Path) -> None:
    doc  = fitz.open(str(pdf_path))
    page = doc[0]

    hlines  = extract_hlines(page)
    vlines  = extract_vlines(page)
    rows    = find_staff_rows(hlines)

    print(f"\nDiagnosing: {pdf_path.name}")
    print(f"  Page size     : {page.rect.width:.1f} x {page.rect.height:.1f} pt")
    print(f"  Drawing paths : {len(page.get_drawings())}")
    print(f"  H-lines found : {len(hlines)}")
    print(f"  V-lines found : {len(vlines)}")
    print(f"  Staff rows    : {len(rows)}")

    for i, (top_y, bot_y) in enumerate(rows):
        bar_xs = find_bar_xs(vlines, top_y, bot_y)
        print(f"    Row {i+1}: y={top_y:.1f}–{bot_y:.1f}  bar_xs={[round(x,1) for x in bar_xs]}  → {max(0,len(bar_xs)-1)} bars")

    doc.close()


# ── Per-PDF processing ────────────────────────────────────────────────────────

def process_pdf(pdf_path: Path, labels: list[Path], output_dir: Path,
                dry_run: bool, save_debug: bool) -> dict:
    song_name = pdf_path.stem
    doc       = fitz.open(str(pdf_path))
    all_crops: list[np.ndarray] = []
    out_img   = output_dir / 'images'
    out_lbl   = output_dir / 'labels'
    debug_dir = output_dir / 'debug'

    for page_idx, page in enumerate(doc):
        hlines         = extract_hlines(page)
        vlines         = extract_vlines(page)
        staff_rows     = find_staff_rows(hlines)
        bar_xs_per_row = [find_bar_xs(vlines, t, b) for t, b in staff_rows]
        staff_spans    = [find_staff_span(hlines, t, b) for t, b in staff_rows]

        gray  = render_gray(page)
        crops = crop_bars(gray, staff_rows, bar_xs_per_row, staff_spans)
        all_crops.extend(crops)

        if save_debug:
            debug_dir.mkdir(parents=True, exist_ok=True)
            vis = make_debug_image(gray, staff_rows, bar_xs_per_row)
            cv2.imwrite(str(debug_dir / f"{song_name}_p{page_idx + 1:02d}.png"), vis)

    doc.close()

    n_crops  = len(all_crops)
    n_labels = len(labels)
    ok       = n_crops == n_labels

    if not dry_run and ok:
        out_img.mkdir(parents=True, exist_ok=True)
        out_lbl.mkdir(parents=True, exist_ok=True)
        for i, (crop, lbl) in enumerate(zip(all_crops, labels)):
            # Use the PDF stem as the image name so spot_check.py can find the label
            name = f"{song_name}_bar{i + 1:03d}"
            cv2.imwrite(str(out_img / f"{name}.png"), crop)
            # Copy label, renaming it to match the PDF-based image name
            shutil.copy(lbl, out_lbl / f"{name}.json")

    return {'song': song_name, 'crops': n_crops, 'labels': n_labels, 'ok': ok}


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument('--dry-run',    action='store_true', help='count bars only, save nothing')
    ap.add_argument('--song',       type=str,            help='process one PDF by song title (partial match)')
    ap.add_argument('--save-debug', action='store_true', help='save annotated debug pages')
    ap.add_argument('--diagnose',   action='store_true', help='print PDF structure for first matching PDF and exit')
    ap.add_argument(
        '--pdf-dir', type=Path, default=DEFAULT_PDF_DIR,
        help=f'directory containing Songsterr PDFs (default: {DEFAULT_PDF_DIR})',
    )
    ap.add_argument(
        '--label-dir', type=Path, default=DEFAULT_LABEL_DIR,
        help=f'directory containing parsed labels (default: {DEFAULT_LABEL_DIR})',
    )
    ap.add_argument(
        '--output-dir', type=Path, default=DEFAULT_OUTPUT_DIR,
        help=f'dataset output directory (default: {DEFAULT_OUTPUT_DIR})',
    )
    args = ap.parse_args()

    pdf_dir = args.pdf_dir.expanduser().resolve()
    label_dir = args.label_dir.expanduser().resolve()
    output_dir = args.output_dir.expanduser().resolve()
    if not pdf_dir.is_dir():
        ap.error(f'PDF directory does not exist: {pdf_dir}')
    if not label_dir.is_dir():
        ap.error(f'label directory does not exist: {label_dir}')

    name_map = build_name_map(label_dir)

    pdfs = sorted(pdf_dir.glob('*.pdf'))
    if args.song:
        query = args.song.lower()
        pdfs  = [p for p in pdfs if query in _normalise_title(p.stem)]
        if not pdfs:
            print(f"No PDF found matching: {args.song!r}")
            sys.exit(1)

    if not pdfs:
        print(f'No PDF files found in {pdf_dir}')
        return

    if args.diagnose:
        diagnose_pdf(pdfs[0])
        sys.exit(0)

    results: list[dict] = []
    for pdf in pdfs:
        labels = find_labels_for_pdf(pdf, name_map)
        if not labels:
            print(f"  -  {pdf.stem[:60]}  (no labels — skipped)")
            results.append({'song': pdf.stem, 'crops': 0, 'labels': 0, 'ok': False, 'skip': True})
            continue

        r = process_pdf(
            pdf,
            labels,
            output_dir=output_dir,
            dry_run=args.dry_run,
            save_debug=args.save_debug,
        )
        mark = '✓' if r['ok'] else '✗'
        print(f"  {mark}  {r['song'][:60]:<60}  crops={r['crops']}  labels={r['labels']}")
        results.append(r)

    processed  = [r for r in results if not r.get('skip')]
    ok_count   = sum(1 for r in processed if r['ok'])
    fail_count = len(processed) - ok_count
    total_bars = sum(r['crops'] for r in processed if r['ok'])
    skipped    = len(results) - len(processed)

    print(f"\n{'─' * 70}")
    print(f"  Songs processed : {len(processed)}  (skipped {skipped} — no labels)")
    print(f"  Matched         : {ok_count}")
    print(f"  Mismatched      : {fail_count}  (crop count ≠ label count)")
    if not args.dry_run:
        print(f"  Pairs saved     : {total_bars} image+label pairs → {output_dir}")

    if fail_count:
        worst = sorted([r for r in processed if not r['ok']],
                       key=lambda r: abs(r['crops'] - r['labels']), reverse=True)
        print(f"\n  Worst mismatches:")
        for r in worst[:10]:
            diff = r['crops'] - r['labels']
            print(f"    {diff:+4d}  {r['song']}")


if __name__ == '__main__':
    main()
