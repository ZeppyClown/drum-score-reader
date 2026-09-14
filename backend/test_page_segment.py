"""Page segmentation tests on drawn pages whose staves and bars are known exactly."""

import unittest

import cv2
import numpy as np

import page_segment as seg

WHITE, INK = 255, 0


def page(width=1200, height=900):
    return np.full((height, width), WHITE, np.uint8)


def draw_staff(img, top, x0, x1, space=10):
    for i in range(5):
        cv2.line(img, (x0, top + i * space), (x1, top + i * space), INK, 1)
    return top, top + 4 * space


def barline(img, x, top, bottom, width=1):
    cv2.rectangle(img, (x, top), (x + width - 1, bottom), INK, -1)


def note(img, x, y, stem_to):
    cv2.ellipse(img, (x, y), (6, 4), -20, 0, 360, INK, -1)
    cv2.line(img, (x + 5, y), (x + 5, stem_to), INK, 1)


def drum_staff(img, top, x0, x1, bar_xs, space=10, crossing_stems=True):
    """A staff with barlines at bar_xs and, in each bar, kick-to-hi-hat stems that cross
    the whole staff (the case that must not look like a barline)."""
    t, b = draw_staff(img, top, x0, x1, space)
    for x in bar_xs:
        barline(img, x, t, b)
    edges = [x0, *bar_xs]
    for left, right in zip(edges, edges[1:]):
        for k in range(1, 4):
            x = left + (right - left) * k // 4
            if crossing_stems:
                note(img, x, b + space // 2, t - 2 * space)     # kick below, stem up past the top line
                cv2.drawMarker(img, (x + 5, t - 2 * space), INK, cv2.MARKER_TILTED_CROSS, 8)
            note(img, x + 12, t + space * 2 + space // 2, t - space)  # snare, stem up past the top line
    return t, b


class StaffTests(unittest.TestCase):
    def test_finds_five_line_staves_and_ignores_text_and_beams(self):
        img = page()
        drum_staff(img, 100, 50, 1150, [300, 600, 900, 1150])
        drum_staff(img, 400, 50, 1150, [400, 800, 1150])
        cv2.putText(img, 'Chorus 2', (60, 60), cv2.FONT_HERSHEY_SIMPLEX, 1, INK, 2)
        cv2.rectangle(img, (320, 330), (560, 334), INK, -1)  # a thick beam
        staves = seg.find_staves(seg.ink_mask(img))
        self.assertEqual([round(s.top) for s in staves], [100, 400])
        self.assertAlmostEqual(staves[0].space, 10)

    def test_empty_or_blank_page_has_no_staves(self):
        self.assertEqual(seg.segment_image(page())['systems'], [])
        with self.assertRaises(seg.SegmentError):
            seg.ink_mask(np.zeros((0, 0), np.uint8))


class BarTests(unittest.TestCase):
    def test_crossing_stems_are_not_barlines(self):
        img = page()
        drum_staff(img, 200, 50, 1150, [330, 610, 890, 1150])
        (system,) = seg.segment_image(img)['systems']
        self.assertEqual(len(system['bars']), 4)
        lefts = [bar['x'] for bar in system['bars']]
        self.assertEqual(lefts, sorted(lefts))

    def test_double_and_thick_final_barlines_count_once(self):
        img = page()
        t, b = drum_staff(img, 200, 50, 1150, [400, 1140], crossing_stems=False)
        barline(img, 406, t, b)             # double barline next to 400
        barline(img, 1146, t, b, width=4)   # thick final barline
        (system,) = seg.segment_image(img)['systems']
        self.assertEqual(len(system['bars']), 2)

    def test_open_tail_counts_as_a_bar_only_when_wide_enough(self):
        wide, narrow = page(), page()
        drum_staff(wide, 200, 50, 1150, [400, 800], crossing_stems=False)
        drum_staff(narrow, 200, 50, 1150, [400, 800, 1130], crossing_stems=False)
        self.assertEqual(len(seg.segment_image(wide)['systems'][0]['bars']), 3)
        self.assertEqual(len(seg.segment_image(narrow)['systems'][0]['bars']), 3)

    def test_boxes_leave_room_above_and_below_without_overlapping_the_next_system(self):
        img = page()
        drum_staff(img, 100, 50, 1150, [600, 1150])
        drum_staff(img, 190, 50, 1150, [600, 1150])
        first, second = seg.segment_image(img)['systems']
        self.assertLess(first['bars'][0]['y'], 100 - 20)
        self.assertLessEqual(first['bars'][0]['y'] + first['bars'][0]['height'], second['bars'][0]['y'] + 1)

    def test_reading_order_is_system_by_system_left_to_right(self):
        img = page()
        drum_staff(img, 100, 50, 1150, [400, 800, 1150])
        drum_staff(img, 400, 50, 1150, [600, 1150])
        result = seg.segment_image(img)
        order = [(round(s['staffTop']), bar['x']) for s in result['systems'] for bar in s['bars']]
        self.assertEqual(order, sorted(order))
        self.assertEqual([len(s['bars']) for s in result['systems']], [3, 2])


class FileTests(unittest.TestCase):
    def test_png_and_pdf_load_as_pages(self):
        img = page(600, 300)
        drum_staff(img, 100, 20, 580, [300, 580], crossing_stems=False)
        ok, png = cv2.imencode('.png', img)
        self.assertTrue(ok)
        (loaded,) = seg.load_pages(png.tobytes())
        self.assertEqual(loaded.shape, (300, 600))
        import fitz
        document = fitz.open()
        pdf_page = document.new_page(width=300, height=150)
        for i in range(5):
            pdf_page.draw_line((10, 40 + i * 5), (290, 40 + i * 5))
        for x in (10, 150, 290):
            pdf_page.draw_line((x, 40), (x, 60))
        pages = seg.load_pages(document.tobytes())
        self.assertEqual(len(pages), 1)
        self.assertEqual(len(seg.segment_image(pages[0])['systems'][0]['bars']), 2)

    def test_unreadable_files_are_refused(self):
        with self.assertRaises(seg.SegmentError):
            seg.load_pages(b'not an image')
        with self.assertRaises(seg.SegmentError):
            seg.load_pages(b'%PDF-1.4 broken')


if __name__ == '__main__':
    unittest.main()
