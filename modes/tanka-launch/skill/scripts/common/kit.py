"""Procedural SFX voices (deterministic, numpy + scipy). Two sets share one event map (sfx/render.py):

  Set A "paper & key"  soft, dark paper / felt / key timbres (the SOFT + SNAP recipe)
  Set E "electronic"   tight soft synthetic clicks, muted FM / sine plucks, sub thumps (matched to E1-style groove beds)

Style rules (the default sound palette; edit references/style-presets.md sfx-palette): low-mid, rounded transients, never bright
whooshes; the `rain` drops (raindrops on a leaf) are the ONLY water-like sound; an entrance is a full swell + bloom with a DRY 0.4 s fade
(no echo tail); one detent per ratchet notch; no piano, marimba, glockenspiel, drones or pads."""
import numpy as np
import audio as A
from audio import SR, st, filt, mx, env100, noise_sweep
import beats as B


def env(n, a, d):
    t = np.arange(n) / SR; return np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / max(d, 1e-4))


def att(n, ms):
    e = np.ones(n); k = min(n, int(ms / 1000 * SR)); e[:k] = np.sin(np.linspace(0, np.pi / 2, k)) ** 2; return e


# ------------------------------------------------------------------ shared building blocks
def soft_tone(f, dur=0.7, bright=0.18, felt=0.05, seed=0):
    g = np.random.default_rng(seed); n = int((dur + 0.2) * SR); t = np.arange(n) / SR
    y = np.sin(2 * np.pi * f * t) + bright * np.sin(4 * np.pi * f * t) * np.exp(-t / (dur * 0.3)) + 0.04 * np.sin(6 * np.pi * f * t) * np.exp(-t / (dur * 0.15))
    y2 = np.sin(2 * np.pi * f * 1.0023 * t + 0.7); e = env(n, 0.006, dur / 3.2)
    nz = filt(g.standard_normal(n), 'low', 1800) * np.exp(-t / 0.012) * felt
    return filt(np.stack([(y + 0.35 * y2) * e + nz, (0.95 * y + 0.4 * y2) * e + nz], 1), 'low', 4200)


def sine_hit(f=65.4, dur=0.9, seed=0):
    g = np.random.default_rng(seed); n = int(dur * SR); t = np.arange(n) / SR
    y = np.sin(2 * np.pi * f * t) * env(n, 0.004, dur / 3.5) + 0.3 * np.sin(4 * np.pi * f * t) * env(n, 0.003, dur / 8)
    y += filt(g.standard_normal(n), 'low', 900) * np.exp(-t / 0.01) * 0.15
    return st(np.tanh(1.3 * y) / 1.3)


def felt_tap(f0=150, seed=27):
    g = np.random.default_rng(seed); n = int(0.2 * SR); t = np.arange(n) / SR; f = f0 * g.uniform(0.92, 1.08)
    y = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.07 * 6.9 / 6.9) * np.exp(-t / 0.05) + 0.25 * np.sin(2 * np.pi * f * 4.1 * t) * np.exp(-t / 0.012)
    y += 0.08 * filt(g.standard_normal(n), 'low', 1500) * np.exp(-t / 0.008)
    return st(y * att(n, 3))


def paper_grain(dur=0.03, lo=1200, hi=4500, seed=0):
    g = np.random.default_rng(seed); n = int((dur + 0.02) * SR); t = np.arange(n) / SR
    y = filt(g.standard_normal(n), 'band', [lo, hi]) * (0.6 + 0.4 * g.random(n)) * att(n, 2) * np.exp(-t / dur)
    return st(y)


def lotus_drop(f, seed=0):
    """a raindrop on a lotus leaf: a rounded low-mid tap (damped body at f with a slight downward settle, a hollow 2nd mode, a
    felt-like transient, a tiny wet tail), low-passed 3.2 kHz; never a rising 'plip'"""
    g = np.random.default_rng(seed); n = int(0.45 * SR); t = np.arange(n) / SR
    fi = f * (1 + 0.04 * np.exp(-t / 0.03))
    body = np.sin(2 * np.pi * np.cumsum(fi) / SR) * np.exp(-t / 0.045)
    hollow = 0.28 * np.sin(2 * np.pi * np.cumsum(fi * 2.31) / SR) * np.exp(-t / 0.016)
    tr = filt(g.standard_normal(n), 'low', 2400) * np.exp(-t / 0.003) * 0.35
    tail = filt(g.standard_normal(n), 'band', [900, 2600]) * np.exp(-t / 0.09) * 0.05
    return st(filt((body + hollow + tr + tail) * np.minimum(1, t / 0.0015), 'low', 3200))


