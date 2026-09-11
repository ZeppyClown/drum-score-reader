import random
import unittest

import numpy as np
import torch
from torch.optim import AdamW
from torch.utils.data import DataLoader, TensorDataset

from omr_model import DrumOMRModel
from train import positive_weights, restore_rng, rng_state, run_epoch


class LocalTrainingTests(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(2)
        torch.manual_seed(42)

    def test_model_head_dimensions(self):
        model = DrumOMRModel(pretrained=False).eval()
        with torch.no_grad():
            drums, durations = model(torch.zeros(2, 3, 128, 384))
        self.assertEqual(tuple(drums.shape), (2, 448))
        self.assertEqual(tuple(durations.shape), (2, 320))

    def test_head_training_preserves_backbone_weights_and_batchnorm_buffers(self):
        model = DrumOMRModel(pretrained=False)
        for parameter in model.features.parameters():
            parameter.requires_grad = False
        before = {name: tensor.clone() for name, tensor in model.features.state_dict().items()}
        head_before = model.drum_head.weight.detach().clone()
        targets = torch.zeros(2, 448)
        targets[:, 2] = 1
        loader = DataLoader(TensorDataset(torch.randn(2, 3, 128, 384), targets,
                                         torch.full((2, 32), 3, dtype=torch.long)), batch_size=2)
        optimizer = AdamW(filter(lambda p: p.requires_grad, model.parameters()), lr=3e-4)
        result = run_epoch(model, loader, torch.device('cpu'), positive_weights(targets),
                           optimizer, frozen=True)
        self.assertTrue(np.isfinite(result['loss']))
        self.assertFalse(torch.equal(head_before, model.drum_head.weight))
        for name, tensor in model.features.state_dict().items():
            self.assertTrue(torch.equal(before[name], tensor), name)

    def test_rng_roundtrip_repeats_augmentation_and_sampling_randomness(self):
        state = rng_state(torch.device('cpu'))
        expected = (random.random(), np.random.rand(), torch.rand(4))
        restore_rng(state, torch.device('cpu'))
        self.assertEqual(random.random(), expected[0])
        self.assertEqual(np.random.rand(), expected[1])
        self.assertTrue(torch.equal(torch.rand(4), expected[2]))


if __name__ == '__main__':
    unittest.main()
