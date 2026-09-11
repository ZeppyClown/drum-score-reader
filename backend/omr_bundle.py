"""Load a released OMR bundle once and turn one bar image into ordered note events.

Every dimension, class name, tensor name, and threshold comes from omr_config.json;
nothing about the model is hardcoded here. Preprocessing reproduces
ml/omr/omr_model.image_transform exactly, without needing PyTorch.
"""

import hashlib
import io
import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps, UnidentifiedImageError

REQUIRED_KEYS = ('DRUMS', 'DURATIONS', 'N_BEATS', 'N_DRUMS', 'N_DURATIONS', 'IMG_H', 'IMG_W',
                 'THRESHOLD', 'INPUT_NAME', 'OUTPUT_NAMES', 'IMAGENET_MEAN', 'IMAGENET_STD',
                 'MODEL_SHA256')
SUPPORTED_FORMATS = ('PNG', 'JPEG')
MAX_PIXELS = 40_000_000


class BundleError(Exception):
    """The model bundle is missing or inconsistent, or produced unusable output."""


class ImageInputError(Exception):
    """The uploaded file cannot be used as a bar image; `code` is the API error code."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class OMRBundle:
    config: dict
    session: ort.InferenceSession
    model_sha256: str


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def load_config(path):
    if not path.exists():
        raise BundleError(f'Missing {path.name} in {path.parent}; '
                          'point --bundle at a released model folder')
    try:
        config = json.loads(path.read_text())
    except json.JSONDecodeError as error:
        raise BundleError(f'{path.name} is not valid JSON: {error}') from error
    missing = [key for key in REQUIRED_KEYS if key not in config]
    if missing:
        raise BundleError(f'{path.name} is missing: {", ".join(missing)}')
    if (len(config['DRUMS']) != config['N_DRUMS']
            or len(config['DURATIONS']) != config['N_DURATIONS']):
        raise BundleError(f'{path.name} class names do not match its declared counts')
    if len(config['OUTPUT_NAMES']) != 2 or not 0 < config['THRESHOLD'] < 1:
        raise BundleError(f'{path.name} needs two output names and a threshold between 0 and 1')
    return config


def check_signature(session, config):
    inputs = [node.name for node in session.get_inputs()]
    outputs = [node.name for node in session.get_outputs()]
    if inputs != [config['INPUT_NAME']] or outputs != list(config['OUTPUT_NAMES']):
        raise BundleError(f'Model inputs {inputs} and outputs {outputs} do not match '
                          'omr_config.json')
    shape = list(session.get_inputs()[0].shape[1:])
    if shape != [3, config['IMG_H'], config['IMG_W']]:
        raise BundleError(f'Model input shape {shape} does not match omr_config.json')


def load_bundle(folder):
    folder = Path(folder)
    config = load_config(folder / 'omr_config.json')
    model_path = folder / 'omr.onnx'
    if not model_path.exists():
        raise BundleError(f'Missing omr.onnx in {folder}')
    digest = sha256_file(model_path)
    if digest != config['MODEL_SHA256']:
        raise BundleError('omr.onnx does not match MODEL_SHA256 in omr_config.json; '
                          'use the files exported together')
    try:
        session = ort.InferenceSession(str(model_path), providers=['CPUExecutionProvider'])
    except Exception as error:  # onnxruntime raises several unrelated exception types
        raise BundleError(f'omr.onnx could not be loaded: {error}') from error
    check_signature(session, config)
    return OMRBundle(config, session, digest)


def read_image(data):
    if not data:
        raise ImageInputError('invalid_image', 'The uploaded file is empty')
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format not in SUPPORTED_FORMATS:
                raise ImageInputError('unsupported_file', 'Only PNG and JPEG images are '
                                      f'supported (this file is {image.format})')
            if image.width * image.height > MAX_PIXELS:
                raise ImageInputError('image_too_large', 'Images must be at most '
                                      f'{MAX_PIXELS:,} pixels; crop to one bar first')
            return ImageOps.exif_transpose(image).convert('L')
    except UnidentifiedImageError as error:
        raise ImageInputError('unsupported_file', 'The file is not a PNG or JPEG image') from error
    except (OSError, Image.DecompressionBombError) as error:
        raise ImageInputError('invalid_image', f'The image could not be read: {error}') from error


def preprocess(image, config):
    """Grayscale PIL image -> (1, 3, H, W) float32, identical to the training transform."""
    resized = image.resize((config['IMG_W'], config['IMG_H']), Image.Resampling.BILINEAR)
    pixels = np.asarray(resized, dtype=np.float32) / 255.0
    mean = np.asarray(config['IMAGENET_MEAN'], dtype=np.float32).reshape(3, 1, 1)
    std = np.asarray(config['IMAGENET_STD'], dtype=np.float32).reshape(3, 1, 1)
    return ((np.repeat(pixels[None], 3, axis=0) - mean) / std)[None].astype(np.float32)


def decode(drum_logits, duration_logits, config):
    """Logits -> ordered {position, duration, drums} events; silent positions are omitted.

    position is the beat-grid slot (0 to N_BEATS - 1) where the hit starts. With the
    current 32-slot grid over a 4/4 bar, that is the number of 32nd notes from the start
    of the bar, which lets the editor put rests in the gaps between hits.
    """
    beats, drums, durations = config['N_BEATS'], config['N_DRUMS'], config['N_DURATIONS']
    if (drum_logits.shape != (1, beats * drums)
            or duration_logits.shape != (1, beats * durations)):
        raise BundleError(f'Model output shapes {drum_logits.shape} and '
                          f'{duration_logits.shape} do not match omr_config.json')
    if not (np.isfinite(drum_logits).all() and np.isfinite(duration_logits).all()):
        raise BundleError('Model produced non-finite output')
    threshold = config['THRESHOLD']
    # sigmoid(x) > t  <=>  x > log(t / (1 - t)), without overflow for large logits.
    hits = drum_logits[0].reshape(beats, drums) > math.log(threshold / (1 - threshold))
    rhythm = duration_logits[0].reshape(beats, durations).argmax(axis=1)
    return [{'position': beat,
             'duration': config['DURATIONS'][int(rhythm[beat])],
             'drums': [config['DRUMS'][int(drum)] for drum in np.flatnonzero(hits[beat])]}
            for beat in range(beats) if hits[beat].any()]


def predict(bundle, data):
    config = bundle.config
    pixels = preprocess(read_image(data), config)
    try:
        drum_logits, duration_logits = bundle.session.run(
            list(config['OUTPUT_NAMES']), {config['INPUT_NAME']: pixels})
    except Exception as error:  # onnxruntime raises several unrelated exception types
        raise BundleError(f'Model inference failed: {error}') from error
    return decode(drum_logits, duration_logits, config)