def spin_whoosh(dur=1.7, peak=0.5, seed=31):
    """the ring turn: a dark rotating air turn (180-900 Hz band, pan turns once), low-passed 1.5 kHz"""
    n = int(dur * SR); t = np.arange(n) / SR
    y = noise_sweep(dur, 180, 900, 0.9, 'hann', seed).mean(1)
    e = np.where(t < peak, (t / peak) ** 1.6, np.exp(-(t - peak) / (0.35 * (dur - peak))))
    ph = 2 * np.pi * np.cumsum(e) / e.sum()
    return filt(np.stack([y * e * (0.6 + 0.4 * np.cos(ph)), y * e * (0.6 - 0.4 * np.cos(ph))], 1), 'low', 1500)


def orbit_bed(dur, seed=5):
    g = np.random.default_rng(seed); n = int(dur * SR); t = np.arange(n) / SR
    wn = g.standard_normal(n); pink = filt(wn, 'low', 3000, 1) + 0.3 * wn
    y = filt(pink, 'band', [1200, 4500]); sh = 0.6 + 0.4 * np.sin(2 * np.pi * 0.5 * t + 1.0); ph = 2 * np.pi * 0.28 * t
    e = np.minimum(1, t / 0.8) * np.minimum(1, (dur - t) / 0.9)
    return filt(np.stack([y * sh * (0.55 + 0.45 * np.cos(ph)), y * sh * (0.55 - 0.45 * np.cos(ph))], 1) * e[:, None], 'low', 2400) * 1.3


def orb_breath(t0, t1, cyc0, period=4.0, f=116.5, seed=41):
    """the assistant's orb breathing: an airy inhale / exhale in time with the orb (ethereal, low) + a very low hum, low-passed 3 kHz"""
    g = np.random.default_rng(seed); n = int((t1 - t0) * SR); t = np.arange(n) / SR + t0
    b = np.sin(2 * np.pi * (t - cyc0) / period); amp = np.clip((b + 1) / 2, 0, 1) ** 2.2; inhale = np.gradient(b) > 0
    nzb = filt(filt(g.standard_normal(n), 'low', 1800, 1), 'band', [160, 2600])
    hum = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 1.5 * t + 0.4) + 0.2 * np.sin(4 * np.pi * f * t)
    y = nzb * (0.8 + 0.4 * inhale) * amp + 0.18 * hum * amp
    e = np.minimum(1, (t - t0) / 0.5) * np.minimum(1, (t1 - t) / 0.9)
    return filt(np.stack([y * e, np.roll(y, 240) * e], 1), 'low', 3000)


PEAK_AT = 0.75
def entrance(notes, d=2.8, dry=True):
    """the assistant entrance (option B): a detuned sine triad + a low-pass opening 500 Hz -> 4.5 kHz into the landing (the bloom
    peaks PEAK_AT s after the start); dry = NO shimmer / echo tail, a 0.4 s raised-cosine decay after the bloom"""
    t = np.arange(int(d * SR)) / SR; P = PEAK_AT
    e = (np.where(t < P, np.sin(np.clip(t / P, 0, 1) * np.pi / 2) ** 2, 0.5 + 0.5 * np.cos(np.pi * np.clip((t - P) / 0.4, 0, 1))) if dry
         else np.where(t < P, np.sin(np.clip(t / P, 0, 1) * np.pi / 2) ** 2, np.exp(-(t - P) / 1.0)))
    y = sum(g * (np.sin(2 * np.pi * f * t) + np.sin(2 * np.pi * f * 1.0035 * t + 0.5) + np.sin(2 * np.pi * f * 0.9965 * t + 1.7)) for f, g in zip(notes, (1.0, 0.6, 0.35)))
    x = np.stack([y * e, np.roll(y * e, 240)], 1); out = np.zeros_like(x); blk = int(0.02 * SR)
    for i in range(0, len(x), blk):
        fc = 500 + 4000 * min(1, (i / SR) / P) ** 1.5; seg = x[max(0, i - 4 * blk):i + blk]
        m = min(blk, len(x) - i); out[i:i + m] = filt(seg, 'low', fc)[-m:]
    return out[:int((P + 0.42) * SR)] if dry else out


