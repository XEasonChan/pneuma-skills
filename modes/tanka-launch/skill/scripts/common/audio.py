"""Audio core for the stage scripts (numpy + scipy only; I/O through ffmpeg, so no soundfile / pyloudnorm needed).
Everything works at 48 kHz, stereo float64 arrays of shape (n, 2).

  load / write            ffmpeg decode / encode (.wav .flac .mp3 .m4a .aac by extension)
  lufs / true_peak_db     ITU-R BS.1770-4 integrated loudness (K-weighting, 400 ms blocks, -70 / -10 LU gates); 4x-oversampled TP
  limiter                 look-ahead true-peak limiter (the only master stage: no re-normalising a mix afterwards)
  duck_gain               the VO duck (depth dB, attack / release s)
  filt, high_shelf, darken, soften, reverb, echo, hall, noise_sweep, env100, peak100, place, mx, st
"""
import os, subprocess, math, numpy as np
import scipy.signal as ss

SR = 48000
TAU = 2 * np.pi


def db(x): return 10 ** (np.asarray(x, dtype=float) / 20)
def todb(x): return 20 * np.log10(np.maximum(np.asarray(x, dtype=float), 1e-12))
def st(x): x = np.asarray(x, float); return np.stack([x, x], 1) if x.ndim == 1 else x


# ------------------------------------------------------------------ I/O
def load(path, sr=SR, mono=False):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vn', '-ac', '1' if mono else '2', '-ar', str(sr), '-f', 'f32le', '-'], capture_output=True)
    if raw.returncode: raise SystemExit(f'ffmpeg could not decode {path}: {raw.stderr[:300]!r}')
    x = np.frombuffer(raw.stdout, np.float32).astype(np.float64)
    return x if mono else x.reshape(-1, 2)


def load_pcm(path, sr_in=44100, sr=SR):
    """raw ElevenLabs pcm_44100 (s16le stereo) -> 48 k float"""
    x = np.fromfile(path, '<i2').astype(np.float64).reshape(-1, 2) / 32768
    return ss.resample_poly(x, 160, 147, axis=0) if (sr_in, sr) == (44100, 48000) else ss.resample_poly(x, sr, sr_in, axis=0)


def write(path, x, sr=SR, bitrate='192k', bits=24):
    x = st(np.asarray(x, float)); os.makedirs(os.path.dirname(os.path.abspath(path)) or '.', exist_ok=True)
    ext = os.path.splitext(path)[1].lower()
    codec = {'.wav': ['-c:a', 'pcm_s24le'], '.flac': ['-c:a', 'flac', '-sample_fmt', 's32' if bits > 16 else 's16'], '.mp3': ['-c:a', 'libmp3lame', '-b:a', bitrate],
             '.m4a': ['-c:a', 'aac', '-b:a', bitrate, '-movflags', '+faststart'], '.aac': ['-c:a', 'aac', '-b:a', bitrate]}.get(ext)
    if codec is None: raise SystemExit(f'unsupported audio extension: {path}')
    y = np.clip(x, -1, 1).astype(np.float32)
    r = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(sr), '-ac', '2', '-i', '-', *codec, path], input=y.tobytes(), capture_output=True)
    if r.returncode: raise SystemExit(f'ffmpeg could not write {path}: {r.stderr[:300]!r}')
    return path


def fit(x, n):
    """pad with silence / trim to exactly n samples"""
    x = st(x); return np.pad(x, ((0, max(0, n - len(x))), (0, 0)))[:n]


