import unittest
from unittest.mock import patch

import numpy as np
import torch
import torchcrepe

from app.services import pitch, songs


class RawReferenceTests(unittest.TestCase):
    def test_raw_keeps_quiet_frames_and_octave_jumps_without_smoothing(self):
        frequencies = torch.tensor([[220.0, 440.0, 221.5, float('nan')]])
        confidence = torch.tensor([[.9, .01, .05, .0]])
        with patch.object(torchcrepe, 'predict', return_value=(frequencies, confidence)) as predict, patch.object(torchcrepe.filter, 'median') as median:
            contour, _, _ = pitch._crepe_analyze(np.zeros(640, dtype=np.float32), 16000, raw=True)
        self.assertIs(predict.call_args.kwargs['decoder'], torchcrepe.decode.weighted_argmax)
        median.assert_not_called()
        self.assertEqual([p['hz'] for p in contour], [220., 440., 221.5, None])
        self.assertEqual([p['t'] for p in contour], [0., .01, .02, .03])
        self.assertEqual(contour[1]['midi'] - contour[0]['midi'], 12.)

    def test_raw_failure_does_not_silently_return_smoothed_fallback(self):
        with patch.object(pitch, 'decode_audio_bytes', return_value=(np.zeros(640), 16000)), patch.object(pitch, '_crepe_analyze', side_effect=RuntimeError('unavailable')), patch.object(pitch, 'pyin_track') as fallback:
            with self.assertRaisesRegex(RuntimeError, 'unavailable'):
                pitch.analyze(b'audio', raw=True)
        fallback.assert_not_called()

    def test_reference_uses_separate_cache_and_original_stem_bytes(self):
        songs.reference.cache_clear()
        self.addCleanup(songs.reference.cache_clear)
        raw_result = {'processing': 'raw-v1', 'contour': []}
        with patch.object(songs.artifacts, 'read', return_value=None) as read, patch.object(songs.artifacts, 'write') as write, patch.object(songs, '_stem_path') as stem, patch.object(pitch, 'analyze', return_value=raw_result) as analyze:
            stem.return_value.read_bytes.return_value = b'original vocal stem'
            self.assertEqual(songs.reference('test-song'), raw_result)
        read.assert_called_once_with('test-song', 'reference-raw-v1')
        analyze.assert_called_once_with(b'original vocal stem', target_sr=16000, hop=160, raw=True)
        write.assert_called_once_with('test-song', 'reference-raw-v1', raw_result)


if __name__ == '__main__':
    unittest.main()
