"""
test_smoke.py — fast, no-audio, no-GUI sanity checks for the core pipeline.

Run either with pytest:      ./.venv/bin/python -m pytest tests
or directly:                 ./.venv/bin/python tests/test_smoke.py
"""

import numpy as np

# engine now comes from the shared stemcore package
from stemcore.pitch.yin import YinPitch, hz_to_midi
from stemcore import tempo, seeds
from stemcore.musicmodel import NoteModel
from stemcore.instruments.harmonica import snap_to_harp, harp_hole, tab_token
from harmonica.apps import transcribe as T


def _tone(freq, n=2048, sr=44100):
    t = np.arange(n) / sr
    x = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * 2 * freq * t)
    return (x + 0.01 * np.random.randn(n)).astype(np.float32)


def test_pitch_detection_accurate():
    yin = YinPitch(44100)
    for freq in (220.0, 440.0, 330.0):
        f0, conf = yin(_tone(freq))
        assert f0 is not None and abs(f0 - freq) < 3.0 and conf > 0.5


def test_harp_mapping_is_playable():
    # every snapped note must resolve to a real hole + direction
    for m in range(48, 96):
        hole, draw = harp_hole(snap_to_harp(m, 1))
        assert 0 <= hole <= 9
        assert tab_token(hole, draw)[-1].isdigit()


def test_notemodel_corrects_stray_note():
    m = NoteModel().train(seeds.ALL)
    # C E G F#(out of key) G E  -> the F# should be pulled to a diatonic note
    fixed = m.viterbi_correct([60, 64, 67, 66, 67, 64])
    assert fixed[3] % 12 in (5, 7)  # snapped to F or G, not F#


def test_tempo_detects_steady_pulse():
    onsets = [i * 0.5 for i in range(8)]
    bpm, _ = tempo.estimate_tempo(onsets)
    assert 55 <= bpm <= 130  # a half-second pulse -> a sensible tempo


def test_analyze_recovers_a_melody():
    sr = 44100
    def hz(mm):
        return 440 * 2 ** ((mm - 69) / 12)
    y = []
    for m in (60, 64, 67, 64, 60):
        t = np.arange(int(0.4 * sr)) / sr
        tone = np.sin(2 * np.pi * hz(m) * t)
        env = np.minimum(1, np.minimum(t / 0.02, (0.4 - t) / 0.03))
        y.append(tone * env)
        y.append(np.zeros(int(0.1 * sr)))
    y = np.concatenate(y).astype(np.float32)
    events = T.analyze(y, sr)
    assert [e["midi"] for e in events] == [60, 64, 67, 64, 60]


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    passed = 0
    for t in tests:
        t()
        print(f"  ok  {t.__name__}")
        passed += 1
    print(f"\n{passed}/{len(tests)} smoke tests passed.")
