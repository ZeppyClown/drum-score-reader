import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import torch

import tune_thresholds as study
from training_contract import DRUMS, THRESHOLD, sha256_file


class ThresholdExperimentTests(unittest.TestCase):
    def test_cli_defaults_and_separate_asset_overrides(self):
        with patch('sys.argv', ['tune_thresholds.py']), patch.object(study, 'experiment') as run:
            study.main()
            run.assert_called_once_with(
                study.WORKTREE / 'ml/data/training/dataset',
                study.WORKTREE / 'ml/data/releases/baseline-14drum-v1/omr_finetuned.pt',
                Path('/tmp/drumhub-thresholds.json'), 32)
        with tempfile.TemporaryDirectory(dir='/tmp') as folder:
            assets = Path(folder)
            dataset, checkpoint = assets / 'dataset', assets / 'release/model.pt'
            with patch('sys.argv', ['tune_thresholds.py', '--dataset', str(dataset),
                                   '--checkpoint', str(checkpoint)]), \
                 patch.object(study, 'experiment') as run:
                study.main()
                run.assert_called_once_with(dataset, checkpoint, Path('/tmp/drumhub-thresholds.json'), 32)

    def test_output_paths_refused_before_reading_assets(self):
        with tempfile.TemporaryDirectory(dir='/tmp') as folder:
            root = Path(folder).resolve()
            worktree, original = root / 'worktree', root / 'original'
            dataset, checkpoint = root / 'assets/dataset', root / 'assets/release/model.pt'
            worktree.mkdir()
            dataset.mkdir(parents=True)
            (worktree / 'input-link').symlink_to(dataset, target_is_directory=True)
            with patch.object(study, 'WORKTREE', worktree), \
                 patch.object(study.subprocess, 'check_output', return_value=str(original / '.git')), \
                 patch.object(study, 'verified_release', side_effect=RuntimeError('allowed')) as verify:
                for output in (dataset / 'result.json', checkpoint.parent / 'result.json',
                               original / 'result.json', worktree / 'ml/releases/other/result.json',
                               worktree / 'ml/data/releases/other/result.json',
                               worktree / 'input-link/result.json',
                               Path.home() / 'threshold-result.json'):
                    with self.subTest(output=output), self.assertRaisesRegex(ValueError, 'Output must be'):
                        study.experiment(dataset, checkpoint, output)
                verify.assert_not_called()
                for output in (root / 'result.json', worktree / 'result.json'):
                    with self.subTest(output=output), self.assertRaisesRegex(RuntimeError, 'allowed'):
                        study.experiment(dataset, checkpoint, output)
                # A normal checkout may write reports within its own repository.
                with patch.object(study.subprocess, 'check_output', return_value=str(worktree / '.git')):
                    with self.assertRaisesRegex(RuntimeError, 'allowed'):
                        study.experiment(dataset, checkpoint, worktree / 'result.json')
            self.assertFalse(any(root.rglob('result.json')))

    def test_validation_only_ties_mapping_single_test_pass_and_unchanged_config(self):
        def data(hi_hat, snare):
            probabilities = torch.full((2, 32, 14), 0.01)
            probabilities[:, 0, 0] = torch.tensor(hi_hat)
            probabilities[:, 0, 1] = torch.tensor(snare)
            probabilities[:, 0, 2] = torch.tensor([0.9, 0.1])
            target = torch.zeros_like(probabilities)
            target[0, 0, :3] = 1
            rhythm = torch.full((2, 32), 3)
            return probabilities, rhythm, target, rhythm

        validation = data([0.65, 0.55], [0.45, 0.35])
        test = data([0.55, 0.45], [0.65, 0.45])  # Test would favor 0.5 for both.
        config = study.WORKTREE / 'ml/releases/baseline-14drum-v1/omr_config.json'
        unchanged = [config, Path(study.__file__).with_name('training_contract.py'),
                     Path(study.__file__).with_name('evaluate.py')]
        before = {path: path.read_bytes() for path in unchanged}
        groups = {split: [('image', 'label', split)] * 2 for split in ('validation', 'test')}
        report = {'splits': {split: {'included_bars': 2, 'excluded_bars': 0}
                             for split in groups}, 'limitations': [], 'source_manifest_sha256': 'source'}
        calls = []

        def predict(model, items, batch_size, split):
            calls.append(split)
            self.assertIs(items, groups[split])
            if split == 'test':
                self.assertEqual(select.call_count, 1)
                self.assertIs(select.call_args.args[0], validation)
            return {'validation': validation, 'test': test}[split]

        with tempfile.TemporaryDirectory(dir='/tmp') as folder:
            root = Path(folder)
            dataset = root / 'dataset'
            dataset.mkdir()
            (dataset / 'training_report.json').write_text(json.dumps(report))
            output = root / 'result.json'
            with patch.object(study, 'verified_release', return_value=(None, groups, report, {})), \
                 patch.object(study, 'predict', side_effect=predict), \
                 patch.object(study, 'tune_validation', wraps=study.tune_validation) as select:
                result = study.experiment(dataset, root / 'release/model.pt', output)
            self.assertEqual(calls, ['validation', 'test'])
            self.assertEqual(result['test_inference_passes'], 1)
            thresholds = result['selection']['thresholds']
            self.assertEqual(thresholds['hi_hat_closed'], 0.6)
            self.assertEqual(thresholds['snare'], 0.4)
            self.assertTrue(all(thresholds[drum] == 0.5 for drum in DRUMS[2:]))
            self.assertEqual(result['validation']['tuned']['exact_bar_accuracy'], 1)
            self.assertEqual(result['test']['baseline']['exact_bar_accuracy'], 1)
            self.assertEqual(result['test']['tuned']['exact_bar_accuracy'], 0)
            self.assertEqual(result['test']['per_drum_tradeoffs']['hi_hat_closed']['recall_delta'], -1)
            self.assertEqual(result['test']['per_drum_tradeoffs']['snare']['false_positive_bars_delta'], 1)
            self.assertIsNone(result['test']['tuned']['per_drum_counts']['ride']['recall'])
            self.assertEqual(json.loads(output.read_text()), result)
            with self.assertRaises(FileExistsError):
                study.experiment(dataset, root / 'release/model.pt', output)

        # Reverse insertion order and put a probability exactly on its threshold.
        probabilities = torch.full((1, 448), 0.5)
        mapped = study.apply_thresholds(probabilities, dict(reversed(list(thresholds.items()))))
        self.assertFalse(mapped[:, :, 0].any())
        self.assertTrue(mapped[:, :, 1].all())
        self.assertFalse(mapped[:, :, 2:].any())
        self.assertEqual(THRESHOLD, 0.5)
        self.assertFalse(result['runtime_config_changed'])
        self.assertEqual(before, {path: path.read_bytes() for path in unchanged})

    def test_release_hash_and_training_provenance_mismatches_refused_before_inference(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            checkpoint = root / 'model.pt'
            checkpoint.write_bytes(b'checkpoint')
            config = {'smoke_batches': 0, 'random_init': False,
                      'training_manifest_sha256': 'trained',
                      'training_contract_sha256': 'contract', 'model_source_sha256': 'model'}
            evidence = {'run_config.json': config,
                        'training_complete.json': {'smoke': False,
                            'checkpoint_sha256': sha256_file(checkpoint),
                            'training_manifest_sha256': 'trained'},
                        'omr_config.json': {'DRUMS': DRUMS, 'THRESHOLD': THRESHOLD}}
            for name, content in evidence.items():
                (root / name).write_text(json.dumps(content))
            manifest = {'files': {path.name: {'sha256': sha256_file(path),
                                             'bytes': path.stat().st_size}
                                  for path in (checkpoint, *(root / name for name in evidence))}}
            (root / 'release_manifest.json').write_text(json.dumps(manifest))
            with patch.object(study, 'DrumOMRModel') as model:
                checkpoint.write_bytes(b'changed')
                with self.assertRaisesRegex(ValueError, 'Release manifest mismatch: model.pt'):
                    study.verified_release(checkpoint, root / 'dataset')
                checkpoint.write_bytes(b'checkpoint')
                with patch.object(study, 'load_training_split', return_value=(
                        {}, {**config, 'training_manifest_sha256': 'different'})):
                    with self.assertRaisesRegex(ValueError, 'Training split provenance mismatch'):
                        study.verified_release(checkpoint, root / 'dataset')
                model.assert_not_called()


if __name__ == '__main__':
    unittest.main()
