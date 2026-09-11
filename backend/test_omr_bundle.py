import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
from PIL import Image

from bundle_fixture import bar_image, encode, make_bundle
from benchmark import decode as reference_decode
from omr_model import image_transform
from omr_bundle import (BundleError, ImageInputError, decode, load_bundle, predict,
                        preprocess, read_image)


def without_positions(notes):
    """The reference decoder has no positions; compare everything else."""
    return [{key: value for key, value in note.items() if key != 'position'} for note in notes]


class OMRBundleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        cls.root = make_bundle(cls.folder.name)
        cls.bundle = load_bundle(cls.root)
        cls.config = cls.bundle.config

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    def copy_bundle(self, folder, config):
        target = Path(folder)
        (target / 'omr.onnx').write_bytes((self.root / 'omr.onnx').read_bytes())
        (target / 'omr_config.json').write_text(json.dumps(config))
        return target

    def assertImageError(self, data, code):
        with self.assertRaises(ImageInputError) as caught:
            read_image(data)
        self.assertEqual(caught.exception.code, code)

    def test_preprocessing_matches_the_training_transform_exactly(self):
        for size in ((577, 143), (101, 146), (1600, 420)):
            image = bar_image(*size)
            expected = image_transform()(image).numpy()[None]
            actual = preprocess(image, self.config)
            self.assertEqual(actual.shape, (1, 3, 128, 384))
            np.testing.assert_allclose(actual, expected, rtol=0, atol=1e-6)

    def test_decoding_matches_the_reference_sigmoid_implementation(self):
        rng = np.random.default_rng(0)
        for _ in range(25):
            drums = rng.normal(0, 3, (1, 448)).astype(np.float32)
            durations = rng.normal(0, 1, (1, 320)).astype(np.float32)
            self.assertEqual(without_positions(decode(drums, durations, self.config)),
                             reference_decode(drums, durations, self.config))
        silent = np.zeros((1, 448), dtype=np.float32)
        self.assertEqual(decode(silent, np.zeros((1, 320), np.float32), self.config), [])

    def test_positions_keep_the_silence_between_hits(self):
        drums = np.full((1, 448), -5, dtype=np.float32)
        durations = np.zeros((1, 320), dtype=np.float32)
        drums[0, 0 * 14 + 2] = 5    # kick on beat 1
        drums[0, 16 * 14 + 1] = 5   # snare on beat 3, after a half bar of silence
        durations[0, 0 * 10 + 3] = 5
        durations[0, 16 * 10 + 1] = 5
        self.assertEqual(decode(drums, durations, self.config), [
            {'position': 0, 'duration': 'quarter', 'drums': ['kick']},
            {'position': 16, 'duration': 'half', 'drums': ['snare']},
        ])

    def test_png_and_jpeg_predictions_match_direct_inference(self):
        for image_format in ('PNG', 'JPEG'):
            data = encode(bar_image(), image_format)
            with Image.open(io.BytesIO(data)) as image:
                pixels = preprocess(image.convert('L'), self.config)
            outputs = self.bundle.session.run(None, {'image': pixels})
            self.assertEqual(without_positions(predict(self.bundle, data)),
                             reference_decode(*outputs, self.config))

    def test_phone_photo_orientation_is_applied(self):
        exif = Image.Exif()
        exif[0x0112] = 8  # Rotate 90 degrees clockwise to display correctly.
        image = read_image(encode(bar_image(600, 200), 'JPEG', exif=exif))
        self.assertEqual(image.size, (200, 600))

    def test_unsupported_and_unreadable_files_have_distinct_codes(self):
        self.assertImageError(b'%PDF-1.4 not an image', 'unsupported_file')
        self.assertImageError(encode(bar_image(), 'GIF'), 'unsupported_file')
        self.assertImageError(b'', 'invalid_image')
        self.assertImageError(encode(bar_image(), 'PNG')[:60], 'invalid_image')
        with mock.patch('omr_bundle.MAX_PIXELS', 1000):
            self.assertImageError(encode(bar_image(), 'PNG'), 'image_too_large')

    def test_bundle_problems_stop_loading_with_readable_messages(self):
        config = json.loads((self.root / 'omr_config.json').read_text())
        without_threshold = {k: v for k, v in config.items() if k != 'THRESHOLD'}
        cases = [
            ({**config, 'MODEL_SHA256': '0' * 64}, 'does not match MODEL_SHA256'),
            (without_threshold, 'missing: THRESHOLD'),
            ({**config, 'DRUMS': config['DRUMS'][:-1]}, 'do not match its declared counts'),
            ({**config, 'INPUT_NAME': 'pixels'}, 'do not match omr_config.json'),
            ({**config, 'IMG_W': 512}, 'input shape'),
        ]
        for changed, message in cases:
            with self.subTest(message=message), tempfile.TemporaryDirectory() as folder:
                with self.assertRaisesRegex(BundleError, message):
                    load_bundle(self.copy_bundle(folder, changed))
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(BundleError, 'Missing omr_config.json'):
                load_bundle(folder)
            (Path(folder) / 'omr_config.json').write_text(json.dumps(config))
            with self.assertRaisesRegex(BundleError, 'Missing omr.onnx'):
                load_bundle(folder)

    def test_invalid_model_output_is_rejected(self):
        with self.assertRaisesRegex(BundleError, 'shapes'):
            decode(np.zeros((1, 10), np.float32), np.zeros((1, 320), np.float32), self.config)
        broken = np.full((1, 448), np.nan, dtype=np.float32)
        with self.assertRaisesRegex(BundleError, 'non-finite'):
            decode(broken, np.zeros((1, 320), np.float32), self.config)


if __name__ == '__main__':
    unittest.main()
