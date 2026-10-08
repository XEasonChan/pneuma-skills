"""Beat grid, key and harmony helpers (numpy + scipy; librosa not needed).

  onset_env(x)                   spectral-flux onset envelope (hop 128 @ 48 k = 2.7 ms)
  track(x)                       tempo (autocorrelation + a mild prior) and beats (Ellis dynamic programme)
  refine / full_grid / fit_grid  snap beats to transients, extend where onsets confirm, or fit a straight line to a machine-steady bed
  subgrid / quantise             16th / 32nd grids and the +-40 ms quantiser
  key_of / chroma / local_chroma / triad / chord_tones / near_pc   Krumhansl key, local harmony, pitch snapping
  hpss                           median-filter harmonic / percussive split (the stems for re-drumming)"""
import numpy as np
import scipy.signal as ss
from scipy.ndimage import median_filter

SR = 48000
NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
SCALE = None   # the bed's scale (pitch classes); triads are kept inside it when set


def mono(x): return x.mean(1) if np.ndim(x) == 2 else x


def onset_env(x, hop=128, nfft=1024, lo=None, hi=None):
    f, t, Z = ss.stft(mono(x), SR, nperseg=nfft, noverlap=nfft - hop, boundary=None, padded=False)
    A = np.log1p(np.abs(Z) * 100)
    if lo is not None or hi is not None:
        sel = (f >= (lo or 0)) & (f <= (hi or SR / 2)); A = A[sel]
    fl = np.maximum(np.diff(A, axis=1), 0).sum(0)
    return t[1:], fl


def tempo(x, lo=60, hi=180, prior=110.0, hop=512):
    """global tempo (BPM) from the onset envelope's autocorrelation, with a log-normal prior around `prior`"""
    t, o = onset_env(x, hop=hop, nfft=2048)
    o = o - np.convolve(o, np.ones(64) / 64, 'same'); o = np.maximum(o, 0)
    ac = np.correlate(o, o, 'full')[len(o) - 1:]; dt = hop / SR
    lags = np.arange(len(ac)) * dt
    w = (lags >= 60 / hi) & (lags <= 60 / lo)
    if not w.any(): return prior
    bpm = 60 / lags[w]; score = ac[w] * np.exp(-0.5 * (np.log2(bpm / prior) / 0.9) ** 2)
    i = int(np.argmax(score)); l0 = lags[w][i]
    # parabolic refinement
    j = np.where(w)[0][i]
    if 0 < j < len(ac) - 1:
        a, b, c = ac[j - 1], ac[j], ac[j + 1]; d = 0.5 * (a - c) / (a - 2 * b + c + 1e-12); l0 = (j + d) * dt
    return float(60 / l0)


def track(x, bpm=None, tightness=100.0):
    """-> (bpm, beats[s]) : dynamic-programming beat tracker on the onset envelope"""
    hop = 256; t, o = onset_env(x, hop=hop, nfft=2048)
    o = o / (o.std() + 1e-9); o = np.maximum(o - np.convolve(o, np.ones(32) / 32, 'same'), 0)
    bpm = bpm or tempo(x); P = 60 / bpm / (hop / SR)                 # period in frames
    n = len(o); score = o.copy(); back = -np.ones(n, int)
    lo, hi = int(round(P / 2)), int(round(P * 2))
    for i in range(hi, n):
        prev = np.arange(i - hi, i - lo)
        pen = -tightness * (np.log((i - prev) / P)) ** 2
        c = score[prev] + pen; k = int(np.argmax(c))
        score[i] = o[i] + c[k]; back[i] = prev[k]
    # best end in the last period
    i = n - hi + int(np.argmax(score[n - hi:])) if n > hi else int(np.argmax(score))
    beats = []
    while i >= 0:
        beats.append(i)
        i = back[i]
        if i < 0: break
    beats = np.array(beats[::-1]); bt = t[np.clip(beats, 0, len(t) - 1)]
    # drop leading / trailing beats that sit on silence
    strength = o[np.clip(beats, 0, n - 1)]
    keep = strength > np.percentile(strength, 10) * 0.2
    if keep.any():
        a, b = np.argmax(keep), len(keep) - np.argmax(keep[::-1]); bt = bt[a:b]
    if len(bt) > 8: bpm = 60 / float(np.median(np.diff(bt)))
    return float(bpm), bt


