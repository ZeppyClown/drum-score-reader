"""Turn the strict training subset into image → text pairs for fine-tuning a vision model.

Reads ml/training_manifest.csv (same bars, same song-level split as the MobileNet
baseline, so results are comparable) and writes one JSONL file per split:

    {"image": "<repo-relative png>", "target": "0:eighth:hi_hat_closed+kick 4:eighth:hi_hat_closed ..."}

Target text is one `slot:duration:drums` item per hit, in time order. `slot` is the
32nd-note position 0–31, exactly the `position` the app's import already expects.
A bar with no hits is the single word `rest`.

    python3 ml/omr/prepare_finetune.py --train-bars 3000 --zip

--zip also writes ml/data/finetune.zip (the JSONL, the bar images they name, the 45
app-drawn benchmark bars, and this script with its contract) for upload to
MyDrive/unsloth/finetune.zip.

If ml/data-prep/render_app_bars.cjs has been run, the bars it redrew in DrumHub's own
notation are written to train_app.jsonl and packed too, as a second drawing style.

--alibaba also writes ml/data/finetune_alibaba.zip, the training bars in Alibaba Cloud
Model Studio's Qwen-VL fine-tuning layout: data.jsonl at the root beside the images.
"""

import argparse
import csv
import io
import json
import random
import zipfile
from collections import defaultdict
from pathlib import Path

from training_contract import BEAT_GRID, DRUM_IDX, DRUMS, DUR_IDX, label_issues

ROOT = Path(__file__).resolve().parents[2]
EXCLUDED = Path(__file__).with_name('excluded_bars.txt')  # one song name or image file name per line
PROMPT = ('Transcribe this single 4/4 bar of drum notation. Write one item per hit in time '
          'order as slot:duration:drums, where slot is the 32nd-note position 0-31 and drums '
          'are joined with +. Write only the items, separated by spaces. If the bar has no '
          'hits, write rest.')
# ponytail: full drum and duration names keep one vocabulary with the app; switch to
# short codes only if output length measurably hurts speed or accuracy.


def encode_text(label):
    reasons = label_issues(label)
    if reasons:
        raise ValueError('Unsupported bar: ' + ', '.join(reasons))
    items = []
    for event in label['beats']:
        if event.get('rest'):
            continue
        slot = BEAT_GRID.index(float(event['beat']))
        drums = sorted({d.removesuffix('_ghost') for d in event['drums']}, key=DRUM_IDX.get)
        items.append((slot, f"{slot}:{event['duration']}:{'+'.join(drums)}"))
    return ' '.join(text for _, text in sorted(items)) or 'rest'


def decode_text(text):
    """Model output → the /predict note list. Raises ValueError on anything malformed."""
    text = text.strip()
    if text == 'rest':
        return []
    notes, last = [], -1
    for item in text.split():
        parts = item.split(':')
        if len(parts) != 3:
            raise ValueError(f'Bad item: {item!r}')
        slot, duration, drums = int(parts[0]), parts[1], parts[2].split('+')
        if not 0 <= slot < len(BEAT_GRID) or slot <= last:
            raise ValueError(f'Bad or out-of-order slot: {item!r}')
        if duration not in DUR_IDX or not drums or any(d not in DRUM_IDX for d in drums):
            raise ValueError(f'Unknown duration or drum: {item!r}')
        if len(set(drums)) != len(drums):
            raise ValueError(f'Repeated drum: {item!r}')
        notes.append({'position': slot, 'duration': duration, 'drums': drums})
        last = slot
    return notes


def sample_train(rows, count, seed):
    """Take `count` bars spread across songs, so no single long song dominates."""
    if count is None or count >= len(rows):
        return rows
    by_song = defaultdict(list)
    for row in rows:
        by_song[row['song']].append(row)
    rng = random.Random(seed)
    for bars in by_song.values():
        rng.shuffle(bars)
    picked, songs = [], sorted(by_song)
    while len(picked) < count:
        for song in songs:
            if by_song[song] and len(picked) < count:
                picked.append(by_song[song].pop())
    return sorted(picked, key=lambda r: (r['song'], int(r['bar_number'])))


def write_app_style(output_dir):
    """App-drawn bars (render_app_bars.cjs) → train_app.jsonl. Returns the files to pack."""
    manifest = ROOT / 'ml' / 'data' / 'finetune_app' / 'manifest.jsonl'
    if not manifest.is_file():
        return []
    packed, lines = [], []
    with manifest.open() as source:
        for line in source:
            row = json.loads(line)
            target = ' '.join(f"{n['position']}:{n['duration']}:{'+'.join(sorted(n['drums'], key=DRUM_IDX.get))}"
                              for n in row['notes']) or 'rest'
            decoded = [(n['position'], n['duration'], set(n['drums'])) for n in decode_text(target)]
            assert decoded == [(n['position'], n['duration'], set(n['drums'])) for n in row['notes']], row['image']
            if not (ROOT / row['image']).is_file():
                raise FileNotFoundError(row['image'])
            lines.append(json.dumps({'image': row['image'], 'target': target, 'song': row['song']}))
            packed.append(ROOT / row['image'])
    (output_dir / 'train_app.jsonl').write_text('\n'.join(lines) + '\n')
    print(f'train_app: {len(lines)} bars redrawn in DrumHub notation')
    return packed + [output_dir / 'train_app.jsonl']


ALIBABA_MAX_SIDE = 1024  # Model Studio rejects images wider or taller than this


