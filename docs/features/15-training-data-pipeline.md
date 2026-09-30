# Training data preparation

[Back to guide index](README.md)

## Purpose

The data pipeline creates paired bar images and machine-readable labels for optical music recognition. It takes advantage of source charts that exist both as structured Guitar Pro files and rendered notation. The image is the model input; the parsed notes are the supervised target.

This tooling supports model development rather than ordinary score editing. Its datasets and weights are generally git-ignored, while manifests, reconciliation reports, and release evidence are tracked.

## Parsing notes

The GP5 and GP7 parsers extract bar-level notes from source files. Labels describe when drums play and their duration. Parsing source notation avoids manually annotating every image, but it introduces assumptions that must remain visible: parsed positions are quantized and voices are merged before the training audit checks them.

The supported labels fold ghost dynamics into the base drum. Rest durations are not supervised as separate model outputs; silence is later reconstructed from onset gaps. The parsed target is therefore a constrained rhythm representation rather than a full reproduction of every printed symbol.

## Cropping bar images

PDF crop scripts locate staff lines and bar boundaries and save one image per bar. Separate tooling handles Reflow and Songsterr notation. Spot-check tools let the developer examine crops alongside labels and catch alignment problems before training.

The cropper has regression coverage for notation-specific cases such as triplet brackets, dense beams, narrow repeat bars, wrapped bars, and tiny final rests. Crop errors are serious because the model can otherwise learn a label paired with the wrong picture.

Training PDF crop tools and the app's pixel-based page segmenter are related in purpose but separate implementations. Improvements to one should not be assumed to change the other.

## Manifest and reconciliation

`build_manifest.py` records source, song, bar number, image path, label path, and split. Reconciliation records labels that were not paired, including a reason rather than silently losing examples.

The documented source dataset contains 23,660 image/label pairs from 289 songs. The broader parsed label collection has 159 additional labels excluded for a song whose available PDF contains no score. These figures refer to the recorded dataset, not an automatic guarantee about newly added files.

## Strict supported subset

The model contract supports 14 drums, ten duration classes, and 32 onset slots per bar. `prepare_training.py` retains bars that can be represented under that contract and writes an exclusion record for the others.

The tracked training report records 19,942 included bars and 3,718 exclusions. Reasons include context-dependent simile bars, unsupported drums or durations, duplicate onsets, positions outside the grid, and measures extending beyond it. Reason counts overlap because a bar can fail more than one check.

Excluding a bar keeps the training signal explicit. It also narrows what the evaluation means: model accuracy describes this supported subset, not every source bar or all possible drum notation.

## Splits and reproducibility

Songs are assigned to train, validation, and test with a fixed seed. Bars from the same song remain together to reduce leakage from repeated grooves. After subset filtering, the report contains:

| Split | Included bars | Included songs |
| --- | --- | --- |
| Train | 15,839 | 232 |
| Validation | 1,919 | 27 |
| Test | 2,184 | 28 |

Training learns weights, validation guides selection, and held-out test songs measure final behavior. The subset preserves the source split rather than resampling bars independently.

Preparation tools create archives for local or Colab training. Manifest, contract, model-source, and exclusion hashes let later training and release records identify the exact inputs. The reconciliation and spot-check stages remain necessary because a hash proves identity, not correctness of the pairing.

## Source map

See [GP5 parser](../../ml/data-prep/parse/parse_gp5.py), [GP7 parser](../../ml/data-prep/parse/parse_gp7.py), [crop_bars.py](../../ml/data-prep/crop_bars.py), [Songsterr cropper](../../ml/data-prep/crop_bars_songsterr.py), [build_manifest.py](../../ml/data-prep/build_manifest.py), [prepare_training.py](../../ml/omr/prepare_training.py), [training report](../../ml/training_report.json), and [data reconciliation](../../ml/data_reconciliation.md).