def refine(x, beats, win=0.035):
    t, fl = onset_env(x); out = []
    for b in beats:
        w = (t > b - win) & (t < b + win)
        out.append(float(t[w][np.argmax(fl[w])]) if w.any() else float(b))
    return np.array(out)


def full_grid(x, beats, total, confirm=0.35):
    t, fl = onset_env(x)
    if len(beats) < 10: return np.array(beats)
    fb = [fl[np.argmin(abs(t - b))] for b in beats]; thr = np.quantile(fb, confirm)
    P0 = np.median(np.diff(beats[:9])); P1 = np.median(np.diff(beats[-9:]))
    pre = []; b = beats[0] - P0
    while b > 0.05:
        w = (t > b - 0.03) & (t < b + 0.03)
        if w.any() and fl[w].max() >= thr: pre.append(float(t[w][np.argmax(fl[w])])); b = pre[-1] - P0
        else: break
    post = []; b = beats[-1] + P1
    while b < total - 0.05:
        w = (t > b - 0.03) & (t < b + 0.03)
        if w.any() and fl[w].max() >= thr: post.append(float(t[w][np.argmax(fl[w])])); b = post[-1] + P1
        else: break
    return np.array(sorted(pre) + list(beats) + post)


def fit_grid(beats, total, max_rms_ms=8.0):
    """a machine-steady bed (Eleven Music usually is): a straight line through the tracked beats, extended over the whole bed.
    Returns (grid, period, rms_ms) or (None, None, rms_ms) when the bed isn't steady enough."""
    if len(beats) < 8: return None, None, None
    k = np.arange(len(beats)); b_, a_ = np.polyfit(k, beats, 1)
    rms = float(np.sqrt(np.mean((beats - (a_ + b_ * k)) ** 2)) * 1000)
    if rms > max_rms_ms: return None, None, rms
    k0 = int(np.floor(-a_ / b_)); k1 = int(np.ceil((total - a_) / b_))
    g = a_ + b_ * np.arange(k0, k1 + 1); g = g[(g >= 0) & (g <= total)]
    return g, float(b_), rms


def subgrid(beats, div=4):
    g = []
    for a, b in zip(beats[:-1], beats[1:]): g += list(a + (b - a) * np.arange(div) / div)
    if len(beats): g.append(beats[-1])
    return np.array(g)


def quantise(t, grid, maxd=0.040):
    """nearest grid point if within maxd -> (t_new, moved_ms) else (t, None)"""
    if grid is None or len(grid) == 0: return t, None
    i = int(np.argmin(abs(grid - t))); d = grid[i] - t
    return (float(grid[i]), round(d * 1000, 1)) if abs(d) <= maxd and grid[0] - 0.3 < t < grid[-1] + 0.3 else (t, None)


# ------------------------------------------------------------------ harmony
def chroma_frames(x, hop=4096, nfft=8192, lo=80, hi=2500):
    f, t, Z = ss.stft(mono(x), SR, nperseg=nfft, noverlap=nfft - hop)
    P = np.abs(Z); sel = (f > lo) & (f < hi)          # magnitude (not power): the bass doesn't swamp the key
    pcs = (np.round(69 + 12 * np.log2(f[sel] / 440)).astype(int)) % 12
    C = np.zeros((12, P.shape[1]))
    for k in range(12): C[k] = P[sel][pcs == k].sum(0)
    return t, C / (C.sum(0, keepdims=True) + 1e-12)


def key_of(pc):
    best = []
    for r in range(12):
        for mode, prof in (('major', MAJ), ('minor', MIN)):
            best.append((float(np.corrcoef(pc, np.roll(prof, r))[0, 1]), r, mode))
    best.sort(reverse=True)
    c, r, mode = best[0]
    scale = [(r + s) % 12 for s in ((0, 2, 4, 5, 7, 9, 11) if mode == 'major' else (0, 2, 3, 5, 7, 8, 10))]
    pent = [(r + s) % 12 for s in ((0, 2, 4, 7, 9) if mode == 'major' else (0, 3, 5, 7, 10))]
    triad = [r, (r + (4 if mode == 'major' else 3)) % 12, (r + 7) % 12]
    return dict(key=f'{NAMES[r]} {mode}', root=r, mode=mode, confidence=round(c, 2), second=f'{NAMES[best[1][1]]} {best[1][2]}',
                scale=scale, pent=pent, triad=triad)


