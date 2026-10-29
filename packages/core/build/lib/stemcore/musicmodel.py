"""
notemodel.py — the ML that models how notes connect.

A smoothed bigram (order-1 Markov) model over C-major scale degrees. It's a real
statistical model — a mini "language model" for melody — and it works with very
little data, which is why we start here instead of a neural net.

It does two jobs from the same learned transition table:

  viterbi_correct()  -> the HMM cleanup. Given the notes you sang, find the most
                        musically-likely diatonic sequence, balancing "stay close
                        to what you sang" (emission) against "notes should connect
                        the way melodies usually do" (transition). Fixes octave
                        glitches and improbable stray notes.

  generate()         -> sample new melodies that follow the same grammar (the
                        'AI plays it' path — same model, no retraining).

We model 7 scale DEGREES (C D E F G A B), not raw MIDI, so the transition table
stays dense even with a handful of melodies. Octaves are reattached afterward
from the sung contour.
"""

import json
import math
import random

# semitone offsets of the C-major degrees (I..vii)
DEGREE_PC = [0, 2, 4, 5, 7, 9, 11]
N = 7


def midi_to_degree(m):
    pc = m % 12
    return min(range(N), key=lambda i: min(abs(pc - DEGREE_PC[i]), 12 - abs(pc - DEGREE_PC[i])))


class NoteModel:
    def __init__(self, k=0.5):
        self.k = k                                  # add-k smoothing
        self.trans = [[0.0] * N for _ in range(N)]  # counts: trans[prev][next]
        self.start = [0.0] * N
        self.n_seqs = 0

    # ---- training ----
    def train(self, sequences):
        """sequences: list of MIDI-note lists."""
        for seq in sequences:
            degs = [midi_to_degree(m) for m in seq]
            if not degs:
                continue
            self.n_seqs += 1
            self.start[degs[0]] += 1
            for a, b in zip(degs, degs[1:]):
                self.trans[a][b] += 1
        return self

    def log_trans(self, a, b):
        row = self.trans[a]
        return math.log((row[b] + self.k) / (sum(row) + N * self.k))

    def log_start(self, d):
        return math.log((self.start[d] + self.k) / (sum(self.start) + N * self.k))

    # ---- HMM cleanup ----
    def viterbi_correct(self, sung_midis, sigma=1.3):
        """Return a corrected MIDI list. sigma = how much to trust the grammar
        over the singer (smaller sigma = trust the singer more)."""
        n = len(sung_midis)
        if n == 0:
            return []

        def emit(m, d):                 # log-prob a sung pitch came from degree d
            pc = m % 12
            dist = min(abs(pc - DEGREE_PC[d]), 12 - abs(pc - DEGREE_PC[d]))
            return -(dist * dist) / (2 * sigma * sigma)

        V = [[-1e18] * N for _ in range(n)]
        back = [[0] * N for _ in range(n)]
        for d in range(N):
            V[0][d] = self.log_start(d) + emit(sung_midis[0], d)
        for i in range(1, n):
            for d in range(N):
                best_p, best_k = -1e18, 0
                for p in range(N):
                    val = V[i - 1][p] + self.log_trans(p, d)
                    if val > best_p:
                        best_p, best_k = val, p
                V[i][d] = best_p + emit(sung_midis[i], d)
                back[i][d] = best_k

        last = max(range(N), key=lambda d: V[n - 1][d])
        path = [last]
        for i in range(n - 1, 0, -1):
            path.append(back[i][path[-1]])
        path.reverse()

        # reattach octave: place each chosen degree nearest to the sung note
        out = []
        for m, d in zip(sung_midis, path):
            base = (m // 12) * 12 + DEGREE_PC[d]
            out.append(min((base - 12, base, base + 12), key=lambda x: abs(x - m)))
        return out

    # ---- generation (same model) ----
    def _sample(self, weights):
        tot = sum(weights)
        r = random.random() * tot
        acc = 0.0
        for i, w in enumerate(weights):
            acc += w
            if r <= acc:
                return i
        return len(weights) - 1

    def generate(self, n, base_octave=72):
        """Sample n notes as MIDI. Degrees follow the learned grammar; octave does
        a gentle bounded random walk around base_octave to make a melodic contour."""
        start_w = [self.start[d] + self.k for d in range(N)]
        d = self._sample(start_w)
        octave = base_octave // 12 * 12
        out = []
        for _ in range(n):
            note = octave + DEGREE_PC[d]
            out.append(note)
            # occasional octave drift for contour, kept within a sensible range
            if random.random() < 0.18:
                octave += 12 * random.choice((-1, 1))
                octave = max(60, min(84, octave))
            row = [self.trans[d][j] + self.k for j in range(N)]
            d = self._sample(row)
        return out

    # ---- persistence ----
    def save(self, path):
        with open(path, "w") as f:
            json.dump({"k": self.k, "trans": self.trans, "start": self.start,
                       "n_seqs": self.n_seqs}, f)

    @classmethod
    def load(cls, path):
        with open(path) as f:
            d = json.load(f)
        m = cls(k=d["k"])
        m.trans, m.start, m.n_seqs = d["trans"], d["start"], d["n_seqs"]
        return m
