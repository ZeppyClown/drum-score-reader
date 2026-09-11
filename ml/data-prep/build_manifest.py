#!/usr/bin/env python3
"""Build the training manifest and explain every unpackaged raw label.

The split logic intentionally mirrors cell 5 of the training notebook: packaged image
names are sorted, grouped by their ``_barNNN`` prefix, shuffled with seed 42, then split
10% test / 10% validation / remaining train by song.

The reconciliation audit reruns bar detection without writing crops. This distinguishes
crop-count mismatches from songs that the current pipeline could package but that are not
present in the existing dataset.
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import re
from collections import Counter, defaultdict
from pathlib import Path

import crop_bars
import crop_bars_songsterr

ML_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = ML_DIR.parent
DEFAULT_DATA_DIR = ML_DIR / 'data'
DEFAULT_MANIFEST = ML_DIR / 'dataset_manifest.csv'
DEFAULT_RECONCILIATION = ML_DIR / 'data_reconciliation.csv'
DEFAULT_REPORT = ML_DIR / 'data_reconciliation.md'
BAR_SUFFIX = re.compile(r'^(?P<song>.+)_bar(?P<bar>\d+)$')

MANIFEST_FIELDS = [
    'split',
    'song',
    'source_song',
    'source_kind',
    'source_file',
    'bar_number',
    'image_path',
    'label_path',
    'source_label_path',
]

RECONCILIATION_FIELDS = [
    'reason',
    'song',
    'source_kind',
    'source_file',
    'bar_number',
    'source_label_path',
    'matched_pdf',
    'detected_crops',
    'source_labels',
    'packaged_song_bars',
]


def display_path(path: Path) -> str:
    """Use a repository-relative path when possible, otherwise an absolute path."""
    resolved = path.resolve()
    try:
        return resolved.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return resolved.as_posix()


def read_label(path: Path) -> dict:
    data = json.loads(path.read_text())
    song = data.get('song')
    bar = data.get('bar')
    if not isinstance(song, str) or not song:
        raise ValueError(f'label has no valid song: {path}')
    if not isinstance(bar, int) or bar < 1:
        raise ValueError(f'label has no valid bar number: {path}')
    return data


def index_labels(label_dir: Path) -> dict[tuple[str, int], Path]:
    labels: dict[tuple[str, int], Path] = {}
    for path in sorted(label_dir.glob('*.json')):
        data = read_label(path)
        key = (data['song'], data['bar'])
        if key in labels:
            raise ValueError(f'duplicate label identity {key!r}: {labels[key]} and {path}')
        labels[key] = path
    return labels


def index_sources(data_dir: Path) -> dict[str, tuple[str, Path]]:
    sources: dict[str, tuple[str, Path]] = {}
    source_specs = [
        ('gp5', data_dir / 'reflow_gp5', '*.gp5'),
        ('gp7', data_dir / 'songsterr' / 'guitar_pro', '*.gp'),
    ]
    for source_kind, source_dir, pattern in source_specs:
        for path in sorted(source_dir.glob(pattern)):
            if path.stem in sources:
                raise ValueError(
                    f'duplicate source stem {path.stem!r}: {sources[path.stem][1]} and {path}'
                )
            sources[path.stem] = (source_kind, path)
    return sources


def notebook_split_map(image_paths: list[Path]) -> dict[str, str]:
    """Return the exact song split produced by notebook cell 5."""
    songs: dict[str, list[Path]] = defaultdict(list)
    for image_path in sorted(image_paths):
        match = BAR_SUFFIX.match(image_path.stem)
        if not match:
            raise ValueError(f'image name has no _barNNN suffix: {image_path}')
        songs[match.group('song')].append(image_path)

    song_names = list(songs.keys())
    random.Random(42).shuffle(song_names)
    n_val = max(1, int(len(song_names) * 0.10))
    n_test = max(1, int(len(song_names) * 0.10))

    split_by_song = {}
    for song in song_names[:n_test]:
        split_by_song[song] = 'test'
    for song in song_names[n_test:n_test + n_val]:
        split_by_song[song] = 'validation'
    for song in song_names[n_test + n_val:]:
        split_by_song[song] = 'train'
    return split_by_song


def build_manifest_rows(
    data_dir: Path,
    raw_labels: dict[tuple[str, int], Path],
    packaged_labels: dict[tuple[str, int], Path],
    sources: dict[str, tuple[str, Path]],
) -> tuple[list[dict], Counter, Counter]:
    dataset_dir = data_dir / 'dataset'
    image_dir = dataset_dir / 'images'
    label_dir = dataset_dir / 'labels'
    image_paths = sorted(image_dir.glob('*.png'))
    label_paths = sorted(label_dir.glob('*.json'))

    image_by_stem = {path.stem: path for path in image_paths}
    label_by_stem = {path.stem: path for path in label_paths}
    if image_by_stem.keys() != label_by_stem.keys():
        missing_images = sorted(label_by_stem.keys() - image_by_stem.keys())
        missing_labels = sorted(image_by_stem.keys() - label_by_stem.keys())
        raise ValueError(
            'packaged image/label stems differ: '
            f'{len(missing_images)} labels lack images; '
            f'{len(missing_labels)} images lack labels'
        )

    split_by_song = notebook_split_map(image_paths)
    rows = []
    bars_by_split: Counter = Counter()
    songs_by_split: dict[str, set[str]] = defaultdict(set)

    for stem in sorted(image_by_stem):
        match = BAR_SUFFIX.match(stem)
        if not match:
            raise ValueError(f'packaged pair has no _barNNN suffix: {stem}')
        dataset_song = match.group('song')
        filename_bar = int(match.group('bar'))
        packaged_label_path = label_by_stem[stem]
        data = read_label(packaged_label_path)
        source_song = data['song']
        bar_number = data['bar']

        if filename_bar != bar_number:
            raise ValueError(
                f'filename/label bar mismatch for {packaged_label_path}: '
                f'{filename_bar} != {bar_number}'
            )
        source = sources.get(source_song)
        if source is None:
            raise ValueError(f'no source file for packaged label {packaged_label_path}')
        raw_label_path = raw_labels.get((source_song, bar_number))
        if raw_label_path is None:
            raise ValueError(f'no raw label for packaged label {packaged_label_path}')

        split = split_by_song[dataset_song]
        bars_by_split[split] += 1
        songs_by_split[split].add(dataset_song)
        rows.append({
            'split': split,
            'song': dataset_song,
            'source_song': source_song,
            'source_kind': source[0],
            'source_file': display_path(source[1]),
            'bar_number': bar_number,
            'image_path': display_path(image_by_stem[stem]),
            'label_path': display_path(packaged_label_path),
            'source_label_path': display_path(raw_label_path),
        })

    song_counts = Counter({split: len(songs) for split, songs in songs_by_split.items()})
    if len(rows) != len(packaged_labels):
        raise ValueError(
            f'manifest row count {len(rows)} does not match packaged identity count '
            f'{len(packaged_labels)}'
        )
    return rows, bars_by_split, song_counts


def audit_crop_pipeline(data_dir: Path, raw_label_dir: Path) -> dict[str, list[dict]]:
    """Run both crop detectors without writing and index their results by source song."""
    audits: dict[str, list[dict]] = defaultdict(list)
    dataset_dir = data_dir / 'dataset'

    for pdf_path in sorted((data_dir / 'reflow_pdf').glob('*.pdf')):
        label_paths = sorted(raw_label_dir.glob(f'{pdf_path.stem}_bar*.json'))
        if not label_paths:
            continue
        result = crop_bars.process_pdf(
            pdf_path,
            label_dir=raw_label_dir,
            output_dir=dataset_dir,
            dry_run=True,
            save_debug=False,
        )
        audits[pdf_path.stem].append({
            'pdf': pdf_path,
            'crops': result['crops'],
            'labels': result['labels'],
            'matches': result['ok'],
        })

    name_map = crop_bars_songsterr.build_name_map(raw_label_dir)
    for pdf_path in sorted((data_dir / 'songsterr' / 'pdf').glob('*.pdf')):
        label_paths = crop_bars_songsterr.find_labels_for_pdf(pdf_path, name_map)
        if not label_paths:
            continue
        source_songs = {read_label(path)['song'] for path in label_paths}
        result = crop_bars_songsterr.process_pdf(
            pdf_path,
            label_paths,
            output_dir=dataset_dir,
            dry_run=True,
            save_debug=False,
        )
        audit = {
            'pdf': pdf_path,
            'crops': result['crops'],
            'labels': result['labels'],
            'matches': result['ok'],
        }
        for source_song in source_songs:
            audits[source_song].append(audit)

    return audits


def reconciliation_reason(
    song: str,
    packaged_song_bars: int,
    audits: list[dict],
) -> str:
    if packaged_song_bars:
        if not audits:
            return 'packaged_dataset_incomplete_no_matching_pdf'
        if len(audits) > 1:
            return 'packaged_dataset_incomplete_ambiguous_pdf_match'
        if not audits[0]['matches']:
            return 'packaged_dataset_incomplete_crop_mismatch'
        return 'packaged_dataset_incomplete'
    if not audits:
        return 'no_matching_pdf'
    if len(audits) > 1:
        return 'ambiguous_pdf_match'
    if not audits[0]['matches']:
        return 'crop_label_count_mismatch'
    return 'packaged_dataset_not_regenerated'


def build_reconciliation_rows(
    raw_labels: dict[tuple[str, int], Path],
    packaged_labels: dict[tuple[str, int], Path],
    sources: dict[str, tuple[str, Path]],
    audits: dict[str, list[dict]],
) -> list[dict]:
    packaged_bars_by_song = Counter(song for song, _ in packaged_labels)
    rows = []
    for (song, bar_number), raw_label_path in sorted(raw_labels.items()):
        if (song, bar_number) in packaged_labels:
            continue
        source = sources.get(song)
        if source is None:
            raise ValueError(f'no source file for raw label {raw_label_path}')

        song_audits = audits.get(song, [])
        reason = reconciliation_reason(song, packaged_bars_by_song[song], song_audits)
        audit = song_audits[0] if len(song_audits) == 1 else None
        rows.append({
            'reason': reason,
            'song': song,
            'source_kind': source[0],
            'source_file': display_path(source[1]),
            'bar_number': bar_number,
            'source_label_path': display_path(raw_label_path),
            'matched_pdf': display_path(audit['pdf']) if audit else '',
            'detected_crops': audit['crops'] if audit else '',
            'source_labels': audit['labels'] if audit else '',
            'packaged_song_bars': packaged_bars_by_song[song],
        })
    return rows


def write_csv(path: Path, fieldnames: list[str], rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, lineterminator='\n')
        writer.writeheader()
        writer.writerows(rows)


def markdown_cell(value: object) -> str:
    return str(value).replace('|', '\\|').replace('\n', ' ')


def write_report(
    path: Path,
    manifest_rows: list[dict],
    reconciliation_rows: list[dict],
    bars_by_split: Counter,
    songs_by_split: Counter,
) -> None:
    reason_bars = Counter(row['reason'] for row in reconciliation_rows)
    reason_songs: dict[str, set[str]] = defaultdict(set)
    per_song: dict[str, dict] = {}
    for row in reconciliation_rows:
        reason_songs[row['reason']].add(row['song'])
        entry = per_song.setdefault(row['song'], {
            'source_kind': row['source_kind'],
            'raw_missing': 0,
            'packaged': row['packaged_song_bars'],
            'reason': row['reason'],
            'crops': row['detected_crops'],
            'labels': row['source_labels'],
            'pdf': row['matched_pdf'],
        })
        entry['raw_missing'] += 1

    reason_descriptions = {
        'crop_label_count_mismatch': (
            'A PDF matches the source song, but detected crop and source-label totals '
            'differ; the crop tool refuses to package the song.'
        ),
        'no_matching_pdf': (
            'No PDF is selected for this source song by the current Songsterr '
            'name-matching rules.'
        ),
        'packaged_dataset_not_regenerated': (
            'The current crop audit matches all source labels, but the song is absent '
            'from the existing packaged dataset.'
        ),
        'packaged_dataset_incomplete': (
            'The song is packaged, but specific raw-label identities are absent; the '
            'current crop audit matches the complete song.'
        ),
        'packaged_dataset_incomplete_no_matching_pdf': (
            'The song is partly packaged, but the current rules select no PDF; no cause '
            'is inferred.'
        ),
        'packaged_dataset_incomplete_ambiguous_pdf_match': (
            'The song is partly packaged, but the current rules select more than one '
            'PDF; no cause is inferred.'
        ),
        'packaged_dataset_incomplete_crop_mismatch': (
            'The song is partly packaged and its current crop/label totals differ; no '
            'single cause is inferred for its missing bars.'
        ),
        'ambiguous_pdf_match': (
            'More than one PDF maps to the same source song; no cause is inferred.'
        ),
    }

    lines = [
        '# Dataset Reconciliation',
        '',
        'Generated by `ml/data-prep/build_manifest.py` from the current files under '
        '`ml/data/`.',
        '',
        '## Packaged manifest',
        '',
        f'- Rows: {len(manifest_rows):,}',
        f'- Train: {songs_by_split["train"]} songs / {bars_by_split["train"]:,} bars',
        f'- Validation: {songs_by_split["validation"]} songs / '
        f'{bars_by_split["validation"]:,} bars',
        f'- Test: {songs_by_split["test"]} songs / {bars_by_split["test"]:,} bars',
        '',
        'The split reproduces notebook cell 5 with sorted image names and random seed 42.',
        '',
        '## Unpackaged-label summary',
        '',
        f'All {len(reconciliation_rows):,} raw labels outside the packaged dataset are '
        'accounted for below. These categories describe observable repository state; '
        'they do not claim that any exclusion was intentional.',
        '',
        '| Reason | Songs | Bars | Meaning |',
        '| --- | ---: | ---: | --- |',
    ]
    for reason in sorted(reason_bars):
        lines.append(
            f'| `{reason}` | {len(reason_songs[reason])} | {reason_bars[reason]:,} | '
            f'{reason_descriptions[reason]} |'
        )

    lines.extend([
        '',
        '## Affected songs',
        '',
        '| Source | Song | Packaged bars | Missing bars | Crop audit | Reason | PDF |',
        '| --- | --- | ---: | ---: | --- | --- | --- |',
    ])
    for song, entry in sorted(per_song.items()):
        crop_audit = (
            f'{entry["crops"]} crops / {entry["labels"]} labels'
            if entry['crops'] != '' else 'no unique match'
        )
        lines.append(
            '| '
            + ' | '.join(markdown_cell(value) for value in [
                entry['source_kind'],
                song,
                entry['packaged'],
                entry['raw_missing'],
                crop_audit,
                f'`{entry["reason"]}`',
                entry['pdf'] or '—',
            ])
            + ' |'
        )

    lines.extend([
        '',
        '## Interpretation',
        '',
        'The repository does not record a deliberate filtering policy for these labels. '
        'Accordingly, the reconciliation distinguishes mechanical causes and stale '
        'packaging state without labelling any omission intentional.',
        '',
        'Before full regeneration, fix the crop-count mismatches and decide how the '
        'unmatched Songsterr title should map. Then rebuild the packaged dataset and rerun '
        'this generator; the reconciliation CSV should become empty.',
        '',
    ])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('\n'.join(lines))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        '--data-dir', type=Path, default=DEFAULT_DATA_DIR,
        help=f'root data directory (default: {DEFAULT_DATA_DIR})',
    )
    ap.add_argument(
        '--manifest', type=Path, default=DEFAULT_MANIFEST,
        help=f'packaged manifest CSV (default: {DEFAULT_MANIFEST})',
    )
    ap.add_argument(
        '--reconciliation', type=Path, default=DEFAULT_RECONCILIATION,
        help=f'unpackaged-label CSV (default: {DEFAULT_RECONCILIATION})',
    )
    ap.add_argument(
        '--report', type=Path, default=DEFAULT_REPORT,
        help=f'reconciliation Markdown report (default: {DEFAULT_REPORT})',
    )
    args = ap.parse_args()

    data_dir = args.data_dir.expanduser().resolve()
    raw_label_dir = data_dir / 'labels'
    packaged_label_dir = data_dir / 'dataset' / 'labels'
    required_dirs = [
        raw_label_dir,
        packaged_label_dir,
        data_dir / 'dataset' / 'images',
        data_dir / 'reflow_gp5',
        data_dir / 'reflow_pdf',
        data_dir / 'songsterr' / 'guitar_pro',
        data_dir / 'songsterr' / 'pdf',
    ]
    for required_dir in required_dirs:
        if not required_dir.is_dir():
            ap.error(f'required directory does not exist: {required_dir}')

    raw_labels = index_labels(raw_label_dir)
    packaged_labels = index_labels(packaged_label_dir)
    sources = index_sources(data_dir)
    manifest_rows, bars_by_split, songs_by_split = build_manifest_rows(
        data_dir, raw_labels, packaged_labels, sources
    )
    audits = audit_crop_pipeline(data_dir, raw_label_dir)
    reconciliation_rows = build_reconciliation_rows(
        raw_labels, packaged_labels, sources, audits
    )

    manifest_path = args.manifest.expanduser().resolve()
    reconciliation_path = args.reconciliation.expanduser().resolve()
    report_path = args.report.expanduser().resolve()
    write_csv(manifest_path, MANIFEST_FIELDS, manifest_rows)
    write_csv(reconciliation_path, RECONCILIATION_FIELDS, reconciliation_rows)
    write_report(
        report_path,
        manifest_rows,
        reconciliation_rows,
        bars_by_split,
        songs_by_split,
    )

    reason_counts = Counter(row['reason'] for row in reconciliation_rows)
    print(f'Manifest: {len(manifest_rows):,} rows → {manifest_path}')
    print(
        'Splits: '
        f'{songs_by_split["train"]} train songs / {bars_by_split["train"]:,} bars; '
        f'{songs_by_split["validation"]} validation songs / '
        f'{bars_by_split["validation"]:,} bars; '
        f'{songs_by_split["test"]} test songs / {bars_by_split["test"]:,} bars'
    )
    print(f'Reconciliation: {len(reconciliation_rows):,} rows → {reconciliation_path}')
    for reason, count in sorted(reason_counts.items()):
        print(f'  {reason}: {count:,}')
    print(f'Report: {report_path}')


if __name__ == '__main__':
    main()
