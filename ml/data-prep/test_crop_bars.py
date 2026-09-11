import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import crop_bars


class FindBarXsTests(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
