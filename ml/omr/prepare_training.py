"""Select supported bars without moving any song between the existing splits.

python3 ml/omr/prepare_training.py
Writes versioned manifests/report under ml/ and an ignored ml/data/training.zip.
The full crop dataset and dataset.zip are preserved.
"""

import argparse
import csv
import io
import json
import zipfile
from collections import Counter
from pathlib import Path

from training_contract import SPLITS, label_issues, sha256_file

ML_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_DIR.parent
CONTRACT = Path(__file__).with_name('training_contract.py')


def csv_bytes(rows, fields):
    output = io.StringIO(newline='')
    writer = csv.DictWriter(output, fieldnames=fields, lineterminator='\n')
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode('utf-8')


def select_rows(rows, root):
    included, excluded = [], []
    membership, identities = {}, set()
    for row in rows:
        if row['split'] not in SPLITS:
            raise ValueError(f'Invalid split: {row["split"]}')
        for name in (row['song'], row['source_song']):
            if name in membership and membership[name] != row['split']:
                raise ValueError(f'Song crosses splits: {name}')
            membership[name] = row['split']
        image, label = root / row['image_path'], root / row['label_path']
        identity = (row['source_song'], int(row['bar_number']))
        if identity in identities or image.stem != label.stem:
            raise ValueError(f'Duplicate or mismatched pair: {image.name}')
        identities.add(identity)
        if not image.is_file():
            raise ValueError(f'Missing image: {image}')
        data = json.loads(label.read_text())
        if (data.get('song'), data.get('bar')) != identity:
            raise ValueError(f'Label identity mismatch: {label.name}')
        reasons = label_issues(data)
        if reasons:
            excluded.append({**row, 'reasons': ';'.join(reasons)})
        else:
            included.append({**row, 'image_sha256': sha256_file(image),
                             'label_sha256': sha256_file(label)})
    if any(not any(row['split'] == split for row in included) for split in SPLITS):
        raise ValueError('Every split must retain supported bars')
    return included, excluded


def prepare(manifest, root, output_dir, archive):
    with manifest.open(newline='') as source:
        reader = csv.DictReader(source)
        fields = reader.fieldnames
        rows = list(reader)
    included, excluded = select_rows(rows, root)
    output_dir.mkdir(parents=True, exist_ok=True)
    kept_file = output_dir / 'training_manifest.csv'
    excluded_file = output_dir / 'training_exclusions.csv'
    report_file = output_dir / 'training_report.json'
    kept_file.write_bytes(csv_bytes(included, fields + ['image_sha256', 'label_sha256']))
    excluded_file.write_bytes(csv_bytes(excluded, fields + ['reasons']))
    report = {
        'schema_version': 1,
        'policy': 'strict supported targets; preserve source manifest song splits',
        'source_manifest_sha256': sha256_file(manifest),
        'training_manifest_sha256': sha256_file(kept_file),
        'training_exclusions_sha256': sha256_file(excluded_file),
        'training_contract_sha256': sha256_file(CONTRACT),
        'source_bars': len(rows), 'included_bars': len(included),
        'excluded_bars': len(excluded),
        'exclusion_counts': dict(sorted(Counter(
            reason for row in excluded for reason in row['reasons'].split(';')
        ).items())),
        'splits': {split: {
            'source_bars': sum(row['split'] == split for row in rows),
            'included_bars': sum(row['split'] == split for row in included),
            'excluded_bars': sum(row['split'] == split for row in excluded),
            'included_songs': len({row['song'] for row in included if row['split'] == split}),
        } for split in SPLITS},
        'limitations': [
            'Rests encode silence; their durations are not supervised or emitted.',
            'Ghost dynamics fold into the corresponding base drum.',
            'Source parsers already quantized beat positions and merged voices; '
            'this audit validates the resulting labels, not original notation fidelity.',
            'Evaluation applies only to the supported subset, not all source bars.',
        ],
    }
    report_file.write_text(json.dumps(report, indent=2) + '\n')
    if archive:
        archive.parent.mkdir(parents=True, exist_ok=True)
        # A fixed timestamp/order makes identical inputs produce an identical archive.
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as target:
            files = [(path, f'dataset/{path.name}')
                     for path in (CONTRACT, kept_file, excluded_file, report_file)]
            for row in included:
                for kind, key in (('images', 'image_path'), ('labels', 'label_path')):
                    path = root / row[key]
                    files.append((path, f'dataset/{kind}/{path.name}'))
            seen = set()
            for path, name in files:
                if name in seen:
                    raise ValueError(f'Duplicate ZIP member: {name}')
                seen.add(name)
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                target.writestr(info, path.read_bytes())
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=ML_DIR / 'dataset_manifest.csv')
    parser.add_argument('--root', type=Path, default=REPO_ROOT)
    parser.add_argument('--output-dir', type=Path, default=ML_DIR)
    parser.add_argument('--archive', type=Path, default=ML_DIR / 'data' / 'training.zip')
    parser.add_argument('--no-archive', action='store_true')
    args = parser.parse_args()
    report = prepare(args.manifest, args.root, args.output_dir,
                     None if args.no_archive else args.archive)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
