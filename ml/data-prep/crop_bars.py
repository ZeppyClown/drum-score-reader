#!/usr/bin/env python3
"""
crop_bars.py

Crops per-bar images from Guitar Pro/Reflow PDF exports and pairs them
with the existing label JSON files in labels/.

HOW BAR DETECTION WORKS:
  Reflow stores each staff line as a short horizontal segment — one segment
  per bar, not one long line across the whole page. So for a row of 4 bars:

    bar 1: ─────────  bar 2: ─────────  bar 3: ─────────  bar 4: ─────────
           x0   x1           x1   x2           x2   x3           x3   x4

  The START and END x-coordinates of these segments are exactly the bar line
  positions. We collect all unique x-endpoints per staff row → bar boundaries.
  No vertical line detection needed at all.

Reads:  reflow_pdf/     GP5-exported PDFs (one per song)
        labels/          Per-bar JSON files (<song>_bar001.json …)
Writes: dataset/images/  Cropped bar PNGs
        dataset/labels/  Copies of matched label JSONs
        dataset/debug/   Annotated pages (only with --save-debug)

Install: pip install pymupdf opencv-python numpy
Usage:
  python crop_bars.py                           # all PDFs
  python crop_bars.py --dry-run                 # count bars, save nothing
  python crop_bars.py --song "Alwin_Rudiments"  # one song only
  python crop_bars.py --save-debug              # save annotated debug pages
  python crop_bars.py --diagnose                # inspect PDF structure
"""

import argparse
import shutil
import sys
from pathlib import Path

import cv2
import fitz          # PyMuPDF — pip install pymupdf
import numpy as np

# ── Paths ─────────────────────────────────────────────────────────────────────
ML_DIR = Path(__file__).resolve().parent.parent
DEFAULT_PDF_DIR = ML_DIR / 'data' / 'reflow_pdf'
DEFAULT_LABEL_DIR = ML_DIR / 'data' / 'labels'
DEFAULT_OUTPUT_DIR = ML_DIR / 'data' / 'dataset'

DPI   = 150
SCALE = DPI / 72      # PDF points → pixels

# ── Tuning (all in PDF points unless noted) ───────────────────────────────────
HLINE_MIN_WIDTH   = 50   # pt: filters beams for 4-bar rows (beam ≈ 32pt, staff seg ≈ 128pt).
                         #   Longer beams can still pass this coarse filter; find_bar_xs
                         #   verifies the five-line staff geometry before using endpoints.
STAFF_LINE_GAP    = 2    # pt: y-values closer than this = same staff line
STAFF_ROW_GAP     = 8    # pt: gap-to-previous y-cluster; > this = new staff row
STAFF_SPACING_MIN = 3    # pt: minimum gap between consecutive lines in a five-line staff
STAFF_SPACING_MAX = 7    # pt: maximum gap between consecutive lines in a five-line staff
STAFF_SPACING_TOL = 1.5  # pt: maximum variation among the four staff-line gaps
ENDPOINT_TOL      = 1    # pt: x-endpoints within this distance are the same bar line
MIN_BAR_LINE_FREQ = 5    # bar line endpoints appear 5× (outer) or 10× (inner bar lines).
                         #   Only endpoints from verified staff-segment groups are counted.
PAD_Y             = 50   # px: vertical padding on each bar crop (stems extend ~20-30pt above staff)
PAD_X             = 4    # px: horizontal padding on each bar crop
MIN_BAR_PX        = 40   # px: two bar lines closer than this are duplicates (repeat signs)


# ── Step 1: extract horizontal line segments from PDF vector data ─────────────

