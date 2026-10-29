"""
test_core.py — base (numpy-only) tests for stemcore. No heavy deps, no audio I/O.

Run:  PYTHONPATH=packages/core python packages/core/tests/test_core.py
 or:  pip install -e packages/core && python -m pytest packages/core/tests
"""

import sys

import numpy as np

from stemcore.model import NoteEvent, JobStatus
from stemcore.transcribe.mono import transcribe_mono
from stemcore import tempo
from stemcore.musicmodel import NoteModel
from stemcore import seeds
from stemcore.instruments import harmonica as harp
from stemcore.instruments import piano


def test_import_is_lightweight():
    # importing the package must not pull optional heavy deps
    import stemcore  # noqa: F401
    for heavy in ("matplotlib", "fluidsynth", "torch", "librosa", "demucs"):
        assert heavy not in sys.modules, f"base import unexpectedly loaded {heavy}"


def test_noteevent_shape():
    n = NoteEvent(start=1.0, dur=0.5, midi=60)
    assert n.end == 1.5 and n.name == "C4" and n.velocity == 100


def _hum(midis, sr=44100, note_d=0.4, gap=0.1):
    y = []
    for m in midis:
        t = np.arange(int(note_d * sr)) / sr
        f = 440 * 2 ** ((m - 69) / 12)
        tone = np.sin(2 * np.pi * f * t)
        env = np.minimum(1, np.minimum(t / 0.02, (note_d - t) / 0.03))
        y.append(tone * env)
        y.append(np.zeros(int(gap * sr)))
    return np.concatenate(y).astype(np.float32), sr


def test_transcribe_mono_recovers_melody():
    y, sr = _hum([60, 64, 67, 64, 60])
    notes = transcribe_mono(y, sr)
    assert [n.midi for n in notes] == [60, 64, 67, 64, 60]
    assert all(isinstance(n, NoteEvent) for n in notes)


def test_tempo_quantize_returns_noteevents():
    notes = [NoteEvent(start=i * 0.5, dur=0.5, midi=60) for i in range(6)]
    bpm, phase = tempo.estimate_tempo([n.start for n in notes])
    q = tempo.quantize(notes, bpm, phase)
    assert 55 <= bpm <= 130 and all(isinstance(n, NoteEvent) for n in q)


def test_musicmodel_corrects_and_generates():
    m = NoteModel().train(seeds.ALL)
    fixed = m.viterbi_correct([60, 64, 67, 66, 67, 64])   # 66 = F#, out of key
    assert fixed[3] % 12 in (5, 7)                         # -> F or G
    assert len(m.generate(8)) == 8


def test_instruments():
    for mm in range(48, 96):
        hole, draw = harp.harp_hole(harp.snap_to_harp(mm, 1))
        assert 0 <= hole <= 9
    assert piano.NUM_KEYS == 88 and piano.in_range(60)


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print("  ok ", t.__name__)
    print(f"\n{len(tests)}/{len(tests)} core tests passed.")
