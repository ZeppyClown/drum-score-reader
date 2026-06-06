#!/usr/bin/env python3
"""
prepare_upload.py

Zips the dataset folder ready for Google Drive upload.
Run this locally before opening Colab.

Usage: python ml/omr/prepare_upload.py
Output: dataset.zip  (~same dir as this repo)
"""

import zipfile
from pathlib import Path

ROOT     = Path(__file__).parent.parent.parent
DATASET  = ROOT / 'dataset'
OUT_ZIP  = ROOT / 'dataset.zip'

images = sorted((DATASET / 'images').glob('*.png'))
labels = sorted((DATASET / 'labels').glob('*.json'))

print(f'Packing {len(images)} images + {len(labels)} labels → {OUT_ZIP.name}')

with zipfile.ZipFile(OUT_ZIP, 'w', zipfile.ZIP_DEFLATED) as zf:
    for f in images:
        zf.write(f, f'dataset/images/{f.name}')
    for f in labels:
        zf.write(f, f'dataset/labels/{f.name}')

size_mb = OUT_ZIP.stat().st_size / 1_000_000
print(f'Done. {OUT_ZIP}  ({size_mb:.1f} MB)')
print()
print('Next steps:')
print('  1. Upload dataset.zip to Google Drive → MyDrive/drumhub/dataset.zip')
print('  2. Open notebooks/omr_training.ipynb in Colab')
print('  3. Runtime → Change runtime type → T4 GPU')
print('  4. Run all cells')
