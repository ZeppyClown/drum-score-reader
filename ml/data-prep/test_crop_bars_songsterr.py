import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import crop_bars_songsterr


class CropBarsTests(unittest.TestCase):
    def test_joins_measures_wrapped_across_staff_rows(self):
        gray = np.full((40, 100), 255, dtype=np.uint8)
        gray[0:4, :] = 10
        gray[10:14, :] = 20
        gray[20:24, :] = 30
        gray[30:34, :] = 40
        staff_rows = [(0, 4), (10, 14), (20, 24), (30, 34)]
        bar_xs_per_row = [[0], [100], [0], [80, 90, 95, 100]]
        staff_spans = [(0, 100)] * 4

        with (
            patch.object(crop_bars_songsterr, 'SCALE', 1),
            patch.object(crop_bars_songsterr, 'PAD_X', 0),
            patch.object(crop_bars_songsterr, 'PAD_Y', 0),
        ):
            crops = crop_bars_songsterr.crop_bars(
                gray,
                staff_rows,
                bar_xs_per_row,
                staff_spans,
            )

        self.assertEqual(len(crops), 5)
        self.assertEqual(crops[0].shape, (4, 200))
        np.testing.assert_array_equal(crops[0][:, :100], 10)
        np.testing.assert_array_equal(crops[0][:, 100:], 20)
        self.assertEqual(crops[1].shape, (4, 180))
        np.testing.assert_array_equal(crops[1][:, :100], 30)
        np.testing.assert_array_equal(crops[1][:, 100:], 40)
        self.assertEqual([crop.shape[1] for crop in crops[2:]], [10, 5, 5])


if __name__ == '__main__':
    unittest.main()