def write_alibaba_zip(train_jsonl, zip_path):
    """Model Studio wants plain ASCII file names, so image N of train.jsonl becomes bar_N.png."""
    from PIL import Image  # only this export needs Pillow

    shrunk = 0
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_STORED) as archive, train_jsonl.open() as source:
        lines = []
        for index, line in enumerate(source):
            row = json.loads(line)
            name = f'bar_{index:05d}.png'
            data = (ROOT / row['image']).read_bytes()
            image = Image.open(io.BytesIO(data))
            if max(image.size) > ALIBABA_MAX_SIDE:
                image.thumbnail((ALIBABA_MAX_SIDE, ALIBABA_MAX_SIDE), Image.LANCZOS)
                buffer = io.BytesIO()
                image.save(buffer, 'PNG')
                data, shrunk = buffer.getvalue(), shrunk + 1
            archive.writestr(name, data)
            lines.append(json.dumps({'messages': [
                {'role': 'user', 'content': [{'text': PROMPT}, {'image': name}]},
                {'role': 'assistant', 'content': [{'text': row['target']}]},
            ]}))
        archive.writestr('data.jsonl', '\n'.join(lines) + '\n')
    print(f'Wrote {zip_path.relative_to(ROOT)} ({len(lines)} bars, {shrunk} shrunk to fit {ALIBABA_MAX_SIDE}px)')


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--manifest', type=Path, default=ROOT / 'ml' / 'training_manifest.csv')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'ml' / 'data' / 'finetune')
    parser.add_argument('--train-bars', type=int, default=None, help='Limit training bars (default: all).')
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--alibaba', action='store_true',
                        help='Also write ml/data/finetune_alibaba.zip for Model Studio.')
    parser.add_argument('--zip', action='store_true', help='Also write ml/data/finetune.zip for Colab.')
    args = parser.parse_args()

    with args.manifest.open(newline='') as source:
        rows = list(csv.DictReader(source))
    # Bars whose label does not match the picture (see excluded_bars.txt for why).
    excluded = {line.strip() for line in EXCLUDED.read_text().splitlines() if line.strip() and not line.startswith('#')}
    kept = [row for row in rows if row['song'] not in excluded and Path(row['image_path']).name not in excluded]
    print(f'Left out {len(rows) - len(kept)} bars listed in {EXCLUDED.name}')
    by_split = defaultdict(list)
    for row in kept:
        by_split[row['split']].append(row)
    by_split['train'] = sample_train(by_split['train'], args.train_bars, args.seed)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    corrections_file = EXCLUDED.with_name('label_corrections.json')   # {image file name: corrected text}
    corrections = json.loads(corrections_file.read_text()) if corrections_file.is_file() else {}
    packaged = [Path(__file__).resolve(), Path(__file__).resolve().with_name('training_contract.py'),
                args.output_dir / 'prompt.txt']
    for split, split_rows in by_split.items():
        with (args.output_dir / f'{split}.jsonl').open('w') as out:
            for row in split_rows:
                if not (ROOT / row['image_path']).is_file():
                    raise FileNotFoundError(row['image_path'])
                label = json.loads((ROOT / row['label_path']).read_text())
                target = encode_text(label)
                fixed = corrections.get(Path(row['image_path']).name)
                if fixed is not None:      # a label retyped by hand in the label review page
                    decode_text(fixed)
                    out.write(json.dumps({'image': row['image_path'], 'target': fixed, 'song': row['song']}) + '\n')
                    continue
                # Self-check: the text must decode back to exactly the hits in the label.
                expected = sorted(
                    (BEAT_GRID.index(float(e['beat'])), e['duration'],
                     tuple(sorted({d.removesuffix('_ghost') for d in e['drums']}, key=DRUM_IDX.get)))
                    for e in label['beats'] if not e.get('rest'))
                decoded = [(n['position'], n['duration'], tuple(n['drums'])) for n in decode_text(target)]
                assert decoded == expected, row['label_path']
                out.write(json.dumps({'image': row['image_path'], 'target': target, 'song': row['song']}) + '\n')
        packaged += [args.output_dir / f'{split}.jsonl'] + [ROOT / r['image_path'] for r in split_rows]
        print(f'{split}: {len(split_rows)} bars, {len({r["song"] for r in split_rows})} songs')
    (args.output_dir / 'prompt.txt').write_text(PROMPT + '\n')
    packaged += write_app_style(args.output_dir)
    if args.zip:
        # DrumHub's own drawing style, scored by the notebook as a separate check.
        synthetic = ROOT / 'eval' / 'recognition' / 'synthetic'
        packaged += [synthetic / 'manifest.json', *sorted((synthetic / 'images').glob('*.png'))]
        # PNGs are already compressed, so store rather than deflate.
        with zipfile.ZipFile(ROOT / 'ml' / 'data' / 'finetune.zip', 'w', zipfile.ZIP_STORED) as archive:
            for path in packaged:
                archive.write(path, path.resolve().relative_to(ROOT).as_posix())
        print(f'Wrote ml/data/finetune.zip ({len(packaged)} files)')
    if args.alibaba:
        write_alibaba_zip(args.output_dir / 'train.jsonl', ROOT / 'ml' / 'data' / 'finetune_alibaba.zip')
    print(f'Wrote {args.output_dir.relative_to(ROOT)} (drums: {len(DRUMS)}, durations: {len(DUR_IDX)})')


if __name__ == '__main__':
    main()
