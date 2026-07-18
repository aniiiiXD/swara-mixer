"""
synth.py — the sound engine (Layer 1: "the harmonica").

This is the ONLY thing that actually makes sound. It exposes a tiny API:

    set_note(midi)      # start/legato-switch to a note (None = keep silent)
    note_off()          # stop the current note
    set_volume(0..1)    # loudness  (MIDI expression, CC11)
    set_bend(semis)     # pitch bend in semitones, e.g. -2..+2  (harmonica bends!)
    set_vibrato(0..1)   # vibrato depth (MIDI modulation, CC1)

When you build the real robot, you write a second class with these SAME
methods that opens/closes solenoid valves instead of triggering MIDI. Nothing
above this file has to know the difference.
"""

import fluidsynth

GM_HARMONICA = 22  # General MIDI program #22 is "Harmonica"


class HarmonicaSynth:
    def __init__(self, soundfont_path: str, program: int = GM_HARMONICA, gain: float = 0.8):
        self.channel = 0
        self.current_note = None

        self.fs = fluidsynth.Synth(gain=gain)
        # coreaudio = macOS. (Use "alsa" on Linux, "dsound" on Windows.)
        self.fs.start(driver="coreaudio")
        self.sfid = self.fs.sfload(soundfont_path)
        if self.sfid == -1:
            raise RuntimeError(f"Could not load soundfont: {soundfont_path}")
        self.fs.program_select(self.channel, self.sfid, 0, program)

        # Start at full expression so the very first note is audible.
        self.fs.cc(self.channel, 11, 127)  # expression
        self.fs.cc(self.channel, 1, 0)     # modulation / vibrato off

    def set_note(self, midi):
        """Legato note switching: only re-trigger when the note actually changes."""
        if midi == self.current_note:
            return
        if self.current_note is not None:
            self.fs.noteoff(self.channel, self.current_note)
        if midi is not None:
            self.fs.noteon(self.channel, midi, 110)
        self.current_note = midi

    def note_off(self):
        if self.current_note is not None:
            self.fs.noteoff(self.channel, self.current_note)
            self.current_note = None

    def set_volume(self, v01: float):
        v = int(min(max(v01, 0.0), 1.0) * 127)
        self.fs.cc(self.channel, 11, v)

    def set_bend(self, semitones: float):
        # Default MIDI pitch-bend range is +/-2 semitones. pyfluidsynth's
        # pitch_bend() takes a value in [-8192, 8191] (center = 0).
        val = int((semitones / 2.0) * 8191)
        val = min(max(val, -8192), 8191)
        self.fs.pitch_bend(self.channel, val)

    def set_vibrato(self, depth01: float):
        d = int(min(max(depth01, 0.0), 1.0) * 127)
        self.fs.cc(self.channel, 1, d)

    def close(self):
        self.note_off()
        self.fs.delete()