def extract_hlines(page: fitz.Page) -> list[dict]:
    """
    Return all horizontal line segments from the page's vector drawings.
    Each entry: { y, x0, x1, width }

    Handles both 'l' (line) and 're' (thin rectangle) path items since
    different PDF renderers represent lines differently.
    """
    hlines: list[dict] = []

    for path in page.get_drawings():
        for item in path['items']:

            if item[0] == 'l':
                p1, p2 = item[1], item[2]
                dx = abs(p2.x - p1.x)
                dy = abs(p2.y - p1.y)
                if dy < 1 and dx >= HLINE_MIN_WIDTH:
                    hlines.append({
                        'y':     (p1.y + p2.y) / 2,
                        'x0':    min(p1.x, p2.x),
                        'x1':    max(p1.x, p2.x),
                        'width': dx,
                    })

            elif item[0] == 're':
                r = item[1]
                if r.height < 1 and r.width >= HLINE_MIN_WIDTH:
                    hlines.append({
                        'y':     r.y0 + r.height / 2,
                        'x0':    r.x0,
                        'x1':    r.x1,
                        'width': r.width,
                    })

    return hlines


# ── Step 2: cluster staff lines into rows ─────────────────────────────────────

def find_staff_rows(hlines: list[dict]) -> list[tuple[float, float]]:
    """
    Return (top_y, bot_y) in PDF points for each staff row on the page.

    Approach:
    1. Cluster nearby y-values into individual staff lines
    2. Group consecutive clusters using gap-to-PREVIOUS (not gap-to-first).
       This prevents a stray beam above the staff from shifting the cluster's
       reference point and causing actual staff lines to be missed.

    Spurious clusters (beams, triplet brackets) that sneak through are handled
    downstream by the frequency filter in find_bar_xs — they produce no valid
    bar xs and get skipped at crop time.
    """
    if not hlines:
        return []

    ys = sorted(l['y'] for l in hlines)

    # Step 1: cluster identical y-values into single staff-line positions
    y_clusters: list[float] = []
    group = [ys[0]]
    for y in ys[1:]:
        if y - group[-1] <= STAFF_LINE_GAP:
            group.append(y)
        else:
            y_clusters.append(sum(group) / len(group))
            group = [y]
    y_clusters.append(sum(group) / len(group))

    # Step 2: group clusters into staff rows using gap-to-previous
    rows: list[tuple[float, float]] = []
    row: list[float] = [y_clusters[0]]
    for y in y_clusters[1:]:
        if y - row[-1] <= STAFF_ROW_GAP:   # compare to PREVIOUS element, not row[0]
            row.append(y)
        else:
            if len(row) >= 2:
                rows.append((min(row), max(row)))
            row = [y]
    if len(row) >= 2:
        rows.append((min(row), max(row)))

    return rows


# ── Step 3: collect bar line x-positions from staff segment endpoints ─────────

def _has_five_line_staff_geometry(ys: list[float]) -> bool:
    """Return whether y-values contain five evenly spaced staff lines."""
    if not ys:
        return False

    clusters: list[list[float]] = [[ys[0]]]
    for y in ys[1:]:
        if y - clusters[-1][-1] <= STAFF_LINE_GAP:
            clusters[-1].append(y)
        else:
            clusters.append([y])

    centers = [sum(cluster) / len(cluster) for cluster in clusters]
    for start in range(len(centers) - 4):
        gaps = [
            centers[index + 1] - centers[index]
            for index in range(start, start + 4)
        ]
        if (
            all(STAFF_SPACING_MIN <= gap <= STAFF_SPACING_MAX for gap in gaps)
            and max(gaps) - min(gaps) <= STAFF_SPACING_TOL
        ):
            return True

    return False


