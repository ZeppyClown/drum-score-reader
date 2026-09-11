"""Shared, strict target encoding for preparation and notebook training.

This is the existing 14-drum model contract, not a complete notation representation.
Rests have no positive drum targets or supervised duration; ghost dynamics are folded
into their base drum. Source parsers have already quantized beat positions to 32nds.
"""

import csv
import hashlib
import json
import math
from fractions import Fraction
from pathlib import Path

DRUMS = [
    'hi_hat_closed', 'snare', 'kick', 'ride', 'crash', 'hi_hat_open_half',
    'hi_hat_open_full', 'hi_hat_pedal', 'floor_tom_1', 'floor_tom_2',
    'tom_mid', 'tom_hi', 'ride_bell', 'snare_rim',
]
DURATIONS = [
    'whole', 'half', 'dotted_quarter', 'quarter', 'dotted_eighth', 'eighth',
    'sixteenth', 'thirty_second', 'triplet_eighth', 'triplet_sixteenth',
]
BEAT_GRID = [round(1 + i * 0.125, 3) for i in range(32)]
IMG_H, IMG_W = 128, 384
THRESHOLD = 0.5
DRUM_IDX = {drum: i for i, drum in enumerate(DRUMS)}
DUR_IDX = {duration: i for i, duration in enumerate(DURATIONS)}
SPLITS = ('train', 'validation', 'test')


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def label_issues(data):
    """Return every exclusion reason; never repair, round, or drop a hit."""
    reasons = set()
    if not isinstance(data.get('beats'), list):
        return ['invalid_beats']
    try:
        numerator, denominator = data['time_signature'].split('/')
        length = Fraction(int(numerator) * 4, int(denominator))
        if length <= 0:
            raise ValueError('non-positive measure')
        if length > 4:
            reasons.add('measure_beyond_grid')
    except (KeyError, AttributeError, ValueError, ZeroDivisionError):
        reasons.add('invalid_time_signature')
    if data.get('simile'):
        reasons.add('context_dependent_simile')
    seen = set()
    for event in data['beats']:
        if not isinstance(event, dict):
            reasons.add('invalid_event')
            continue
        drums = event.get('drums')
        if not isinstance(drums, list) or any(not isinstance(d, str) for d in drums):
            reasons.add('invalid_drums')
            continue
        if event.get('rest'):
            if drums:
                reasons.add('rest_with_drums')
            continue
        if not drums:
            reasons.add('empty_hit')
        if any(d.removesuffix('_ghost') not in DRUM_IDX for d in drums):
            reasons.add('unsupported_drum')
        if event.get('duration') not in DUR_IDX:
            reasons.add('unsupported_duration')
        if event.get('flam'):
            reasons.add('unsupported_flam')
        try:
            beat = float(event['beat'])
            if not math.isfinite(beat):
                raise ValueError('non-finite beat')
        except (KeyError, TypeError, ValueError):
            reasons.add('invalid_beat')
            continue
        if beat not in BEAT_GRID:
            reasons.add('beat_outside_grid' if beat < 1 or beat > BEAT_GRID[-1]
                        else 'beat_off_grid')
        if beat in seen:
            reasons.add('duplicate_onset')
        seen.add(beat)
    return sorted(reasons)


def encode_target(data):
    """Encode an accepted label; return flat drum targets and duration indices."""
    reasons = label_issues(data)
    if reasons:
        raise ValueError('Unsupported bar: ' + ', '.join(reasons))
    drums = [0.0] * (len(BEAT_GRID) * len(DRUMS))
    durations = [0] * len(BEAT_GRID)
    for event in data['beats']:
        if event.get('rest'):
            continue
        beat_index = BEAT_GRID.index(float(event['beat']))
        durations[beat_index] = DUR_IDX[event['duration']]
        for drum in event['drums']:
            drums[beat_index * len(DRUMS) + DRUM_IDX[drum.removesuffix('_ghost')]] = 1.0
    return drums, durations


def load_training_split(dataset_dir):
    """Verify the packaged subset and preserve its authoritative song membership.

    Both Colab and local execution consume this function. Extra images in the folder
    cannot enter training. Hash or contract changes require a rebuilt package.
    """
    root = Path(dataset_dir)
    report = json.loads((root / 'training_report.json').read_text())
    manifest = root / 'training_manifest.csv'
    if report.get('schema_version') != 1:
        raise ValueError('Unsupported training report schema')
    if sha256_file(manifest) != report['training_manifest_sha256']:
        raise ValueError('Training manifest hash mismatch')
    if sha256_file(Path(__file__)) != report['training_contract_sha256']:
        raise ValueError('Training contract hash mismatch; rebuild the training package')
    with manifest.open(newline='') as stream:
        rows = list(csv.DictReader(stream))
    if len(rows) != report['included_bars']:
        raise ValueError('Training manifest count mismatch')
    groups = {split: [] for split in SPLITS}
    membership = {}
    seen = set()
    for row in rows:
        split = row['split']
        if split not in groups:
            raise ValueError(f'Invalid split: {split}')
        for name in (row['song'], row['source_song']):
            if name in membership and membership[name] != split:
                raise ValueError(f'Song crosses splits: {name}')
            membership[name] = split
        image_name = Path(row['image_path']).name
        label_name = Path(row['label_path']).name
        if Path(image_name).stem != Path(label_name).stem or image_name in seen:
            raise ValueError('Duplicate or mismatched image/label identity')
        seen.add(image_name)
        image = root / 'images' / image_name
        label = root / 'labels' / label_name
        if sha256_file(image) != row['image_sha256'] or sha256_file(label) != row['label_sha256']:
            raise ValueError(f'Dataset content hash mismatch: {image_name}')
        data = json.loads(label.read_text())
        if data.get('song') != row['source_song'] or data.get('bar') != int(row['bar_number']):
            raise ValueError(f'Label identity mismatch: {label_name}')
        if label_issues(data):
            raise ValueError(f'Unsupported label in training manifest: {label_name}')
        groups[split].append((str(image), str(label), row['song']))
    if any(not items for items in groups.values()):
        raise ValueError('Every training/validation/test split must contain supported bars')
    return groups, report
