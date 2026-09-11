#!/usr/bin/env python3
"""Package the prepared dataset for Google Drive upload.

Usage:
  python ml/omr/prepare_upload.py
  python ml/omr/prepare_upload.py --dataset-dir path/to/dataset --output path/to/dataset.zip
"""

import argparse
import zipfile
from pathlib import Path

ML_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATASET_DIR = ML_DIR / 'data' / 'dataset'
DEFAULT_OUTPUT = ML_DIR / 'data' / 'dataset.zip'


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        '--dataset-dir', type=Path, default=DEFAULT_DATASET_DIR,
        help=f'directory containing images/ and labels/ (default: {DEFAULT_DATASET_DIR})',
    )
    ap.add_argument(
        '--output', type=Path, default=DEFAULT_OUTPUT,
        help=f'ZIP output path (default: {DEFAULT_OUTPUT})',
    )
    args = ap.parse_args()

    dataset_dir = args.dataset_dir.expanduser().resolve()
    output = args.output.expanduser().resolve()
    image_dir = dataset_dir / 'images'
    label_dir = dataset_dir / 'labels'
    if not image_dir.is_dir():
        ap.error(f'image directory does not exist: {image_dir}')
    if not label_dir.is_dir():
        ap.error(f'label directory does not exist: {label_dir}')

    images = sorted(image_dir.glob('*.png'))
    labels = sorted(label_dir.glob('*.json'))
    print(f'Packing {len(images)} images + {len(labels)} labels → {output}')

    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in images:
            archive.write(path, f'dataset/images/{path.name}')
        for path in labels:
            archive.write(path, f'dataset/labels/{path.name}')

    size_mb = output.stat().st_size / 1_000_000
    print(f'Done. {output} ({size_mb:.1f} MB)')
    print()
    print('Next steps:')
    print('  1. Upload dataset.zip to Google Drive → MyDrive/drumhub/dataset.zip')
    print('  2. Open ml/notebooks/OMR Training After.ipynb in Colab')
    print('  3. Runtime → Change runtime type → T4 GPU')
    print('  4. Run all cells')


if __name__ == '__main__':
    main()
