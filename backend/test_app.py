import contextlib
import io
import sys
import tempfile
import unittest
from unittest import mock

from fastapi.testclient import TestClient

import app as service
from bundle_fixture import bar_image, encode, make_bundle
from omr_bundle import BundleError, load_bundle


class ServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        make_bundle(cls.folder.name)
        cls.bundle = load_bundle(cls.folder.name)
        cls.client = TestClient(service.create_app(cls.bundle))
        cls.png = encode(bar_image(), 'PNG')

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    def upload(self, data, name='bar.png', content_type='image/png'):
        return self.client.post('/predict', files={'image': (name, data, content_type)})

    def assertError(self, response, status, code):
        self.assertEqual(response.status_code, status)
        error = response.json()['error']
        self.assertEqual(error['code'], code)
        self.assertTrue(error['message'])

    def test_health_reports_the_loaded_model(self):
        body = self.client.get('/health').json()
        self.assertEqual(body['status'], 'ok')
        self.assertEqual(body['model_sha256'], self.bundle.model_sha256)
        self.assertEqual(len(body['drums']), 14)

    def test_predict_returns_ordered_notes_from_the_model_vocabulary(self):
        response = self.upload(self.png)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['model_sha256'], self.bundle.model_sha256)
        positions = [note['position'] for note in body['notes']]
        self.assertEqual(positions, sorted(set(positions)))
        for note in body['notes']:
            self.assertEqual(set(note), {'position', 'duration', 'drums'})
            self.assertIn(note['position'], range(self.bundle.config['N_BEATS']))
            self.assertIn(note['duration'], self.bundle.config['DURATIONS'])
            self.assertTrue(note['drums'])
            self.assertLessEqual(set(note['drums']), set(self.bundle.config['DRUMS']))

    def test_non_image_upload_is_unsupported(self):
        self.assertError(self.upload(b'hello', 'notes.txt', 'text/plain'), 415,
                         'unsupported_file')

    def test_missing_image_field_is_explained(self):
        self.assertError(self.client.post('/predict'), 422, 'missing_image')

    def test_oversized_upload_is_rejected_before_decoding(self):
        with mock.patch.object(service, 'MAX_UPLOAD_BYTES', 10):
            self.assertError(self.upload(self.png), 413, 'file_too_large')

    def test_model_failure_is_reported_as_invalid_model_output(self):
        with mock.patch.object(service, 'predict', side_effect=BundleError('bad output')):
            self.assertError(self.upload(self.png), 500, 'invalid_model_output')

    def run_main(self, bundle_folder):
        stderr, stdout = io.StringIO(), io.StringIO()
        with mock.patch.object(sys, 'argv', ['app.py', '--bundle', bundle_folder, '--port', '0']), \
                mock.patch.object(service.uvicorn.Server, 'run') as run, \
                contextlib.redirect_stderr(stderr), contextlib.redirect_stdout(stdout):
            run.side_effect = lambda *, sockets: setattr(run, 'bound_address', sockets[0].getsockname())
            code = service.main()
        return code, run, stderr.getvalue()

    def test_startup_with_a_missing_bundle_fails_readably(self):
        with tempfile.TemporaryDirectory() as empty:
            code, run, stderr = self.run_main(empty)
        self.assertEqual(code, 1)
        run.assert_not_called()
        self.assertIn('could not start: Missing omr_config.json', stderr)

    def test_service_binds_only_to_localhost(self):
        code, run, _ = self.run_main(self.folder.name)
        self.assertEqual(code, 0)
        self.assertEqual(run.bound_address[0], '127.0.0.1')
        self.assertGreater(run.bound_address[1], 0)


class SegmentEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        make_bundle(cls.folder.name)
        cls.client = TestClient(service.create_app(load_bundle(cls.folder.name)))

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    def test_segments_a_page_image_and_returns_it_for_review(self):
        import cv2
        import numpy as np
        from test_page_segment import drum_staff, page
        img = page()
        drum_staff(img, 150, 50, 1150, [350, 650, 950, 1150])
        drum_staff(img, 450, 50, 1150, [600, 1150])
        ok, png = cv2.imencode('.png', img)
        response = self.client.post('/segment', files={'file': ('page.png', png.tobytes(), 'image/png')})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['barCount'], 6)
        (first,) = body['pages']
        self.assertEqual((first['width'], first['height']), (1200, 900))
        self.assertTrue(first['image'].startswith('data:image/png;base64,'))
        self.assertEqual([len(s['bars']) for s in first['systems']], [4, 2])

    def test_large_photos_are_scaled_down_with_boxes_in_the_returned_image(self):
        import cv2
        from test_page_segment import drum_staff, page
        img = cv2.resize(page(), (4000, 3000))
        drum_staff(img, 1000, 100, 3900, [1300, 2600, 3900], space=24, crossing_stems=False)
        ok, png = cv2.imencode('.png', img)
        body = self.client.post('/segment', files={'file': ('photo.png', png.tobytes(), 'image/png')}).json()
        (first,) = body['pages']
        self.assertEqual(max(first['width'], first['height']), 3000)
        self.assertEqual(body['barCount'], 3)
        for bar in first['systems'][0]['bars']:
            self.assertLessEqual(bar['x'] + bar['width'], first['width'])

    def test_unreadable_and_missing_files_are_explained(self):
        bad = self.client.post('/segment', files={'file': ('notes.txt', b'hello', 'text/plain')})
        self.assertEqual(bad.status_code, 422)
        self.assertEqual(bad.json()['error']['code'], 'invalid_page')
        missing = self.client.post('/segment')
        self.assertEqual(missing.json()['error']['code'], 'missing_file')


if __name__ == '__main__':
    unittest.main()
