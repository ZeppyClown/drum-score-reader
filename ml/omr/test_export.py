import json
import tempfile
import unittest
from pathlib import Path

import torch
from PIL import Image, ImageDraw

import numpy as np

from export import (PARITY_TOLERANCE, check_parity, check_size, evaluated_checkpoint,
                    export_onnx, inference_config, logit_tolerance, refuse_existing,
                    verify_export)
from omr_model import DrumOMRModel
from training_contract import DRUMS, DURATIONS, sha256_file


def staff_image(path, shift):
    image = Image.new('L', (600, 200), 255)
    draw = ImageDraw.Draw(image)
    for line in range(5):
        draw.line((10, 60 + line * 16, 590, 60 + line * 16), fill=0, width=2)
    for note in range(4):
        x = 60 + note * 130 + shift
        draw.ellipse((x, 90, x + 16, 102), fill=0)
    image.save(path)
    return str(path)


class ExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.manual_seed(0)
        cls.folder = tempfile.TemporaryDirectory()
        cls.root = Path(cls.folder.name)
        cls.model = DrumOMRModel(pretrained=False).eval()
        cls.onnx = cls.root / 'omr.onnx'
        export_onnx(cls.model, cls.onnx)
        cls.images = [staff_image(cls.root / f'bar_{i}.png', i * 7) for i in range(3)]

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    def test_config_matches_training_contract_and_transform(self):
        config = inference_config()
        self.assertEqual(config['DRUMS'], DRUMS)
        self.assertEqual(config['DURATIONS'], DURATIONS)
        self.assertEqual(config['N_BEATS'] * config['N_DRUMS'], 448)
        self.assertEqual(config['N_BEATS'] * config['N_DURATIONS'], 320)
        self.assertEqual((config['IMG_H'], config['IMG_W']), (128, 384))
        self.assertEqual(config['IMAGENET_MEAN'], [0.485, 0.456, 0.406])
        json.dumps(config, allow_nan=False)

    def test_file_on_disk_matches_pytorch_logits_and_sequences(self):
        result = verify_export(self.model, self.onnx, self.images)
        self.assertEqual(result['size']['parameters'], 2_305_056)
        for parity in result['parity'].values():
            self.assertLessEqual(parity['max_abs_logit_diff'], parity['allowed_logit_diff'])
            self.assertEqual(parity['decision_flips'], 0)
            self.assertEqual(parity['identical_sequences'], parity['bars'])
        self.assertEqual(result['parity']['held_out_bars']['bars'], 3)

    def test_the_allowed_difference_follows_the_size_of_the_logits(self):
        small = [np.zeros((1, 448), dtype=np.float32)]
        large = [np.full((1, 448), -30, dtype=np.float32)]
        self.assertEqual(logit_tolerance(small), PARITY_TOLERANCE)
        self.assertEqual(logit_tolerance(large), PARITY_TOLERANCE * 30)

    def test_a_flipped_hit_decision_fails_even_when_the_difference_is_tiny(self):
        config = inference_config()
        images = torch.zeros(1, 3, config['IMG_H'], config['IMG_W'])
        with torch.inference_mode():
            drums, durations = (output.numpy() for output in self.model(images))

        class NudgedSession:
            """Returns PyTorch's own logits with one slot nudged across the threshold."""

            def run(self, _names, _inputs):
                nudged = drums.copy()
                slot = int(np.abs(nudged[0]).argmin())
                nudged[0, slot] = -nudged[0, slot] + np.sign(nudged[0, slot] or 1) * 1e-6
                return [nudged, durations]

        with self.assertRaisesRegex(ValueError, 'hit/no-hit decisions'):
            check_parity(self.model, NudgedSession(), [images], config)

    def test_truncated_export_is_rejected(self):
        tiny = self.root / 'tiny.onnx'
        tiny.write_bytes(self.onnx.read_bytes()[:283_541])
        with self.assertRaisesRegex(ValueError, 'outside'):
            check_size(tiny, self.model)

    def test_export_of_different_weights_fails_parity(self):
        other = DrumOMRModel(pretrained=False).eval()
        with self.assertRaisesRegex(ValueError, 'differs from PyTorch'):
            verify_export(other, self.onnx, self.images)

    def test_no_held_out_bars_is_refused(self):
        with self.assertRaisesRegex(ValueError, 'No held-out bar images'):
            verify_export(self.model, self.onnx, [])

    def test_unevaluated_or_mismatched_checkpoint_is_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            run = Path(folder)
            checkpoint = run / 'finetune_best.pt'
            checkpoint.write_bytes(b'weights')
            with self.assertRaisesRegex(ValueError, 'run evaluate.py'):
                evaluated_checkpoint(run, checkpoint)
            (run / 'eval_results.json').write_text(json.dumps({'checkpoint_sha256': 'other'}))
            with self.assertRaisesRegex(ValueError, 'different checkpoint'):
                evaluated_checkpoint(run, checkpoint)
            (run / 'eval_results.json').write_text(json.dumps(
                {'checkpoint_sha256': sha256_file(checkpoint)}))
            self.assertIn('checkpoint_sha256', evaluated_checkpoint(run, checkpoint))

    def test_existing_release_artifacts_are_never_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            run = Path(folder)
            refuse_existing(run)
            (run / 'omr_config.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'already exist'):
                refuse_existing(run)


if __name__ == '__main__':
    unittest.main()