# ------------------------------------------------------------------ Set E primitives (mixA)
def e_click(fc=1500, body=None, dur=0.0028, seed=0, lp=4200):
    g = np.random.default_rng(seed); n = int(0.07 * SR); t = np.arange(n) / SR
    nz = filt(g.standard_normal(n) * np.exp(-t / dur), 'band', [fc * 0.6, min(fc * 1.6, 9000)])
    y = nz / (np.abs(nz).max() + 1e-12)
    if body: y = y + 0.55 * np.sin(2 * np.pi * body * t) * np.exp(-t / 0.018)
    return st(filt(y * att(n, 1.2), 'low', lp))


def fm_pluck(f, dur=0.35, index=1.1, ratio=1.0, lp=2600, sub=0.25):
    n = int((dur + 0.15) * SR); t = np.arange(n) / SR; I = index * np.exp(-t / 0.035)
    y = np.sin(2 * np.pi * f * t + I * np.sin(2 * np.pi * f * ratio * t)) + sub * np.sin(np.pi * f * t)
    y2 = np.sin(2 * np.pi * f * 1.003 * t + 0.6 + I * np.sin(2 * np.pi * f * ratio * t))
    e = att(n, 4) * np.exp(-t / (dur / 3.5))
    x = filt(np.stack([(y + 0.3 * y2) * e, (0.95 * y + 0.35 * y2) * e], 1), 'low', lp); pk = np.abs(x).max() + 1e-12
    return np.tanh(1.3 * x / pk) / np.tanh(1.3) * pk


def sub_thump(f=60, dur=0.28, drop=0.7):
    n = int((dur + 0.1) * SR); t = np.arange(n) / SR
    fi = f * (1 + drop * np.exp(-t / 0.025)); y = np.sin(2 * np.pi * np.cumsum(fi) / SR) * att(n, 3) * np.exp(-t / (dur / 3))
    return st(filt(np.tanh(1.5 * y) / np.tanh(1.5), 'low', 900))


def synth_stab(freqs, dur=1.4, lp0=2200, lp1=700):
    n = int((dur + 0.3) * SR); t = np.arange(n) / SR; y = np.zeros((n, 2))
    for j, f in enumerate(freqs):
        for d, pan in ((1.0, 0.35), (1.004, -0.35)):
            v = sum(np.sin(2 * np.pi * f * d * k * t + j + k) / k for k in range(1, 9) if f * k < 6000)
            y[:, 0] += v * (1 - max(0, pan)); y[:, 1] += v * (1 + min(0, pan))
    y *= (att(n, 10) * np.exp(-t / (dur / 3)))[:, None]
    out = np.zeros_like(y); blk = int(0.02 * SR)
    for i in range(0, n, blk):
        fc = lp1 + (lp0 - lp1) * np.exp(-(i / SR) / 0.35); seg = y[max(0, i - 4 * blk):i + blk]; m = min(blk, n - i)
        out[i:i + m] = filt(seg, 'low', fc)[-m:]
    return out


def e_swish(dur=0.1, f0=500, f1=1500, seed=0):
    return filt(noise_sweep(dur, f0, f1, 1.2, 'hann', seed), 'low', 2400)


def chord_swell(pc, dur=1.5):
    rr, qq = B.triad(pc); fr = [B.midi_hz(48 + rr), B.midi_hz(55 + rr), B.midi_hz(60 + (rr + qq) % 12)]
    n = int(dur * SR); tv = np.arange(n) / SR
    y = sum(np.sin(2 * np.pi * f * k * tv + k) / k for f in fr for k in range(1, 6)) * (tv / dur) ** 2.2
    out = np.zeros(n); blk = int(0.02 * SR)
    for i in range(0, n, blk):
        fc = 250 + 1100 * (i / n) ** 2; seg = y[max(0, i - 4 * blk):i + blk]; m = min(blk, n - i); out[i:i + m] = filt(seg, 'low', fc)[-m:]
    return st(out * np.minimum(1, (dur - tv) / 0.03))


