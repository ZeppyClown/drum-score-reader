# OMR model, training, and releases

[Back to guide index](README.md)

## Model purpose and output

The local optical music recognition model reads one cropped bar and predicts drum events. It is a compact vision network intended to run on a laptop. It does not answer conversational questions or segment a full page; those functions belong to other components.

| Component | Current contract |
| --- | --- |
| Backbone | ImageNet-pretrained MobileNetV3-Small. |
| Input | Grayscale bar copied into three channels, 128×384 pixels, normalized. |
| Shared head | Linear projection to 1,024 features, Hardswish, and dropout. |
| Drum output | 32 slots × 14 independent drum logits. |
| Duration output | 32 slots × 10 duration-class logits. |
| Parameter count | 2,305,056. |

The drum output is multi-label, so several drums can activate at one onset. The duration output is a choice among classes. Supported classes are whole, half, dotted quarter, quarter, dotted eighth, eighth, sixteenth, 32nd, triplet eighth, and triplet sixteenth.

## Training features

The default training schedule freezes the pretrained backbone for 15 epochs, then fine-tunes the complete network for 25. Freezing includes BatchNorm running statistics. Fine-tuning uses a lower learning rate. AdamW, cosine scheduling, class weighting, and seeded randomness are part of the training implementation.

Training augmentations apply small geometric and image changes, such as rotation, shift, brightness, contrast, and blur. Validation and test transforms do not use training augmentation. Rare drum classes receive increased positive weighting, capped to limit extreme weights.

The CLI supports CPU, MPS, CUDA, smoke batches, and resume. Checkpoints preserve optimizer, scheduler, and random-number state. Resume verifies run inputs and configuration instead of continuing a different experiment under an old name. Smoke runs exercise the machinery but cannot be published as model releases.

The Colab notebook uses the shared Python tooling rather than maintaining an independent model contract.

## Evaluation metrics

Sequence accuracy measures whether the entire ordered predicted bar matches its target. Exact-bar grid accuracy is another strict view. Cell accuracy measures individual output cells but is dominated by empty slots, making it a weak product headline. Duration accuracy at hits separates note-length prediction from finding a hit. Per-drum F1, support, and false positives expose instrument-specific problems.

The tracked `baseline-14drum-v1` release reports 12.5% sequence accuracy on 2,184 bars from 28 held-out songs, 96.7% cell accuracy, and 89.7% duration accuracy at hits. These are recorded release results, not measurements rerun for these guides.

Kick, snare, and closed hi-hat perform better than rare instruments. Excess false positives on toms and other rare drums hurt whole-bar accuracy. A single added drum can make a complete bar wrong even when most grid cells are correct.

## Export and benchmarking

Export produces an ONNX graph and matching configuration for deployment. It rejects implausible file size and checks PyTorch/ONNX numerical parity on actual bars. Additional checks look for changed hit decisions and differently decoded bars, connecting numerical differences to the output a user sees.

Benchmarking records runtime latency and compares float and quantized variants. The documented M1 baseline has about 16.4 ms median inference latency for the float model. The int8 experiment was smaller but slower and failed decoded-bar agreement, so float32 is the selected release.

These timings exclude file picking, page segmentation, Python startup, and correction work. They should not be read as end-to-end import latency.

## Release evidence

The release process cross-checks completion, checkpoint identity, dataset and code hashes, evaluation, export, config, and benchmark records. Its purpose is to ensure those artifacts describe the same trained model. Passing integrity checks does not establish that recognition accuracy is high enough for unattended transcription.

Runtime bundles are placed under `ml/data/releases/<name>/`. Tracked records under `ml/releases/<name>/` retain JSON evidence and hashes. The Electron build copies the runtime bundle, not merely its reports.

A typical sequence is prepare training data → train → evaluate → export → benchmark → release. Each stage has its own CLI and evidence. See the [root README](../../README.md) for the complete command sequence and the [model card](../../ml/README.md) for metric detail.

## Source map

See [training_contract.py](../../ml/omr/training_contract.py), [omr_model.py](../../ml/omr/omr_model.py), [train.py](../../ml/omr/train.py), [evaluate.py](../../ml/omr/evaluate.py), [export.py](../../ml/omr/export.py), [benchmark.py](../../ml/omr/benchmark.py), [release.py](../../ml/omr/release.py), and [baseline evaluation](../../ml/releases/baseline-14drum-v1/eval_results.json).
