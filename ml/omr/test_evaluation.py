import json
import tempfile
import unittest
from pathlib import Path

import torch

from evaluate import metrics, verified_run


class EvaluationTests(unittest.TestCase):
    def test_grid_and_sequence_metrics_have_distinct_documented_meanings(self):
        target = torch.zeros(2, 32, 14, dtype=torch.bool)
        target[:, 0, 2] = True
        predicted = target.clone()
        predicted[0, 0, 2] = False
        predicted[0, 1, 2] = True  # Same sequence, different grid location.
        target_duration = torch.full((2, 32), 3)
        predicted_duration = target_duration.clone()
        predicted_duration[1, 0] = 5  # Same drum grid, wrong duration.
        result = metrics(predicted, predicted_duration, target, target_duration)
        self.assertEqual(result['sequence_accuracy'], 0.5)
        self.assertEqual(result['exact_bar_accuracy'], 0.5)
        self.assertEqual(result['duration_accuracy_at_hits'], 0.5)
        self.assertEqual(result['per_drum_f1']['kick'], 1.0)
        self.assertEqual(result['per_drum_counts']['kick']['support_bars'], 2)

    def test_rests_do_not_inflate_duration_accuracy(self):
        silence = torch.zeros(1, 448, dtype=torch.bool)
        rhythm = torch.zeros(1, 32, dtype=torch.long)
        result = metrics(silence, rhythm, silence, rhythm)
        self.assertEqual(result['sequence_accuracy'], 1.0)
        self.assertEqual(result['nonempty_prediction_bars'], 0)
        self.assertIsNone(result['duration_accuracy_at_hits'])
        json.dumps(result, allow_nan=False)

    def test_smoke_run_cannot_be_misreported_as_a_release(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'run_config.json').write_text(json.dumps(
                {'smoke_batches': 2, 'random_init': True}))
            with self.assertRaisesRegex(ValueError, 'cannot be evaluated as a release'):
                verified_run(root, root / 'dataset')

    def test_unfinished_run_is_reported_clearly(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'run_config.json').write_text(json.dumps(
                {'smoke_batches': 0, 'random_init': False}))
            with self.assertRaisesRegex(ValueError, 'Training has not finished'):
                verified_run(root, root / 'dataset')


if __name__ == '__main__':
    unittest.main()
