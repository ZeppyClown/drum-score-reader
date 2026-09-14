"""Find staves and bars in a page image, so a whole page can be imported bar by bar.

Master plan B3. Works from pixels, so it handles screenshots, photos of printed pages
and rendered PDF pages alike (the ml/data-prep crop tools read PDF vector lines instead
and only work on PDFs).

Steps for one grayscale page:
1. Ink mask (local threshold, so faint grey staff lines count).
2. Staff lines: long horizontal runs, grouped into staves of five evenly spaced lines.
3. Barlines per staff: vertical strokes that cover the staff from its top line to its
   bottom line AND stop there. Drum stems often cross the whole staff too (a kick below
   joined to a hi-hat above), but they keep going past the top or bottom line.
4. Bars: the spaces between barlines (double/final barlines count once), each cropped
   with room above and below the staff for cymbals and kick notes.

Every result is in the page image's pixel coordinates, in reading order. Detection is a
suggestion: the app shows the boxes for the user to fix before anything is transcribed.
"""

from dataclasses import dataclass

import cv2
import numpy as np

MAX_PAGES = 20
PDF_ZOOM = 2.0          # 144 dpi: staff spaces of ~10 px on a typical A4 page
MIN_LINE_FRACTION = 0.08  # a staff line spans at least this share of the page width
MIN_STAFF_SPACE = 4
MAX_STAFF_SPACE = 60


class SegmentError(ValueError):
    """The file cannot be read as a page of drum notation."""


@dataclass(frozen=True)
class Staff:
    lines: tuple            # five y centres, top to bottom
    x0: int
    x1: int

    @property
    def top(self):
        return self.lines[0]

    @property
    def bottom(self):
        return self.lines[4]

    @property
    def space(self):
        return (self.bottom - self.top) / 4


def ink_mask(gray):
    """Pixels clearly darker than the paper around them as 255, the rest 0.

    A local threshold, not a global one: Songsterr and Reflow draw staff lines and
    barlines in light grey (levels 118–208) that a global Otsu cut-off (140–166) drops,
    and photos have uneven lighting."""
    if gray.ndim != 2 or gray.size == 0:
        raise SegmentError('The page image is empty.')
    return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 31, 12)


def _horizontal_lines(ink):
    """(y centre, x0, x1) for every long horizontal line, top to bottom."""
    height, width = ink.shape
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(15, width // 30), 1))
    horizontal = cv2.morphologyEx(ink, cv2.MORPH_OPEN, kernel)
    lengths = (horizontal > 0).sum(axis=1)
    rows = np.flatnonzero(lengths >= max(15, width * MIN_LINE_FRACTION))
    lines = []
    for group in np.split(rows, np.flatnonzero(np.diff(rows) > 1) + 1):
        if group.size == 0:
            continue
        # A beam or bracket lying on a staff line thickens that row band. Keep the rows
        # that are nearly as long as the band's longest row: those are the line itself.
        if group.size > 3:
            longest = lengths[group].max()
            group = group[lengths[group] >= longest * 0.8]
        for part in np.split(group, np.flatnonzero(np.diff(group) > 1) + 1):
            if part.size == 0 or part.size > 4:   # still thick: a solid block, not a line
                continue
            xs = np.flatnonzero(horizontal[part[0]:part[-1] + 1].max(axis=0))
            lines.append((float(part.mean()), int(xs[0]), int(xs[-1])))
    return lines


def find_staves(ink):
    """Groups of five evenly spaced, overlapping horizontal lines, top to bottom."""
    lines = _horizontal_lines(ink)
    staves = []
    i = 0
    while i + 4 < len(lines):
        group = lines[i:i + 5]
        ys = [line[0] for line in group]
        gaps = np.diff(ys)
        # Middle of the five extents, so one line cut short by notation doesn't shorten the staff.
        x0 = sorted(line[1] for line in group)[2]
        x1 = sorted(line[2] for line in group)[2]
        even = MIN_STAFF_SPACE <= gaps.min() and gaps.max() <= MAX_STAFF_SPACE and \
            gaps.max() - gaps.min() <= max(2.0, 0.25 * gaps.mean())
        if even and x1 - x0 > 8 * gaps.mean():
            staves.append(Staff(tuple(ys), x0, x1))
            i += 5
        else:
            i += 1
    return staves


def _clean_end(ink, x0, x1, y_from, y_to):
    """True when the strip beyond a staff edge is mostly empty (a barline stops here)."""
    height = ink.shape[0]
    y_from, y_to = max(0, int(y_from)), min(height, int(y_to))
    if y_to <= y_from:
        return True
    strip = ink[y_from:y_to, max(0, x0):x1 + 1]
    return strip.size == 0 or (strip > 0).mean() < 0.35


def find_barlines(ink, staff):
    """x ranges of barlines on one staff, left to right; close pairs merged."""
    top, bottom, space = int(round(staff.top)), int(round(staff.bottom)), staff.space
    band = ink[max(0, top - 1):bottom + 2, staff.x0:staff.x1 + 1]
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(3, int((bottom - top) * 0.9))))
    vertical = cv2.morphologyEx(band, cv2.MORPH_OPEN, kernel)
    coverage = (vertical > 0).mean(axis=0)
    columns = np.flatnonzero(coverage >= 0.9)
    runs = []
    for group in np.split(columns, np.flatnonzero(np.diff(columns) > 1) + 1):
        if group.size == 0 or group.size > max(4, space * 0.8):
            continue
        a, b = int(group[0]) + staff.x0, int(group[-1]) + staff.x0
        gap = max(2, int(space * 0.3))
        reach = max(3, int(space * 0.9))
        if _clean_end(ink, a, b, top - gap - reach, top - gap) and \
                _clean_end(ink, a, b, bottom + gap + 1, bottom + gap + reach + 1):
            runs.append([a, b])
    # Strokes this close together are one boundary: double and final barlines, and time
    # signature digits (which also cover the staff) placed straight after a barline.
    merged = []
    for run in runs:
        if merged and run[0] - merged[-1][1] <= space * 3.5:
            merged[-1][1] = run[1]
        else:
            merged.append(run)
    return [tuple(run) for run in merged]


