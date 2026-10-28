import json
import unittest
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
from video_core import sharpness, dhash, select_frames, validate_result, ordered_inputs


class FramesTest(unittest.TestCase):
    def setUp(self):
        pixels = ((np.indices((256, 256)).sum(axis=0) // 8) % 2 * 255).astype('uint8')
        self.sharp = Image.fromarray(pixels)
        self.blur = self.sharp.filter(ImageFilter.GaussianBlur(5))

    def test_sharpest_frame_wins_in_3_second_window(self):
        self.assertGreater(sharpness(self.sharp), sharpness(self.blur))
        candidates = [{'time': 0, 'sharpness': sharpness(self.blur), 'hash': dhash(self.blur)}, {'time': .5, 'sharpness': sharpness(self.sharp), 'hash': dhash(self.sharp)}]
        self.assertEqual(select_frames(candidates)[0]['time'], .5)

    def test_duplicate_threshold_compares_last_retained(self):
        candidates = [{'time': i * 3, 'sharpness': 1, 'hash': h} for i, h in enumerate([0, 0b111111, 0b1111111, 0b1111111])]
        self.assertEqual([f['time'] for f in select_frames(candidates)], [0, 6])
        self.assertEqual(dhash(self.sharp), dhash(self.sharp.copy()))

    def test_even_thinning_preserves_span(self):
        candidates = [{'time': i * 3, 'sharpness': 1, 'hash': 0 if i % 2 else (1 << 256) - 1} for i in range(100)]
        selected = select_frames(candidates)
        self.assertEqual(len(selected), 60)
        self.assertEqual((selected[0]['time'], selected[-1]['time']), (0, 297))
        self.assertEqual(len(select_frames(candidates, max_frames=1)), 1)

    def test_chronological_interleaving(self):
        inputs = ordered_inputs({'context': '', 'project': 'Test'}, [{'time': 3, 'name': 'f_0003.jpg'}, {'time': 9, 'name': 'f_0009.jpg'}], [{'start': 5, 'end': 7, 'text': 'Речь'}], Path('/tmp'), 10)
        self.assertEqual([i['type'] for i in inputs], ['text', 'text', 'localImage', 'text', 'text', 'localImage'])
        self.assertIn('00:05–00:07', inputs[3]['text'])


if __name__ == '__main__':
    unittest.main()
