import json
import tempfile
import unittest
from pathlib import Path

from export import inference_config
from release import publish, verify_run
from training_contract import sha256_file

DATASET = 'a' * 64


def write(path, data):
    path.write_text(json.dumps(data))


def make_run(root):
    """A consistent completed, evaluated, exported, benchmarked run with stand-in weights."""
    run = root / 'run'
    run.mkdir()
    (run / 'finetune_best.pt').write_bytes(b'checkpoint')
    (run / 'omr.onnx').write_bytes(b'onnx model')
    checkpoint, onnx = sha256_file(run / 'finetune_best.pt'), sha256_file(run / 'omr.onnx')
    write(run / 'run_config.json', {'smoke_batches': 0, 'random_init': False,
                                    'training_manifest_sha256': DATASET})
    write(run / 'training_complete.json', {'checkpoint': 'finetune_best.pt',
                                           'checkpoint_sha256': checkpoint, 'smoke': False,
                                           'training_manifest_sha256': DATASET})
    write(run / 'history.json', [])
    write(run / 'eval_results.json', {'checkpoint_sha256': checkpoint,
                                      'dataset': {'training_manifest_sha256': DATASET}})
    write(run / 'export_results.json', {'checkpoint_sha256': checkpoint, 'onnx_sha256': onnx,
                                        'training_manifest_sha256': DATASET})
    write(run / 'omr_config.json', {**inference_config(), 'MODEL_SHA256': onnx})
    write(run / 'benchmark_results.json', {'model_sha256': onnx})
    return run


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.run = make_run(self.root)

    def tearDown(self):
        self.folder.cleanup()

    def assertRefused(self, pattern):
        with self.assertRaisesRegex(ValueError, pattern):
            verify_run(self.run)

    def test_consistent_run_publishes_weights_privately_and_evidence_for_git(self):
        files = verify_run(self.run)
        manifest = publish(files, 'baseline-v1', self.root / 'bundles', self.root / 'records')
        bundle, record = self.root / 'bundles' / 'baseline-v1', self.root / 'records' / 'baseline-v1'
        self.assertTrue((bundle / 'omr.onnx').exists())
        self.assertTrue((bundle / 'omr_finetuned.pt').exists())
        self.assertFalse(any(path.suffix in {'.pt', '.onnx'} for path in record.iterdir()))
        self.assertTrue((record / 'benchmark_results.json').exists())
        for folder in (bundle, record):
            self.assertEqual(json.loads((folder / 'release_manifest.json').read_text()), manifest)
        self.assertEqual(manifest['files']['omr.onnx']['sha256'], sha256_file(bundle / 'omr.onnx'))
        self.assertFalse(any(path.name.endswith('.tmp') for path in self.root.rglob('*')))

    def test_benchmark_of_a_different_onnx_file_is_refused(self):
        write(self.run / 'benchmark_results.json', {'model_sha256': 'other'})
        self.assertRefused('Benchmark measured a different ONNX file')

    def test_evaluation_of_a_different_checkpoint_is_refused(self):
        write(self.run / 'eval_results.json', {
            'checkpoint_sha256': 'other', 'dataset': {'training_manifest_sha256': DATASET}})
        self.assertRefused('Evaluation used a different checkpoint')

    def test_checkpoint_changed_after_training_is_refused(self):
        (self.run / 'finetune_best.pt').write_bytes(b'retrained')
        self.assertRefused('Checkpoint changed after training completed')

    def test_reexported_onnx_without_new_config_is_refused(self):
        (self.run / 'omr.onnx').write_bytes(b'different export')
        self.assertRefused('differs from the exported and configured model')

    def test_mixed_datasets_are_refused(self):
        write(self.run / 'eval_results.json', {
            'checkpoint_sha256': sha256_file(self.run / 'finetune_best.pt'),
            'dataset': {'training_manifest_sha256': 'b' * 64}})
        self.assertRefused('different training datasets')

    def test_smoke_run_and_missing_evidence_are_refused(self):
        (self.run / 'benchmark_results.json').unlink()
        self.assertRefused('Missing release evidence')
        write(self.run / 'run_config.json', {'smoke_batches': 2, 'random_init': True})
        self.assertRefused('cannot be released')

    def test_existing_or_invalid_release_names_are_refused(self):
        files = verify_run(self.run)
        publish(files, 'baseline-v1', self.root / 'bundles', self.root / 'records')
        with self.assertRaisesRegex(ValueError, 'already exists'):
            publish(files, 'baseline-v1', self.root / 'bundles', self.root / 'records')
        with self.assertRaisesRegex(ValueError, 'Release names'):
            publish(files, '../escape', self.root / 'bundles', self.root / 'records')


if __name__ == '__main__':
    unittest.main()
