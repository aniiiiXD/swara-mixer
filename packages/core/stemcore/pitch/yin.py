"""
pitch.py — monophonic pitch detection (the YIN algorithm).

Given a short block of mono audio, estimates the fundamental frequency (f0) of
a single voice/hum. Pure NumPy, FFT-accelerated, so it runs comfortably in
real time. This is the "ear" of the sing-to-harmonica pipeline.

YIN reference: de Cheveigné & Kawahara (2002). Steps:
  1. difference function d(tau)
  2. cumulative mean normalized difference (CMND)
  3. absolute threshold -> pick the period tau
  4. parabolic interpolation for sub-sample precision

Later you can swap this for a neural pitch model (CREPE) behind the same
__call__ interface; nothing above pitch.py has to change.
"""

import numpy as np


def hz_to_midi(f0: float) -> float:
    return 69.0 + 12.0 * np.log2(f0 / 440.0)


class YinPitch:
    def __init__(self, sr: int, fmin: float = 70.0, fmax: float = 1000.0, threshold: float = 0.15):
        self.sr = sr
        self.threshold = threshold
        self.tau_min = max(2, int(sr / fmax))
        self.tau_max = int(sr / fmin)

    def __call__(self, x):
        """Returns (f0_hz or None, confidence 0..1)."""
        x = np.asarray(x, dtype=np.float64)
        N = len(x)
        tau_max = min(self.tau_max, N // 2)
        if tau_max <= self.tau_min:
            return None, 0.0
        W = N - tau_max                      # analysis window length
        if W <= 0:
            return None, 0.0

        a = x[:W]
        # cross term c(tau) = sum_j a[j]*x[j+tau], via FFT cross-correlation
        size = 1
        while size < N + W:
            size *= 2
        A = np.fft.rfft(a, size)
        X = np.fft.rfft(x, size)
        c = np.fft.irfft(np.conj(A) * X, size)[:tau_max + 1]

        # energy terms
        cumsq = np.concatenate(([0.0], np.cumsum(x * x)))
        e_a = float(np.dot(a, a))
        e_x = cumsq[np.arange(tau_max + 1) + W] - cumsq[np.arange(tau_max + 1)]

        d = e_a + e_x - 2.0 * c              # difference function d(tau)
        d[d < 0] = 0.0

        # cumulative mean normalized difference
        cmnd = np.empty(tau_max + 1)
        cmnd[0] = 1.0
        taus = np.arange(1, tau_max + 1)
        running = np.cumsum(d[1:tau_max + 1])
        running[running == 0] = 1e-12
        cmnd[1:] = d[1:tau_max + 1] * taus / running

        # absolute threshold: first dip below threshold, descend to its local min
        tau = -1
        t = self.tau_min
        while t < tau_max:
            if cmnd[t] < self.threshold:
                while t + 1 < tau_max and cmnd[t + 1] < cmnd[t]:
                    t += 1
                tau = t
                break
            t += 1
        if tau == -1:
            # nothing confidently periodic -> report the best guess, low confidence
            tau = int(np.argmin(cmnd[self.tau_min:tau_max])) + self.tau_min
            conf = max(0.0, 1.0 - float(cmnd[tau]))
            if conf < 0.3:
                return None, conf

        # parabolic interpolation around tau for sub-sample precision
        better = self._parabolic(cmnd, tau, tau_max)
        f0 = self.sr / better
        confidence = float(max(0.0, min(1.0, 1.0 - cmnd[tau])))
        return f0, confidence

    @staticmethod
    def _parabolic(cmnd, tau, tau_max):
        if tau <= 0 or tau >= tau_max:
            return float(tau)
        a, b, c = cmnd[tau - 1], cmnd[tau], cmnd[tau + 1]
        denom = a + c - 2.0 * b
        if denom == 0:
            return float(tau)
        return tau + (a - c) / (2.0 * denom)