# ------------------------------------------------------------------ the dark air group (shared by both sets; SOFT recipe)
AIR = {
    'whoosh': lambda: filt(noise_sweep(0.5, 220, 1100, 1.0, 'hann', 21), 'low', 2200),
    'swipe': lambda: filt(noise_sweep(0.3, 350, 1500, 1.1, 'hann', 22), 'low', 2600),
    'push': lambda: filt(noise_sweep(0.7, 160, 800, 0.9, 'hann', 23), 'low', 1600),
    'scan': lambda: filt(noise_sweep(0.45, 300, 1700, 1.4, 'rise', 24), 'low', 2600),
    'send': lambda: filt(noise_sweep(0.28, 400, 1600, 1.2, 'hann', 25), 'low', 2600),
    'riser': lambda: filt(noise_sweep(1.5, 200, 2400, 1.3, 'rise', 26), 'low', 3000),
    'breath': lambda: filt(noise_sweep(0.45, 180, 700, 0.8, 'hann', 27), 'low', 1400),
}

GROUP = {'ratchet': 'key', 'spin': 'air', 'arrival': 'low', 'orbbreath': 'air', 'whoosh': 'air', 'swipe': 'air', 'push': 'air', 'scan': 'air', 'send': 'air',
         'riser': 'air', 'bed': 'air', 'breath': 'air', 'dusk': 'air', 'flip': 'paper', 'open': 'paper', 'dock': 'paper', 'tap': 'paper', 'tuck': 'paper', 'post': 'paper',
         'tick': 'key', 'lock': 'key', 'click': 'key', 'typing': 'key', 'typeacc': 'key', 'tone': 'tone', 'confirm': 'tone', 'found': 'tone', 'notify': 'tone',
         'alert': 'tone', 'chime': 'tone', 'assist': 'tone', 'approve': 'tone', 'fix': 'tone', 'allok': 'tone', 'entrance': 'tone', 'lowhit': 'low', 'rain': 'rain'}
SOFT_GAIN = {'air': -4.0, 'paper': -2.5, 'key': -2.5, 'tone': -2.5, 'low': -2.5, 'rain': -1.0}   # SFX ~ -2.5 dB, whooshes ~ -4 dB


def ui_click(lib=None, seed=0):
    """the ui-click sample from the seed library when present, else a procedural soft key click"""
    import os
    if lib and os.path.exists(os.path.join(lib, 'ui-click.mp3')): return A.darken(A.load(os.path.join(lib, 'ui-click.mp3')), 6000, -2)
    g = np.random.default_rng(seed); n = int(0.06 * SR); t = np.arange(n) / SR
    c = filt(filt(g.standard_normal(n), 'high', 1500), 'low', 6000) * np.exp(-t / 0.003)
    b = np.sin(2 * np.pi * 900 * t) * np.exp(-t / 0.01) + 0.6 * np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.02)
    return st((0.6 * c + 0.3 * b) * att(n, 0.8))