def find_bar_xs(hlines: list[dict], top_y: float, bot_y: float) -> list[float]:
    """
    Return sorted bar line x-positions for one staff row.

    Each bar's five staff lines share the same x0 and x1. Grouping lines by
    those endpoints and requiring five evenly spaced y-values distinguishes
    staff segments from long beams, brackets, and other notation. The verified
    segment endpoints give us the bar line positions directly.
    """
    from collections import Counter, defaultdict

    segment_groups: defaultdict[tuple[float, float], list[dict]] = defaultdict(list)
    for line in hlines:
        if top_y - ENDPOINT_TOL <= line['y'] <= bot_y + ENDPOINT_TOL:
            key = (
                round(line['x0'] * 2) / 2,
                round(line['x1'] * 2) / 2,
            )
            segment_groups[key].append(line)

    counts: Counter = Counter()
    for (x0, x1), lines in segment_groups.items():
        if not _has_five_line_staff_geometry(sorted(line['y'] for line in lines)):
            continue
        counts[x0] += len(lines)
        counts[x1] += len(lines)

    # Keep only endpoints backed by all five lines of at least one staff segment.
    bar_xs = sorted(x for x, n in counts.items() if n >= MIN_BAR_LINE_FREQ)

    deduped: list[float] = []
    for x in bar_xs:
        if not deduped or x - deduped[-1] > ENDPOINT_TOL:
            deduped.append(x)

    filtered: list[float] = []
    for x in deduped:
        if not filtered or (x - filtered[-1]) * SCALE >= MIN_BAR_PX:
            filtered.append(x)

    return filtered


# ── Step 4: render and crop ───────────────────────────────────────────────────

def render_gray(page: fitz.Page) -> np.ndarray:
    mat = fitz.Matrix(SCALE, SCALE)
    pix = page.get_pixmap(matrix=mat, colorspace=fitz.csGRAY)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).copy()
    return arr.reshape(pix.height, pix.width)


def crop_bars(gray: np.ndarray,
              staff_rows: list[tuple[float, float]],
              bar_xs_per_row: list[list[float]]) -> list[np.ndarray]:
    ph, pw = gray.shape
    crops: list[np.ndarray] = []

    for (top_y, bot_y), bar_xs in zip(staff_rows, bar_xs_per_row):
        if len(bar_xs) < 2:
            continue
        yt = max(0,  int(top_y * SCALE) - PAD_Y)
        yb = min(ph, int(bot_y * SCALE) + PAD_Y)

        for i in range(len(bar_xs) - 1):
            xl = max(0,  int(bar_xs[i]     * SCALE) - PAD_X)
            xr = min(pw, int(bar_xs[i + 1] * SCALE) + PAD_X)
            crops.append(gray[yt:yb, xl:xr].copy())

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

    drawings = page.get_drawings()
    images   = page.get_images(full=True)
    hlines   = extract_hlines(page)
    rows     = find_staff_rows(hlines)

    print(f"\nDiagnosing: {pdf_path.name}")
    print(f"  Page size     : {page.rect.width:.1f} x {page.rect.height:.1f} pt")
    print(f"  Drawing paths : {len(drawings)}")
    print(f"  Embedded imgs : {len(images)}")
    print(f"  H-lines found : {len(hlines)}")
    print(f"  Staff rows    : {len(rows)}")

    for i, (top_y, bot_y) in enumerate(rows):
        bar_xs = find_bar_xs(hlines, top_y, bot_y)
        print(f"    Row {i+1}: y={top_y:.1f}–{bot_y:.1f}  bar_xs={[round(x,1) for x in bar_xs]}  → {max(0,len(bar_xs)-1)} bars")

    doc.close()


# ── Per-PDF processing ────────────────────────────────────────────────────────