def local_chroma(mus, t, w=1.5, lo=80, hi=2000):
    a, b = max(0, int((t - w) * SR)), int((t + w) * SR); x = mono(mus[a:b])
    if len(x) < 4096 or np.abs(x).max() < 1e-6: return np.ones(12) / 12
    X = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2; f = np.fft.rfftfreq(len(x), 1 / SR); sel = (f > lo) & (f < hi)
    pc = np.zeros(12); np.add.at(pc, (np.round(69 + 12 * np.log2(f[sel] / 440)).astype(int)) % 12, X[sel]); return pc / (pc.sum() + 1e-12)


def triad(pc):
    ok = lambda r, q: SCALE is None or all(v % 12 in SCALE for v in (r, r + q, r + 7))
    cands = [(pc[r] + 0.8 * pc[(r + q) % 12] + 0.9 * pc[(r + 7) % 12], r, q) for r in range(12) for q in (3, 4) if ok(r, q)]
    if not cands: cands = [(pc[r] + 0.8 * pc[(r + q) % 12] + 0.9 * pc[(r + 7) % 12], r, q) for r in range(12) for q in (3, 4)]
    best = max(cands); return best[1], best[2]


def midi_hz(m): return 440 * 2 ** ((m - 69) / 12)


def hz(note):
    n = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}
    name, oc = note[:-1], int(note[-1]); return midi_hz(n[name] + 12 * (oc + 1))


def near_pc(pcs, f_target):
    m0 = 69 + 12 * np.log2(f_target / 440); cands = [m for m in range(int(m0) - 7, int(m0) + 8) if m % 12 in pcs]
    return midi_hz(min(cands, key=lambda m: abs(m - m0))) if cands else f_target


def chord_tones(pc):
    r, q = triad(pc); return [r, (r + q) % 12, (r + 7) % 12]


def snap_f(f, pc):
    m = 69 + 12 * np.log2(f / 440); best = min(range(-2, 3), key=lambda d: -pc[int(round(m + d)) % 12] + 0.02 * abs(d)); return f * 2 ** (best / 12)


# ------------------------------------------------------------------ stems
def hpss(x, nfft=4096, hop=1024, kernel=31, margin=1.0):
    """median-filter HPSS (Fitzgerald) with soft masks computed on the mid channel, applied to each channel -> (harm, perc)"""
    x = np.asarray(x, float); X2 = x if x.ndim == 2 else x[:, None]
    m = X2.mean(1)
    _, _, Zm = ss.stft(m, SR, nperseg=nfft, noverlap=nfft - hop)
    S = np.abs(Zm)
    H = median_filter(S, size=(1, kernel)); Pm = median_filter(S, size=(kernel, 1))
    Mh = H ** 2 / (H ** 2 + (margin * Pm) ** 2 + 1e-12); Mp = 1 - Mh
    outH = np.zeros_like(X2); outP = np.zeros_like(X2)
    for c in range(X2.shape[1]):
        _, _, Z = ss.stft(X2[:, c], SR, nperseg=nfft, noverlap=nfft - hop)
        _, h = ss.istft(Z * Mh, SR, nperseg=nfft, noverlap=nfft - hop); _, p = ss.istft(Z * Mp, SR, nperseg=nfft, noverlap=nfft - hop)
        outH[:, c] = np.pad(h, (0, max(0, len(x) - len(h))))[:len(x)]; outP[:, c] = np.pad(p, (0, max(0, len(x) - len(p))))[:len(x)]
    return (outH, outP) if x.ndim == 2 else (outH[:, 0], outP[:, 0])


def band_spec(x, a, b, nfft=1024, hop=240, bands=48):
    """log band-energy spectrogram (a mel-like proxy) of x[a:b] seconds -> (bands, frames)"""
    seg = mono(x[max(0, int(a * SR)):int(b * SR)])
    if len(seg) < nfft: seg = np.pad(seg, (0, nfft - len(seg)))
    f, t, Z = ss.stft(seg, SR, nperseg=nfft, noverlap=nfft - hop)
    P = np.abs(Z) ** 2; edges = np.geomspace(40, 16000, bands + 1); out = np.zeros((bands, P.shape[1]))
    for i in range(bands):
        sel = (f >= edges[i]) & (f < edges[i + 1])
        if sel.any(): out[i] = P[sel].sum(0)
    return 10 * np.log10(out + 1e-10)