# ------------------------------------------------------------------ loudness (BS.1770-4)
def _kweight_sos(sr):
    # pre-filter (high shelf ~ +4 dB above 1.5 kHz) and RLB high-pass, designed for any sr (pyloudnorm's derivation)
    G, Q, fc = 3.999843853973347, 0.7071752369554196, 1681.974450955533
    A = 10 ** (G / 40); K = np.tan(np.pi * fc / sr); Vh = 10 ** (G / 20); Vb = Vh ** 0.4996667741545416
    a0 = 1 + K / Q + K * K
    b1 = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0]
    a1 = [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
    Q2, fc2 = 0.5003270373238773, 38.13547087602444; K2 = np.tan(np.pi * fc2 / sr)
    a02 = 1 + K2 / Q2 + K2 * K2
    b2 = [1, -2, 1]; a2 = [1, 2 * (K2 * K2 - 1) / a02, (1 - K2 / Q2 + K2 * K2) / a02]
    return np.array([b1 + a1, b2 + a2])


def lufs(x, sr=SR):
    """integrated loudness (LUFS); -inf-safe (returns -120 for silence)"""
    x = st(x)
    if len(x) < int(0.4 * sr) or np.abs(x).max() < 1e-9: return -120.0
    y = ss.sosfilt(_kweight_sos(sr), x, axis=0)
    blk, hop = int(0.4 * sr), int(0.1 * sr)
    n = 1 + (len(y) - blk) // hop
    p = (y ** 2).sum(1)                                            # L + R, G = 1
    c = np.concatenate([[0.0], np.cumsum(p)])
    z = (c[np.arange(n) * hop + blk] - c[np.arange(n) * hop]) / blk
    lk = -0.691 + 10 * np.log10(z + 1e-20)
    g = z[lk > -70]
    if not len(g): return -120.0
    rel = -0.691 + 10 * np.log10(g.mean()) - 10
    g2 = z[(lk > -70) & (lk > rel)]
    return float(-0.691 + 10 * np.log10(g2.mean())) if len(g2) else -120.0


def true_peak_db(x):
    up = ss.resample_poly(st(x), 4, 1, axis=0); return float(todb(np.abs(up).max()))


def gain_to(x, target_lufs):
    return x * db(target_lufs - lufs(x))


def limiter(x, ceiling_db=-1.6, look=0.005, release=0.08):
    """look-ahead brick-wall on a 4x-oversampled peak estimate (true-peak safe to ~0.1 dB), release 80 ms"""
    x = st(x)
    up = np.abs(ss.resample_poly(x, 4, 1, axis=0)).max(1)
    up = np.pad(up, (0, max(0, 4 * len(x) - len(up))))[:4 * len(x)].reshape(-1, 4).max(1)
    thr = db(ceiling_db); g = np.minimum(1.0, thr / np.maximum(up, 1e-9))
    if g.min() >= 1.0: return x.copy()
    from scipy.ndimage import minimum_filter1d
    la = int(look * SR); g = minimum_filter1d(g, 2 * la + 1)
    # release: a one-pole recovery, attack instant (computed per 32-sample block for speed, then interpolated)
    a = math.exp(-1 / (release * SR)); out = np.empty_like(g); cur = 1.0
    B = 32; nb = (len(g) + B - 1) // B; gb = np.array([g[i * B:(i + 1) * B].min() for i in range(nb)])
    ob = np.empty(nb); aB = a ** B
    for i, v in enumerate(gb):
        cur = v if v < cur else aB * cur + (1 - aB) * v; ob[i] = cur
    out = np.minimum(np.repeat(ob, B)[:len(g)], g)
    return x * out[:, None]


def limit_to_ceiling(x, ceiling_db):
    """limiter + a final safety trim so the 4x TP never exceeds the ceiling"""
    y = limiter(x, ceiling_db)
    tp = true_peak_db(y)
    if tp > ceiling_db: y = y * db(ceiling_db - tp - 0.02)
    return y


# ------------------------------------------------------------------ filters / dynamics
def filt(x, kind, f, order=2):
    kind = {'low': 'lowpass', 'high': 'highpass', 'band': 'bandpass', 'lowpass': 'lowpass', 'highpass': 'highpass', 'bandpass': 'bandpass'}[kind]
    if np.ndim(f) == 0: f = min(float(f), SR / 2 * 0.98)
    else: f = [max(1.0, f[0]), min(f[1], SR / 2 * 0.98)]
    return ss.sosfiltfilt(ss.butter(order, f, kind, fs=SR, output='sos'), x, axis=0)


def high_shelf(x, f0=5000.0, gain_db=-4.0):
    """RBJ biquad high shelf (S = 1): the E1-style bed shelf is -4 dB at 5 kHz"""
    A = 10 ** (gain_db / 40); w0 = 2 * np.pi * f0 / SR; al = np.sin(w0) / 2 * np.sqrt(2); c = np.cos(w0); sA = 2 * np.sqrt(A) * al
    b = np.array([A * ((A + 1) + (A - 1) * c + sA), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sA)])
    a = np.array([(A + 1) - (A - 1) * c + sA, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sA])
    return ss.lfilter(b / a[0], a / a[0], x, axis=0)


