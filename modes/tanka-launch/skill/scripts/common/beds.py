"""Bed analysis shared by music/analyse, arrange, warp, extend, sfx/render .

analyse(x) -> {durS, bpm, beats, grid, steady, grid_rms_ms, downbeat_phase, groove_start_beat, key{...}, sections[...], loudness_curve}"""
import numpy as np
import audio as A
import beats as B

SR = A.SR


def band(x, lo, hi):
    m = B.mono(x)
    if lo and hi: return A.filt(m, 'band', [lo, hi], 4)
    if lo: return A.filt(m, 'high', lo, 4)
    return A.filt(m, 'low', hi, 4)


def beat_energy(y, beats, w=0.06):
    out = []
    for t in beats:
        i = int(t * SR); seg = y[max(0, i - 200):i + int(w * SR)]
        out.append(float(np.sqrt(np.mean(seg ** 2)) + 1e-9) if len(seg) else 1e-9)
    return np.array(out)


def analyse(x, sections=None, bpm_hint=None):
    total = len(x) / SR
    bpm0, bt = B.track(x, bpm_hint)
    bt = B.refine(x, bt)
    grid, P, rms = B.fit_grid(bt, total)
    steady = grid is not None
    if not steady:
        grid = B.full_grid(x, bt, total); P = float(np.median(np.diff(grid))) if len(grid) > 1 else 60 / bpm0
    bpm = 60 / P
    kick = beat_energy(band(x, None, 120), grid); clap = beat_energy(band(x, 800, 4000), grid)
    best, phase = -1e9, 0
    for ph in range(4):
        s = np.mean(kick[ph::4]) + 0.5 * (np.mean(clap[(ph + 1) % 4::4]) + np.mean(clap[(ph + 3) % 4::4])) - 0.5 * np.mean(clap[ph::4])
        if s > best: best, phase = s, ph
    # the groove: kick energy over 4 beats >= half of its median in the loudest half
    kd = 20 * np.log10(kick); ref = np.percentile(kd, 80) if len(kd) else 0
    gs = next((i for i in range(len(kd) - 3) if kd[i:i + 4].mean() > ref - 6), 0)
    _, C = B.chroma_frames(x); key = B.key_of(C.mean(1))
    secs = []
    ct, _ = B.chroma_frames(x)
    for s in (sections or auto_sections(grid, total)):
        a, b = s['start'], s['end']; seg = x[int(a * SR):int(b * SR)]
        lu = A.lufs(seg) if len(seg) > SR * 0.5 else -120.0
        t, fl = B.onset_env(seg) if len(seg) > 2048 else (np.array([0]), np.array([0]))
        on = np.sum(fl > np.percentile(fl, 90)) / max(0.1, b - a) if len(fl) > 10 else 0
        spec = np.abs(np.fft.rfft(B.mono(seg))) ** 2 if len(seg) else np.zeros(2); f = np.fft.rfftfreq(len(seg), 1 / SR) if len(seg) else np.zeros(2)
        w = (ct >= a) & (ct < b)
        secs.append(dict(name=s.get('name', f'{a:.0f}s'), start=round(a, 3), end=round(b, 3), lufs=round(lu, 1), onset_density=round(float(on), 2),
                         centroid_hz=int((f * spec).sum() / (spec.sum() + 1e-12)), key=B.key_of(C[:, w].mean(1))['key'] if w.sum() > 2 else None))
    curve = []
    for t in np.arange(0, total, 0.5):
        seg = x[int(max(0, t - 1.5) * SR):int(min(total, t + 1.5) * SR)]
        curve.append(round(float(10 * np.log10(np.mean(seg ** 2) + 1e-12)), 1))
    return dict(durS=round(total, 3), bpm=round(bpm, 2), bpm_tracked=round(bpm0, 2), steady=steady, grid_rms_ms=None if rms is None else round(rms, 2),
                beat_s=round(P, 5), n_beats=len(grid), beats=[round(float(v), 4) for v in grid], downbeat_phase=int(phase),
                groove_start_beat=int(gs), groove_start_s=round(float(grid[gs]), 3) if len(grid) else 0.0, key=key, sections=secs,
                loudness_curve=dict(hop_s=0.5, win_s=3.0, db=curve), lufs=round(A.lufs(x), 2))


def auto_sections(grid, total, bars=8):
    if len(grid) < 8: return [dict(name='all', start=0.0, end=total)]
    out = []; step = bars * 4
    for i in range(0, len(grid), step):
        a = 0.0 if i == 0 else float(grid[i]); b = float(grid[i + step]) if i + step < len(grid) else total
        out.append(dict(name=f'bars {i // 4 + 1}-{(i + step) // 4}', start=round(a, 3), end=round(b, 3)))
    return out


def load_analysis(path_audio, card=None):
    """a cached analysis next to the audio (<file>.ana.json) or in its library card; computed when missing"""
    import os, json
    for p in ([card] if card else []) + [path_audio + '.ana.json', os.path.splitext(path_audio)[0] + '.ana.json']:
        if p and os.path.exists(p):
            j = json.load(open(p)); j = j.get('analysis', j)
            if j.get('beats'): return j
    x = A.load(path_audio); a = analyse(x)
    try:
        import ws as W
        W.jwrite(os.path.splitext(path_audio)[0] + '.ana.json', a)      # the one in-place JSON writer (the canvas watches these folders)
    except OSError: pass
    return a