def find_bars(ink, staff):
    """(x0, x1) of each bar on a staff. The start of a staff counts as a boundary (for the
    clef and first bar); an unfinished stretch after the last barline counts only if it
    is wide enough to hold notes."""
    space = staff.space
    barlines = find_barlines(ink, staff)
    edges = []
    if not barlines or barlines[0][0] - staff.x0 > space * 2:
        edges.append((staff.x0, staff.x0))
    edges.extend(barlines)
    tail_open = not barlines or staff.x1 - barlines[-1][1] > space * 2
    if tail_open and staff.x1 - edges[-1][1] > space * 6:
        edges.append((staff.x1, staff.x1))
    bars = []
    for left, right in zip(edges, edges[1:]):
        if right[0] - left[1] >= space * 4:
            bars.append((left[1], right[0]))
    return bars


def segment_image(gray):
    """Systems and bar boxes for one grayscale page, in reading order."""
    ink = ink_mask(gray)
    height, width = ink.shape
    staves = find_staves(ink)
    systems = []
    for index, staff in enumerate(staves):
        above = staves[index - 1].bottom if index else None
        below = staves[index + 1].top if index + 1 < len(staves) else None
        reach = staff.space * 3.5
        y0 = staff.top - reach if above is None else max(staff.top - reach, (above + staff.top) / 2)
        y1 = staff.bottom + reach if below is None else min(staff.bottom + reach, (staff.bottom + below) / 2)
        y0, y1 = max(0, int(y0)), min(height, int(np.ceil(y1)))
        pad = max(2, int(staff.space * 0.3))
        bars = [{'x': max(0, a - pad), 'y': y0, 'width': min(width, b + pad + 1) - max(0, a - pad), 'height': y1 - y0}
                for a, b in find_bars(ink, staff)]
        systems.append({
            'staffTop': round(staff.top, 1), 'staffBottom': round(staff.bottom, 1),
            'lineSpacing': round(staff.space, 2), 'x0': staff.x0, 'x1': staff.x1, 'bars': bars,
        })
    return {'width': width, 'height': height, 'systems': systems}


def decode_image(data):
    """PNG/JPEG bytes → grayscale array."""
    array = np.frombuffer(data, dtype=np.uint8)
    gray = cv2.imdecode(array, cv2.IMREAD_GRAYSCALE)
    if gray is None:
        raise SegmentError('Choose a PNG, JPEG or PDF file.')
    return gray


def render_pdf(data, max_pages=MAX_PAGES, zoom=PDF_ZOOM):
    """PDF bytes → grayscale arrays, one per page (at most max_pages)."""
    import fitz  # PyMuPDF; only needed for PDFs
    try:
        document = fitz.open(stream=data, filetype='pdf')
    except Exception as error:  # PyMuPDF raises several types for damaged files
        raise SegmentError('This PDF could not be opened.') from error
    if document.page_count == 0:
        raise SegmentError('This PDF has no pages.')
    if document.page_count > max_pages:
        raise SegmentError(f'This PDF has {document.page_count} pages; import at most {max_pages} at a time.')
    pages = []
    for page in document:
        pixmap = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), colorspace=fitz.csGRAY)
        pages.append(np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width).copy())
    return pages


def load_pages(data):
    """File bytes (PDF, PNG or JPEG) → grayscale page arrays."""
    return render_pdf(data) if data[:5] == b'%PDF-' else [decode_image(data)]
