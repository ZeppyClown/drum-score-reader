"""Test-only helpers: a randomly initialized exported bundle and encoded bar images.

Building the fixture needs the ML training dependencies (torch, torchvision, onnx); the
service itself does not.
"""

import io
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ml' / 'omr'))

import torch  # noqa: E402
from export import export_onnx, inference_config  # noqa: E402
from omr_model import DrumOMRModel  # noqa: E402
from training_contract import sha256_file  # noqa: E402


def make_bundle(folder):
    torch.manual_seed(0)
    folder = Path(folder)
    export_onnx(DrumOMRModel(pretrained=False).eval(), folder / 'omr.onnx')
    config = {**inference_config(), 'MODEL_SHA256': sha256_file(folder / 'omr.onnx')}
    (folder / 'omr_config.json').write_text(json.dumps(config))
    return folder


def bar_image(width=600, height=200):
    image = Image.new('L', (width, height), 255)
    draw = ImageDraw.Draw(image)
    top = height // 3
    for line in range(5):
        y = top + line * height // 14
        draw.line((8, y, width - 8, y), fill=0, width=2)
    for note in range(4):
        x = width // 10 + note * width // 5
        draw.ellipse((x, top + 10, x + 14, top + 20), fill=0)
        draw.line((x + 14, top + 15, x + 14, top - 30), fill=0, width=2)
    return image


def encode(image, image_format, **options):
    buffer = io.BytesIO()
    image.save(buffer, format=image_format, **options)
    return buffer.getvalue()