def darken(x, lp=5500, shelf_db=-3.5, f_shelf=2000):
    y = filt(x, 'low', lp); hp = filt(y, 'high', f_shelf); return y + (db(shelf_db) - 1) * hp


def soften(x, ms=3.0, drive=1.6):
    x = st(x).copy(); n = min(len(x), int(ms / 1000 * SR)); x[:n] *= np.linspace(0, 1, n)[:, None] ** 1.5
    pk = np.abs(x).max() + 1e-12; return np.tanh(drive * x / pk) / np.tanh(drive) * pk


def env100(x):
    p = (st(x) ** 2).mean(1); k = int(0.1 * SR); return np.convolve(p, np.ones(k) / k, 'same')


def peak100(x): return float(todb(np.sqrt(env100(x)).max()))


def duck_gain(n, spans, depth_db=9.0, att=0.25, rel=0.5):
    """spans [(start, dur)] -> linear gain: full depth from each span's start (reached over `att` before it) to its end,
    released over `rel` after it"""
    g = np.zeros(n); t = np.arange(n) / SR
    for a, d in spans:
        b = a + d
        i0, i1 = max(0, int((a - att - 0.01) * SR)), min(n, int((b + rel + 0.01) * SR))
        if i1 <= i0: continue
        tt = t[i0:i1]
        up = np.clip((tt - (a - att)) / att, 0, 1); dn = np.clip(1 - (tt - b) / rel, 0, 1)
        g[i0:i1] = np.maximum(g[i0:i1], np.minimum(up, dn))
    return db(-depth_db * g)


def place(buf, x, at):
    x = st(x); i = int(round(at * SR))
    if i < 0: x = x[-i:]; i = 0
    n = min(len(x), len(buf) - i)
    if n > 0: buf[i:i + n] += x[:n]


def mx(*parts):
    """sum stereo parts (array or (array, delay_s, gain)) of any length"""
    ps = [(q, 0.0, 1.0) if isinstance(q, np.ndarray) else (q[0], q[1], q[2] if len(q) > 2 else 1.0) for q in parts]
    n = max(int(d * SR) + len(st(a)) for a, d, _ in ps); y = np.zeros((n, 2))
    for a, d, g in ps: a = st(a); i = int(d * SR); y[i:i + len(a)] += a * g
    return y


