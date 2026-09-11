"""Model and image preprocessing shared by Colab and local training."""

import json
from pathlib import Path

import torch
from PIL import Image
from torch import nn
from torch.utils.data import Dataset
from torchvision import transforms as T
from torchvision.models import MobileNet_V3_Small_Weights, mobilenet_v3_small

from training_contract import BEAT_GRID, DRUMS, DURATIONS, IMG_H, IMG_W, encode_target


class DrumOMRModel(nn.Module):
    def __init__(self, pretrained=True):
        super().__init__()
        weights = MobileNet_V3_Small_Weights.DEFAULT if pretrained else None
        base = mobilenet_v3_small(weights=weights)
        self.features = base.features
        self.avgpool = base.avgpool
        self.shared = nn.Sequential(*list(base.classifier[:-1]))
        feature_size = base.classifier[-1].in_features
        self.drum_head = nn.Linear(feature_size, len(BEAT_GRID) * len(DRUMS))
        self.dur_head = nn.Linear(feature_size, len(BEAT_GRID) * len(DURATIONS))

    def forward(self, image):
        features = self.shared(torch.flatten(self.avgpool(self.features(image)), 1))
        return self.drum_head(features), self.dur_head(features)


def image_transform(augment=False):
    transforms = [T.Resize((IMG_H, IMG_W)), T.Grayscale(num_output_channels=3)]
    if augment:
        transforms += [
            T.RandomAffine(degrees=2, translate=(0, 0.04)),
            T.ColorJitter(brightness=0.4, contrast=0.4),
            T.GaussianBlur(kernel_size=3, sigma=(0.1, 1.5)),
        ]
    return T.Compose(transforms + [
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])


class DrumBarDataset(Dataset):
    def __init__(self, image_paths, label_paths, augment=False):
        if len(image_paths) != len(label_paths):
            raise ValueError('Image/label counts differ')
        self.images = image_paths
        self.labels = label_paths
        self.transform = image_transform(augment)

    def __len__(self):
        return len(self.images)

    def __getitem__(self, index):
        with Image.open(self.images[index]) as image:
            pixels = self.transform(image.convert('L'))
        drums, durations = encode_target(json.loads(Path(self.labels[index]).read_text()))
        return (pixels, torch.tensor(drums, dtype=torch.float32),
                torch.tensor(durations, dtype=torch.long))