def process_pdf(pdf_path: Path, label_dir: Path, output_dir: Path,
                dry_run: bool, save_debug: bool) -> dict:
    song_name = pdf_path.stem
    labels    = sorted(label_dir.glob(f"{song_name}_bar*.json"))
    out_img   = output_dir / 'images'
    out_lbl   = output_dir / 'labels'
    debug_dir = output_dir / 'debug'

    if not labels:
        return {'song': song_name, 'crops': 0, 'labels': 0, 'ok': False, 'skip': True}

    doc       = fitz.open(str(pdf_path))
    all_crops: list[np.ndarray] = []

    for page_idx, page in enumerate(doc):
        hlines         = extract_hlines(page)
        staff_rows     = find_staff_rows(hlines)
        bar_xs_per_row = [find_bar_xs(hlines, t, b) for t, b in staff_rows]

        gray  = render_gray(page)
        crops = crop_bars(gray, staff_rows, bar_xs_per_row)
        all_crops.extend(crops)

        if save_debug:
            debug_dir.mkdir(parents=True, exist_ok=True)
            vis  = make_debug_image(gray, staff_rows, bar_xs_per_row)
            cv2.imwrite(str(debug_dir / f"{song_name}_p{page_idx + 1:02d}.png"), vis)

    doc.close()

    n_crops  = len(all_crops)
    n_labels = len(labels)
    ok       = n_crops == n_labels

    if not dry_run and ok:
        out_img.mkdir(parents=True, exist_ok=True)
        out_lbl.mkdir(parents=True, exist_ok=True)
        for i, (crop, lbl) in enumerate(zip(all_crops, labels)):
            name = f"{song_name}_bar{i + 1:03d}"
            cv2.imwrite(str(out_img / f"{name}.png"), crop)
            shutil.copy(lbl, out_lbl / lbl.name)

    return {'song': song_name, 'crops': n_crops, 'labels': n_labels, 'ok': ok, 'skip': False}


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument('--dry-run',    action='store_true', help='count bars only, save nothing')
    ap.add_argument('--song',       type=str,            help='process one PDF by stem name')
    ap.add_argument('--save-debug', action='store_true', help='save annotated debug pages')
    ap.add_argument('--diagnose',   action='store_true', help='print PDF structure and exit')
    ap.add_argument(
        '--pdf-dir', type=Path, default=DEFAULT_PDF_DIR,
        help=f'directory containing Reflow PDFs (default: {DEFAULT_PDF_DIR})',
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

    pdfs = sorted(pdf_dir.glob('*.pdf'))
    if args.song:
        pdfs = [p for p in pdfs if p.stem == args.song]
        if not pdfs:
            print(f"No PDF found: {args.song!r}")
            sys.exit(1)

    if not pdfs:
        print(f'No PDF files found in {pdf_dir}')
        return

    if args.diagnose:
        diagnose_pdf(pdfs[0])
        sys.exit(0)

    results: list[dict] = []
    for pdf in pdfs:
        r = process_pdf(
            pdf,
            label_dir=label_dir,
            output_dir=output_dir,
            dry_run=args.dry_run,
            save_debug=args.save_debug,
        )
        if r.get('skip'):
            print(f"  -  {r['song']:<60}  (no labels — skipped)")
        else:
            mark = '✓' if r['ok'] else '✗'
            print(f"  {mark}  {r['song']:<60}  crops={r['crops']}  labels={r['labels']}")
        results.append(r)

    processed  = [r for r in results if not r.get('skip')]
    ok_count   = sum(1 for r in processed if r['ok'])
    fail_count = len(processed) - ok_count
    total_bars = sum(r['crops'] for r in processed if r['ok'])
    skipped    = len(results) - len(processed)

    print(f"\n{'─' * 68}")
    print(f"  Songs processed : {len(processed)}  (skipped {skipped} — no labels)")
    print(f"  Matched         : {ok_count}")
    print(f"  Mismatched      : {fail_count}  (crop count ≠ label count)")
    if not args.dry_run:
        print(f"  Pairs saved     : {total_bars} image+label pairs → {output_dir}")

    if fail_count:
        over  = [r for r in processed if not r['ok'] and r['crops'] > r['labels']]
        under = [r for r in processed if not r['ok'] and r['crops'] < r['labels']]
        print(f"\n  Overcounting (crops > labels): {len(over)}")
        print(f"  Undercounting (crops < labels): {len(under)}")
        print(f"\n  Worst mismatches:")
        worst = sorted([r for r in processed if not r['ok']],
                       key=lambda r: abs(r['crops'] - r['labels']), reverse=True)
        for r in worst[:10]:
            diff = r['crops'] - r['labels']
            sign = '+' if diff > 0 else ''
            print(f"    {sign}{diff:3d}  {r['song']}")


if __name__ == '__main__':
    main()
