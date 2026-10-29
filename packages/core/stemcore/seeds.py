"""
seeds.py — a few simple public-domain melodies (in C major) to seed the note
transition model, so it knows basic musical grammar before you've recorded much.
Each melody is just a list of MIDI note numbers (60 = middle C).
As you record more takes, your own style is mixed in and eventually dominates.
"""

TWINKLE = [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60,
           67, 67, 65, 65, 64, 64, 62, 67, 67, 65, 65, 64, 64, 62,
           60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60]

MARY = [64, 62, 60, 62, 64, 64, 64, 62, 62, 62, 64, 67, 67,
        64, 62, 60, 62, 64, 64, 64, 64, 62, 62, 64, 62, 60]

ODE_TO_JOY = [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62,
              64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 62, 60, 60]

WHEN_THE_SAINTS = [60, 64, 65, 67, 60, 64, 65, 67, 60, 64, 65, 67, 64, 60, 64, 62,
                   64, 64, 62, 60, 60, 64, 67, 67, 67, 65, 64, 65, 64, 60]

OH_SUSANNA = [60, 62, 64, 67, 67, 69, 67, 64, 60, 62, 64, 64, 62, 60, 62,
              60, 62, 64, 67, 67, 69, 67, 64, 60, 62, 64, 64, 62, 62, 60]

FRERE_JACQUES = [60, 62, 64, 60, 60, 62, 64, 60, 64, 65, 67, 64, 65, 67,
                 67, 69, 67, 65, 64, 60, 67, 69, 67, 65, 64, 60, 60, 55, 60, 60, 55, 60]

ALL = [TWINKLE, MARY, ODE_TO_JOY, WHEN_THE_SAINTS, OH_SUSANNA, FRERE_JACQUES]
