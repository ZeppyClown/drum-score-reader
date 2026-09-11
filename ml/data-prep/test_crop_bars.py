import unittest
from pathlib import Path
import sys
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))
import crop_bars


class FindBarXsTests(unittest.TestCase):
    def test_extracts_narrow_staff_segment(self):
        wide_items = [
            (
                'l',
                SimpleNamespace(x=53.15, y=y),
                SimpleNamespace(x=479.06, y=y),
            )
            for y in (311.30, 316.26, 321.22, 326.18, 331.14)
        ]
        narrow_items = [
            (
                'l',
                SimpleNamespace(x=479.06, y=y),
                SimpleNamespace(x=517.36, y=y),
            )
            for y in (311.30, 316.26, 321.22, 326.18, 331.14)
        ]
        page = SimpleNamespace(
            get_drawings=lambda: [{'items': wide_items + narrow_items}],
        )

        hlines = crop_bars.extract_hlines(page)
        rows = crop_bars.find_staff_rows(hlines)

        self.assertEqual(rows, [(311.30, 331.14)])
        self.assertEqual(
            crop_bars.find_bar_xs(hlines, *rows[0]),
            [53.0, 479.0, 517.5],
        )

    def test_short_beam_chains_do_not_hide_staff_line(self):
        staff_lines = [
            {'y': y, 'x0': 53.15, 'x1': 566.93, 'width': 513.78}
            for y in (142.44, 147.40, 152.36, 157.32, 162.28)
        ]
        long_beams = [
            {'y': y, 'x0': 111.47, 'x1': 217.06, 'width': 105.59}
            for y in (128.80, 131.28, 133.76, 136.24, 138.72, 141.20)
        ]
        short_beams = [
            {'y': y, 'x0': 111.47, 'x1': 146.90, 'width': 35.43}
            for y in (131.99, 134.47, 136.95, 139.43, 141.91, 144.39)
        ]

        rows = crop_bars.find_staff_rows(staff_lines + long_beams + short_beams)

        self.assertEqual(rows, [(128.80, 162.28)])

    def test_ignores_fourfold_non_staff_endpoint(self):
        staff_lines = [
            {'y': y, 'x0': 53.0, 'x1': 567.0, 'width': 514.0}
            for y in (0.0, 5.0, 10.0, 15.0, 20.0)
        ]
        triplet_lines = [
            {'y': y, 'x0': x0, 'x1': 454.0, 'width': 454.0 - x0}
            for y, x0 in zip((2.0, 7.0, 12.0, 17.0), (300.0, 310.0, 320.0, 330.0))
        ]

        bar_xs = crop_bars.find_bar_xs(
            staff_lines + triplet_lines,
            top_y=0.0,
            bot_y=20.0,
        )

        self.assertEqual(bar_xs, [53.0, 567.0])

    def test_ignores_dense_beam_endpoints(self):
        staff_lines = [
            {'y': y, 'x0': 53.0, 'x1': 567.0, 'width': 514.0}
            for y in (137.48, 142.44, 147.40, 152.36, 157.32)
        ]
        beam_lines = [
            {'y': y, 'x0': x0, 'x1': 519.0, 'width': 519.0 - x0}
            for y, x0 in (
                (128.80, 137.7),
                (131.28, 137.7),
                (131.99, 432.1),
                (134.47, 432.1),
                (135.18, 432.1),
                (137.66, 432.1),
            )
        ]

        bar_xs = crop_bars.find_bar_xs(
            staff_lines + beam_lines,
            top_y=128.80,
            bot_y=157.32,
        )

        self.assertEqual(bar_xs, [53.0, 567.0])


if __name__ == '__main__':
    unittest.main()