def fade_tail(x, sec=0.02):
    x = st(x).copy(); k = min(len(x) // 3, int(sec * SR))
    if k > 0: x[-k:] *= np.linspace(1, 0, k)[:, None]
    return x


def tune(x, semis):
    return ss.resample(x, int(round(len(x) / 2 ** (semis / 12))), axis=0) if semis else x


def noise_sweep(dur, f0, f1, q=1.2, shape='hann', seed=0):
    g = np.random.default_rng(seed); n = int(dur * SR); src = g.standard_normal((n, 2)); y = np.zeros((n, 2)); blk = int(0.01 * SR)
    for i in range(0, n, blk):
        fc = f0 * (f1 / f0) ** (i / n); lo, hi = fc / (1 + 1 / q), min(fc * (1 + 1 / q), 20000)
        seg = src[max(0, i - 2 * blk):i + blk]
        yy = ss.sosfiltfilt(ss.butter(2, [lo, hi], 'band', fs=SR, output='sos'), seg, axis=0)
        m = min(blk, n - i); y[i:i + m] = yy[-m:] if len(yy) >= m else yy[:m]
    w = np.hanning(n) if shape == 'hann' else (np.linspace(0, 1, n) ** 2.2 if shape == 'rise' else np.linspace(1, 0, n) ** 1.5)
    return y * w[:, None]


# ------------------------------------------------------------------ reverb (synthetic stereo IRs)
def _decay(t, t60): return np.exp(-6.907755 * t / max(t60, 1e-4))


def make_ir(t60=(3.2, 2.6, 1.2), xo=(400, 3000), predelay=0.025, er=8, width=1.0, seed=99, damp_hf=9000):
    g = np.random.default_rng(seed); L = int(max(t60) * 1.2 * SR); t = np.arange(L) / SR; ir = np.zeros((L, 2))
    for ch in range(2):
        nz = g.standard_normal(L)
        lo = filt(nz, 'low', xo[0]); hi = filt(nz, 'high', xo[1]); mid = nz - lo - hi
        y = lo * _decay(t, t60[0]) + mid * _decay(t, t60[1]) + hi * _decay(t, t60[2])
        y *= 1 - np.exp(-t / 0.025)
        for _ in range(er):
            d = int(g.uniform(0.007, 0.06) * SR); y[d] += g.uniform(-1, 1) * 3.0
        ir[:, ch] = filt(y, 'low', damp_hf, 1)
    m = ir.mean(1, keepdims=True); ir = m + width * (ir - m)
    ir = np.vstack([np.zeros((int(predelay * SR), 2)), ir])
    return ir / np.sqrt((ir ** 2).sum() / 2)


IR_PRESETS = {
    'temple': dict(t60=(5.5, 4.2, 1.8), predelay=0.04, er=10, width=1.0, seed=101),
    'hall': dict(t60=(3.4, 2.8, 1.3), predelay=0.028, er=8, width=0.95, seed=102),
    'room': dict(t60=(1.2, 1.0, 0.5), predelay=0.012, er=12, width=0.8, seed=103),
}
_IR = {}


def reverb(x, preset='hall', wet=0.3):
    if preset not in _IR: _IR[preset] = make_ir(**IR_PRESETS[preset])
    ir = _IR[preset]; x = st(x)
    w = np.stack([ss.fftconvolve(x[:, 0], ir[:, 0]), ss.fftconvolve(x[:, 1], ir[:, 1])], 1)[:len(x)]
    return w * wet


def hall(x, wet=0.5, preset='hall', tail=3.5):
    pad = np.pad(st(x), ((0, int(tail * SR)), (0, 0))); return pad + reverb(pad, preset, wet)


def echo(x, delay=0.5, fb=0.45, n=5, lp=3200, pingpong=True):
    x = st(x); out = np.zeros((len(x) + int(delay * SR * (n + 1)), 2)); out[:len(x)] += x; y = x.copy()
    for k in range(1, n + 1):
        y = filt(y, 'low', lp) * fb; i = int(k * delay * SR)
        out[i:i + len(y)] += y[:, ::-1] if (pingpong and k % 2) else y
    return out


def trim_silence(x, thr_db=-40, pre=0.02, post=0.06):
    e = np.sqrt(np.convolve((st(x) ** 2).mean(1), np.ones(480) / 480, 'same')); on = np.where(e > e.max() * db(thr_db))[0]
    if not len(on): return x
    return x[max(0, on[0] - int(pre * SR)):min(len(x), on[-1] + int(post * SR))]


def band_peak_db(x, a, b, lo=1500, hi=6000):
    """100 ms RMS peak (dB) of x's lo-hi band between a and b seconds"""
    seg = st(x)[max(0, int(a * SR)):max(int(a * SR) + 1, int(b * SR))]
    if len(seg) < 64: return -120.0
    z = filt(seg, 'band', [lo, hi]); return peak100(z)
