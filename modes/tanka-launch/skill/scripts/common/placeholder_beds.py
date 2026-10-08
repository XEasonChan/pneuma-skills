"""Procedural placeholder beds for the seed music library (no samples, no provider, no licence questions).

The library ships CARDS only (seed-library/music/*.json). A card with a `placeholder` block has no audio file in the repo: the first
time a script needs it, `ensure(card)` synthesises it (kick / clap / hats / bass / pad on a steady grid, an intro without drums, then
the groove) into the cache dir ($TL_CACHE_DIR, else ~/.cache/pneuma-launch-studio/library). Deterministic: the same card always
renders the same samples. These beds exist so mock runs and the selftest have music with a real beat grid; they are not meant to be
used in a finished film. Replace them with the run's own licensed beds (assets/library/music/<id>.json + the audio file)."""
import hashlib, os
import numpy as np
import audio as A

SR = A.SR
NOTE = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}


def cache_dir():
    d = os.environ.get('TL_CACHE_DIR') or os.path.join(os.path.expanduser('~'), '.cache', 'pneuma-launch-studio')
    d = os.path.join(d, 'library', 'music'); os.makedirs(d, exist_ok=True); return d


def _hz(midi): return 440.0 * 2 ** ((midi - 69) / 12)


def _env(n, a=0.005, d=0.25):
    t = np.arange(n) / SR
    return np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / max(d, 1e-4))


def synth(bpm=102.0, bars=24, key='A', minor=True, intro_bars=4, seed=1, airy=False):
    """-> stereo float32 array: `intro_bars` bars of pad + hats only, then kick on every beat, clap on 2 and 4, 8th hats, a root bass
    and a i-VI-III-VII (minor) / I-V-vi-IV (major) pad, one chord per bar; ends on a 1-bar ring-out"""
    rng = np.random.default_rng(seed)
    beat = 60.0 / bpm; n = int((bars + 1) * 4 * beat * SR); x = np.zeros((n, 2))
    root = 45 + NOTE[key]                                                             # A2 = 45
    prog = [0, 8, 3, 10] if minor else [0, 7, 9, 5]
    third = 3 if minor else 4
    kick_n = int(0.32 * SR); tk = np.arange(kick_n) / SR
    kick = np.sin(2 * np.pi * np.cumsum(45 + 90 * np.exp(-tk / 0.03)) / SR) * _env(kick_n, 0.002, 0.12)
    clap = rng.standard_normal(int(0.18 * SR)) * _env(int(0.18 * SR), 0.001, 0.05)
    clap = A.filt(clap, 'band', [900, 3500], 2)
    hat = A.filt(rng.standard_normal(int(0.06 * SR)), 'high', 7000, 2) * _env(int(0.06 * SR), 0.001, 0.015)
    for b in range(bars * 4):
        t0 = int(b * beat * SR); bar = b // 4; groove = bar >= intro_bars
        if groove and not airy:
            A.place(x, kick * 0.9, t0 / SR)
            if b % 4 in (1, 3): A.place(x, clap * 0.35, t0 / SR)
        elif groove and airy and b % 2 == 0:
            A.place(x, kick * 0.6, t0 / SR)
        for h in (0, 0.5):
            A.place(x, hat * (0.12 if h else 0.18) * (0.6 if not groove else 1), t0 / SR + h * beat)
        if groove:                                                                    # bass: the chord root, one note per beat
            f = _hz(root + prog[bar % 4] - 12 * (0 if airy else 0)); m = int(beat * 0.9 * SR); tt = np.arange(m) / SR
            A.place(x, 0.22 * np.sin(2 * np.pi * f * tt) * _env(m, 0.004, beat * 0.5), t0 / SR)
    for bar in range(bars + 1):                                                       # pad: one chord per bar, soft attack
        r = root + 12 + prog[bar % 4]; m = int(4 * beat * SR * (1.6 if bar == bars else 1.0)); tt = np.arange(m) / SR
        ch = sum(np.sin(2 * np.pi * _hz(r + iv) * tt + k) for k, iv in enumerate((0, third, 7)))
        env = np.minimum(1, tt / 0.4) * np.minimum(1, (m / SR - tt) / 0.3)
        A.place(x, (0.05 if not airy else 0.08) * ch * env, bar * 4 * beat)
    x = x[:n]; x = x / (np.abs(x).max() + 1e-9) * 0.7
    x[:, 1] = np.roll(x[:, 1], int(0.0007 * SR))                                       # a touch of width
    return A.gain_to(x, -14.0)


def ensure(card):
    """the audio file of a placeholder card (rendered into the cache on first use); returns its path"""
    p = card.get('placeholder') or {}
    sig = hashlib.sha1(repr(sorted(p.items())).encode()).hexdigest()[:8]
    out = os.path.join(cache_dir(), f"{card['id']}-{sig}.flac")
    if not os.path.exists(out):
        x = synth(bpm=float(p.get('bpm', 102)), bars=int(p.get('bars', 24)), key=p.get('key', 'A'), minor=bool(p.get('minor', True)),
                  intro_bars=int(p.get('introBars', 4)), seed=int(p.get('seed', 1)), airy=bool(p.get('airy', False)))
        tmp = out + '.part.flac'; A.write(tmp, x); os.replace(tmp, out)
    return out