def ui_typing(dur, lib=None, seed=0):
    """a typing run: the ui-typing sample (looped) when present, else procedural keystrokes (thock + switch), ~9 keys/s"""
    import os
    n = int(dur * SR)
    if lib and os.path.exists(os.path.join(lib, 'ui-typing.mp3')):
        s = A.load(os.path.join(lib, 'ui-typing.mp3')); reps = int(np.ceil(n / len(s))) + 1
        return A.fade_tail(np.tile(s, (reps, 1))[:n], 0.15)
    g = np.random.default_rng(seed); y = np.zeros((n + SR // 5, 2)); t = 0.0
    while t < dur:
        k = int(0.12 * SR); tt = np.arange(k) / SR; f0 = g.uniform(160, 240) * (1 + 0.5 * np.exp(-tt / 0.006))
        body = np.sin(2 * np.pi * np.cumsum(f0) / SR) * np.exp(-tt / 0.028)
        clk = filt(g.standard_normal(k), 'high', 2500) * np.exp(-tt / 0.0035)
        A.place(y, st((0.6 * body + 0.35 * clk) * g.uniform(0.6, 1.0)), t); t += g.uniform(0.07, 0.16)
    return A.fade_tail(y[:n], 0.1)


def ratchet_A(i, n, lib=None, seed=0):
    """one felt detent of the vernier ratchet (Set A): the ui-click low-passed 2.2 kHz + a tiny low body; each notch a hair lower / softer"""
    g = np.random.default_rng(seed + i)
    x = filt(ui_click(lib, seed + i), 'low', 2200); x = A.tune(x, -0.6 * i / max(1, n - 1) + g.uniform(-0.25, 0.25))
    return mx(x, (sine_hit(B.hz('G2') * 2 ** (g.uniform(-0.2, 0.2) / 12), 0.07) * 0.12, 0, 1.0)) * A.db(-1.0 * i / max(1, n - 1) + g.uniform(-0.7, 0.7))


# ------------------------------------------------------------------ Set A samples (optional, supplied by the run)
SET_A_SAMPLES = {'flip': ('flip', 9000), 'open': ('flip', 9000), 'dock': ('dock', 5000), 'tap': ('tap', 6000), 'post': ('tap', 6000),
                 'tuck': ('tuck', 4500), 'lowhit': ('lowhit', None)}


def set_a_sample(role, lib, r0=0):
    """a Set A sample for a role, if the run supplied one (seed-library/sfx/set-a/<name>.mp3): low-passed, trimmed to its onset, 20 ms
    tail fade; lowhit tuned from a C-minor calibration (+7.7 st) to the bed's local root.
    None when the sample isn't there (the procedural voice is used)."""
    import os
    if not lib or role not in SET_A_SAMPLES: return None
    name, lp = SET_A_SAMPLES[role]; p = os.path.join(lib, 'set-a', f'{name}.mp3')
    if not os.path.exists(p): return None
    x = st(A.load(p))
    if role == 'lowhit': x = A.tune(x, 7.7 + (((r0 - 0) + 6) % 12 - 6))
    if lp: x = filt(x, 'low', lp)
    on = np.where(np.abs(x).max(1) > np.abs(x).max() * 0.03)[0]
    x = x[max(0, on[0] - 120):] if len(on) else x
    return A.fade_tail(x, 0.02)


# ------------------------------------------------------------------ one voice per role and set
def voice(role, cue, set_, pc, P, lib=None):
    """-> (stereo array, note|None). pc = the bed's local chroma at the cue, P = the bed's beat period (s)."""
    tones = B.chord_tones(pc); r0 = B.triad(pc)[0]; root_lo = B.near_pc([r0], 58); note = None
    seed = int(cue['t'] * 1000) % 100000
    if role in AIR: return AIR[role](), None
    if role == 'spin': return spin_whoosh(cue.get('dur', 1.7), cue.get('peak', 0.5)), None
    if role == 'dusk': return filt(noise_sweep(cue.get('dur', 2.6), 420, 150, 0.8, 'hann', 28), 'low', 1100), None
    if role == 'bed': return orbit_bed(cue.get('dur', 4.0)), None
    if role == 'arrival':
        f = B.near_pc([r0], 49)
        return A.hall((sine_hit(f, 1.1) * 0.8) if set_ == 'A' else sub_thump(f, 1.0, 0.3), 0.35, 'temple', tail=2.0), None
    if set_ == 'A':
        smp = set_a_sample(role, lib, r0)
        if smp is not None: return smp, f'sample set-a/{SET_A_SAMPLES[role][0]}'
    if role == 'lowhit':
        big = cue.get('lvl', -11) > -8; f = B.near_pc([r0], 49 if big else 55)
        return (sine_hit(f, 1.4 if big else 1.0) if set_ == 'A' else sub_thump(f, 1.2 if big else 0.8, 0.5)), f'{f:.0f} Hz'
    if role == 'riser':
        return (AIR['riser']() if set_ == 'A' else chord_swell(pc, 1.9 if cue.get('dusk') else 1.5)), None
    if set_ == 'A':
        if role in ('tone', 'confirm'):
            f = B.snap_f(cue.get('f', 523.0), pc) if role == 'tone' else B.near_pc(tones, [392, 523, 440][cue.get('idx', 0) % 3])
            x = soft_tone(f, 0.6, seed=seed)
            x = A.hall(A.echo(x, P, 0.35, 3, 2600), 0.25, tail=2.0) if cue.get('echo') else A.hall(x, 0.15, 'room', tail=1.2)
            return x, f'{f:.0f} Hz'
        if role == 'found':
            f1, f2 = B.near_pc(tones, 523), B.near_pc([r0], 392)
            return mx(soft_tone(f1, 0.9, 0.2), (soft_tone(f2, 0.9), 0.09, 0.7)), f'{f1:.0f} -> {f2:.0f} Hz'
        if role in ('notify', 'assist', 'approve', 'fix'):
            f1, f2 = B.near_pc([tones[2]], 784), B.near_pc([r0], 523)
            if role == 'assist': f2 = sorted(B.near_pc([t_], 392) for t_ in tones)[cue.get('idx', 0) % 3]
            return mx(soft_tone(f1, 0.9, 0.22), (soft_tone(f2, 0.9), 0.09, 0.7)), f'{f1:.0f} / {f2:.0f} Hz'
        if role in ('chime', 'allok'):
            rr, qq = B.triad(pc); sv = 10 if qq == 3 else 11
            ns = [(B.midi_hz(60 + rr), 0.8), (B.midi_hz(67 + rr), 0.7), (B.midi_hz(72 + rr + qq), 0.55), (B.midi_hz(72 + rr + sv), 0.35)]
            return A.hall(mx(*[(soft_tone(f, 2.2, 0.12), i * 0.045, g_) for i, (f, g_) in enumerate(ns)]), 0.35, tail=2.5), f"{B.NAMES[rr]} {'minor' if qq == 3 else 'major'}(7)"
        if role == 'lock':          # the felt latch: a rounded low thump + a muted body, NO click
            x = mx((sine_hit(B.snap_f(B.hz('C3'), pc), 0.24), 0, 0.8), (filt(sine_hit(root_lo * 2, 0.08), 'low', 700), 0.0, 0.35))
            return A.soften(x, 8.0), None
        if role == 'ratchet': return ratchet_A(cue.get('i', 0), cue.get('n', 1), lib, seed), None
        if role == 'tick': return ui_click(lib, seed) * A.db(-3), None
        if role in ('flip', 'open'):
            return mx((paper_grain(0.035, 1200, 4200, seed), 0, 0.9), (paper_grain(0.025, 900, 3200, seed + 1), 0.07, 0.7), (felt_tap(170, seed), 0.08, 0.4)), None
        if role == 'dock': return mx((felt_tap(140, seed), 0, 1.0), (paper_grain(0.02, 1200, 3800, seed), 0.004, 0.5)), None
        if role in ('tap', 'post'): return mx((felt_tap(B.near_pc(tones, 330) / 2, seed), 0, 1.0), (paper_grain(0.012, 1500, 4000, seed), 0, 0.25)), None
        if role == 'tuck': return mx((filt(noise_sweep(0.12, 300, 900, 1.0, 'hann', seed), 'low', 1800), 0, 0.8), (felt_tap(120, seed), 0.09, 0.6)), None
        return soft_tone(B.near_pc(tones, 440), 0.4), None
    # ---------------- Set E
    if role == 'tone':
        f = B.near_pc(tones, cue.get('f', 523.0)); x = fm_pluck(f, 0.7, 0.8)
        return (A.hall(A.echo(x, P * 0.75, 0.35, 3, 2400), 0.25, tail=2.0) if cue.get('echo') else A.hall(x, 0.12, 'room', tail=1.2)), f'{f:.0f} Hz'
    if role == 'confirm':
        f = B.near_pc(tones, [392, 523, 440, 494][cue.get('idx', 0) % 4])
        return A.hall(mx(fm_pluck(f, 0.5, 1.0), (sub_thump(root_lo, 0.16, 0.5), 0, 0.35)), 0.12, 'room', tail=1.2), f'{f:.0f} Hz'
    if role == 'found':
        f1, f2 = B.near_pc([tones[2]], 523), B.near_pc([r0], 392)
        return A.hall(mx(fm_pluck(f1, 0.5, 0.9), (fm_pluck(f2, 0.8, 0.9), P / 4, 0.8)), 0.15, 'room', tail=1.2), f'{f1:.0f} -> {f2:.0f} Hz'
    if role == 'notify':
        f1, f2 = B.near_pc([tones[2]], 440), B.near_pc([r0], 587)
        return A.hall(mx(fm_pluck(f1, 0.45, 0.8), (fm_pluck(f2, 0.7, 0.8), P / 4, 0.75)), 0.15, 'room', tail=1.2), f'{f1:.0f} -> {f2:.0f} Hz'
    if role == 'assist':
        ladder = sorted(B.near_pc([t_], 392) for t_ in tones); k = cue.get('idx', 0); f = ladder[k % 3] * (2 if k >= 3 else 1)
        x = mx((e_swish(0.07, 400, 1300, 5 + k), 0, 0.55), (fm_pluck(f, 0.45, 1.0, 1.0, 2400, 0.3), 0.045, 1.0), (sub_thump(root_lo, 0.12, 0.4), 0.045, 0.3))
        return A.hall(x, 0.14, 'room', tail=1.2), f'{f:.0f} Hz'
    if role in ('approve', 'fix'):
        f1 = B.near_pc([r0], 523); f2 = B.near_pc([tones[2]], 660) if role == 'approve' else B.near_pc([tones[1]], 587)
        return A.hall(mx(fm_pluck(f1, 0.25, 0.6, 1.0, 2200, 0.2), (fm_pluck(f2, 0.4, 0.6, 1.0, 2200, 0.2), P / 4, 0.8)), 0.12, 'room', tail=1.2), None
    if role in ('chime', 'allok'):
        rr, qq = B.triad(pc); fr = [B.midi_hz(48 + rr), B.midi_hz(55 + rr), B.midi_hz(60 + rr), B.midi_hz(60 + rr + qq)]
        return A.hall(mx(synth_stab(fr, 1.8), (sub_thump(B.midi_hz(36 + rr), 0.6, 0.4), 0, 0.5)), 0.3, tail=2.5), f"{B.NAMES[rr]} {'minor' if qq == 3 else 'major'}"
    if role == 'lock':
        return A.soften(mx(sub_thump(root_lo, 0.26, 0.6), (fm_pluck(B.near_pc([r0], 262), 0.22, 0.5, 1.0, 1400, 0.3), 0.0, 0.45)), 8.0), None
    if role == 'ratchet':
        i, n = cue.get('i', 0), cue.get('n', 1)
        return e_click(1500 - 250 * i / max(1, n - 1), B.near_pc([r0], 880), 0.0022, seed=seed) * A.db(-1.0 * i / max(1, n - 1)), None
    if role == 'tick': return e_click(1700, B.near_pc(tones, 900), 0.0025, seed=seed), None
    if role in ('tap', 'post'):
        k = cue.get('tn', cue.get('idx', 0) if role == 'post' else 0); f = B.near_pc(tones, 330 * 1.12 ** k)
        return mx(fm_pluck(f, 0.16, 0.7, 1.0, 1800, 0.35), (e_click(1100, None, 0.002, seed), 0, 0.35)), f'{f:.0f} Hz'
    if role in ('flip', 'open'):
        return mx((e_swish(0.09, 500, 1500, seed % 97), 0, 0.8), (e_click(1300, B.near_pc(tones, 660), 0.0025, seed), 0.07, 0.8)), None
    if role == 'dock': return mx(sub_thump(root_lo, 0.22, 0.5), (fm_pluck(B.near_pc([r0], 196), 0.2, 0.6, 1.0, 1500, 0.3), 0, 0.6)), None
    if role == 'tuck':
        f1, f2 = B.near_pc([tones[2]], 294), B.near_pc([r0], 220)
        return mx(fm_pluck(f1, 0.12, 0.5, 1.0, 1500, 0.3), (fm_pluck(f2, 0.2, 0.5, 1.0, 1500, 0.3), P / 8, 0.9)), None
    return fm_pluck(B.near_pc(tones, 440), 0.3), None
