import copy
import csv
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from prepare_training import prepare, select_rows
from training_contract import DRUM_IDX, encode_target, label_issues, load_training_split


def label(song='fixture', bar=1):
    return {'song': song, 'bar': bar, 'time_signature': '4/4', 'beats': [
        {'beat': '1', 'duration': 'eighth', 'drums': ['snare_ghost', 'kick']},
        {'beat': '1.5', 'duration': 'eighth', 'drums': [], 'rest': True},
    ]}


class ContractTests(unittest.TestCase):
    def test_simultaneous_and_ghost_hits_and_rest(self):
        drums, durations = encode_target(label())
        self.assertEqual(len(drums), 448)
        self.assertEqual(len(durations), 32)
        self.assertEqual(drums[DRUM_IDX['snare']], 1)
        self.assertEqual(drums[DRUM_IDX['kick']], 1)
        self.assertEqual(sum(drums), 2)

    def test_whole_bar_rejected_for_any_unsupported_hit(self):
        for field, value, reason in [
            ('drums', ['cowbell', 'kick'], 'unsupported_drum'),
            ('duration', 'dotted_sixteenth', 'unsupported_duration'),
            ('beat', '5', 'beat_outside_grid'),
            ('beat', '1.2', 'beat_off_grid'),
            ('beat', 'nan', 'invalid_beat'),
            ('flam', True, 'unsupported_flam'),
        ]:
            with self.subTest(reason=reason):
                data = label()
                data['beats'][0][field] = value
                self.assertIn(reason, label_issues(data))
                with self.assertRaises(ValueError):
                    encode_target(data)

    def test_colliding_events_are_rejected_instead_of_overwritten(self):
        data = label()
        data['beats'].append({'beat': '1', 'duration': 'quarter', 'drums': ['ride']})
        self.assertIn('duplicate_onset', label_issues(data))

    def test_long_measure_and_simile_are_explicitly_excluded(self):
        data = label()
        data['time_signature'] = '6/4'
        data['simile'] = True
        self.assertEqual(label_issues(data), ['context_dependent_simile', 'measure_beyond_grid'])


class SubsetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'images').mkdir()
        (self.root / 'labels').mkdir()
        self.rows = []
        for split in ('train', 'validation', 'test'):
            for bar in (1, 2):
                stem = f'{split}_bar{bar:03d}'
                data = label(split, bar)
                if bar == 2:
                    data['beats'][0]['duration'] = 'sixty_fourth'
                (self.root / 'images' / f'{stem}.png').write_bytes(b'fixture image')
                (self.root / 'labels' / f'{stem}.json').write_text(json.dumps(data))
                self.rows.append({'split': split, 'song': split, 'source_song': split,
                                  'bar_number': str(bar), 'image_path': f'images/{stem}.png',
                                  'label_path': f'labels/{stem}.json'})
        self.manifest = self.root / 'manifest.csv'
        with self.manifest.open('w', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=list(self.rows[0]))
            writer.writeheader()
            writer.writerows(self.rows)

    def test_subset_preserves_splits_and_records_each_exclusion(self):
        included, excluded = select_rows(self.rows, self.root)
        self.assertEqual(len(included), 3)
        self.assertEqual(len(excluded), 3)
        for row in included + excluded:
            self.assertEqual(row['split'], row['source_song'])
        self.assertTrue(all(row['reasons'] == 'unsupported_duration' for row in excluded))

    def test_source_song_leakage_is_rejected(self):
        rows = copy.deepcopy(self.rows)
        rows[0]['split'] = 'test'
        with self.assertRaisesRegex(ValueError, 'crosses splits'):
            select_rows(rows, self.root)

    def test_archive_roundtrip_detects_content_changes_and_is_deterministic(self):
        archive = self.root / 'training.zip'
        output = self.root / 'audit'
        report = prepare(self.manifest, self.root, output, archive)
        first = archive.read_bytes()
        self.assertEqual(report['included_bars'], 3)
        prepare(self.manifest, self.root, output, archive)
        self.assertEqual(first, archive.read_bytes())
        with zipfile.ZipFile(archive) as source:
            self.assertIsNone(source.testzip())
            self.assertEqual(len(source.namelist()), 11)
            source.extractall(self.root / 'extracted')
        dataset = self.root / 'extracted' / 'dataset'
        groups, _ = load_training_split(dataset)
        self.assertEqual({key: len(rows) for key, rows in groups.items()},
                         {'train': 1, 'validation': 1, 'test': 1})
        (dataset / 'labels' / 'train_bar001.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            load_training_split(dataset)


if __name__ == '__main__':
    unittest.main()
