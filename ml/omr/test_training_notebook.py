"""Regression checks against the training code embedded in the Colab notebook.

Run: python3 -m unittest discover -s ml/omr -p 'test_*.py'
The tests execute selected notebook statements without mounting Drive or training.
"""

import ast
import json
import unittest
from pathlib import Path

import torch


NOTEBOOK = Path(__file__).resolve().parents[1] / 'notebooks' / 'OMR Training After.ipynb'


def notebook_weights(targets):
    notebook = json.loads(NOTEBOOK.read_text())
    cell = next(cell for cell in notebook['cells'] if cell.get('id') == 'cell-9')
    assignments = {'pos', 'neg', 'pos_weight'}
    nodes = [
        node for node in ast.parse(''.join(cell['source'])).body
        if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id in assignments
                for target in node.targets)
    ]
    scope = {
        'all_drum_targets': targets,
        'train_lbls': list(range(len(targets))),
        'N_BEATS': 32,
        'DEVICE': 'cpu',
    }
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(NOTEBOOK), 'exec'), scope)
    return scope['pos_weight']


class PositiveWeightTests(unittest.TestCase):
    def test_balanced_output_has_unit_weight(self):
        targets = torch.zeros(8, 448)
        targets[:4, 0] = 1
        self.assertEqual(float(notebook_weights(targets)[0]), 1.0)

    def test_each_beat_drum_column_has_its_own_ratio(self):
        targets = torch.zeros(8, 448)
        targets[:2, 0] = 1
        targets[:6, 14] = 1  # Same drum, next grid position.
        weights = notebook_weights(targets)
        self.assertEqual(tuple(weights.shape), (448,))
        self.assertEqual(float(weights[0]), 3.0)
        self.assertAlmostEqual(float(weights[14]), 1 / 3, places=6)

    def test_absent_and_rare_columns_stay_finite_and_capped(self):
        targets = torch.zeros(100, 448)
        targets[0, 0] = 1
        weights = notebook_weights(targets)
        self.assertTrue(torch.isfinite(weights).all())
        self.assertEqual(float(weights[0]), 50.0)
        self.assertEqual(float(weights[1]), 50.0)


if __name__ == '__main__':
    unittest.main()
