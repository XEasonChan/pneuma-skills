#!/usr/bin/env python3
"""Stage 3 · per-scene BPM arrangement from ONE bed: slow suspense -> build -> climax -> slow release, each section
at its own tempo, landing exactly on the scene cuts.

  scripts/py music/arrange.py --option A [--ws DIR]                      (the option's bed + bpmMap; writes bed.arranged back)
  scripts/py music/arrange.py --bed <file|library id> --bpm-map map.json --out stages/music/beds/X-arr.flac

bpmMap = [{from, to, bpm, feel: straight|half|double, role: suspense|build|climax|release, join?: stop|fill|drop|none, hats_plus?: -1..4}] (film s;
from/to = the option's scene windows, common/clock.py). bpm = the GRID tempo of the section (the beat the picture cuts on); feel =
the drums on that grid: half = kick 1 + "and of 3", clap on 3, the bed's own drums out (reads at bpm / 2); double = 16th shaker +
hats (reads at 2 x bpm). One-grid density = bpm fixed at the bed's tempo, only feel / joins (and hats) vary.
How:
 1. beat grid of the bed (machine-steady beds: the straight-line fit), downbeat phase, groove start; HPSS split (harm / perc).
 2. per section: the grid tempo = bpm when it is within +-15 % of the bed, else re-expressed as 2 x bpm with a half-time feel or
    bpm / 2 with a double-time feel (a bigger contrast by feel, not by more stretch); clamped with a warning only if neither fits.
    Then a WHOLE number of beats that lands on the cut: hold (a beat count within 2.5 % of the tempo), else the tempo for the body
    + a linear ramp across the last bar (or the whole section) into the next section, else (a short window) the nearest whole-beat
    tempo with the difference carried by feel / density: half-time (>= 8 % slower) or a thinner kit (slower), +1..+4 hats per
    bar (faster). Distinct
    targets never silently collapse to the bed's tempo; every such case is reported (warnings, sections[].tempo_mode).
 3. source beats re-sequenced bar-aligned from the bed's own material (suspense -> the intro material when it has one; the rest ->
    the groove, looped by 16-beat phrases), beat-synchronous splices with 40 ms equal-power cross-fades just before the transients.
 4. the harmonic stem: ONE Rubber Band R3 pass with a key-frame time map (every beat pinned) -> the tempo map, ramps included.
    the percussive stem: re-sliced per 16th onto the new grid (no stretch, no transient smear).
 5. re-drum: a kit resampled from the bed itself (kick / clap / hat = median of transient-aligned hits) + a procedural shaker;
    patterns per feel (half-time: kick 1 + "and of 3", clap on 3); the bed's own drums are faded per section.
 6. joins: 'stop' (a 1-beat stop with a reverb tail of the last beat, before turns / slow-downs), 'drop' (a 1-bar clap lift
    8ths -> 16ths + a high-pass rise, then a low hit on the downbeat: into the climax), 'fill' (2-beat clap fill), 'none'.
 7. opening: filtered (low-pass 900 -> 2400 Hz) + a light echo layer (ethereal, a little echo, not silent); ending: a button (the
    groove stops on the last downbeat >= 1.2 s before the end, then one chord of the bed + a soft stab + sub, ringing out).
Writes the arranged bed (flac), <out>.json (sections, tempo ratios, splices, joins, per-beat BPM for the BPM graph) and
<out>.ana.json (the NEW beat grid: sfx/render.py quantises to it). No paid call."""
import argparse, json, os, subprocess, sys, tempfile
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import ws as W, audio as A, beats as B, beds as BD, kit as KT, clock as CK

SR = A.SR; LEAD = 0.25; MAXR = 0.15
PAT = {   # 16 steps per bar; x = hit, o = soft (-6 dB)
    'suspense': dict(kick='x...............'),
    'build': dict(kick='x.......x.......', clap='....x.......x...', hat='..o...o...o...o.'),
    'climax': dict(shaker='ooxoooxoooxoooxo'),
    'release': dict(kick='x.........o.....', clap='........x.......', hat='..o...o...o...o.'),
    'half': dict(kick='x.........o.....', clap='........x.......', hat='o.o.o.o.o.o.o.o.'),
    'double': dict(shaker='ooxoooxoooxoooxo', hat='oooooooooooooooo', kick='......o........o'),
}
HAT_PLUS = '.o...o...o...o..'   # extra soft 16th hats for a density lift (+1..+4 per bar, in this order: steps 1, 5, 9, 13)


def feel_pattern(s):
    """the kit pattern of a section: its feel on the grid (half: kick 1 + 'and of 3', clap on 3, 8th hats; double: 16th shaker + hats),
    else its role's pattern; a suspense in half-time drops the hats; + hats_plus soft 16th hats per bar (the one-grid density lift)"""
    feel = s.get('feel', 'straight')
    pat = dict(PAT['half'] if feel == 'half' else (PAT['double'] if feel == 'double' else PAT.get(s['role'], {})))
    if feel == 'half' and s['role'] == 'suspense': pat.pop('hat', None)
    n = int(s.get('hats_plus') or 0)
    if n < 0: pat.pop('hat', None); pat.pop('shaker', None)
    if n > 0:
        steps = [i for i, ch in enumerate(HAT_PLUS) if ch != '.'][:n]; base = list(pat.get('hat', '.' * 16))
        for i in steps:
            if base[i] == '.': base[i] = 'o'
        pat['hat'] = ''.join(base)
    return pat


PERC_GAIN = {'suspense': 0.0, 'build': 0.6, 'climax': 1.0, 'release': 0.3}
LP = {'suspense': (900, 2400), 'build': (5000, 11000), 'release': (7000, 3500)}


def stems(ws, bed, x):
    key = os.path.splitext(os.path.basename(bed))[0]; d = W.P(ws, 'stages', 'music', 'work'); os.makedirs(d, exist_ok=True)
    ph, pp = os.path.join(d, key + '-harm.flac'), os.path.join(d, key + '-perc.flac')
    if os.path.exists(ph) and os.path.exists(pp):
        H, P = A.fit(A.load(ph), len(x)), A.fit(A.load(pp), len(x))
    else:
        W.log('HPSS split (once per bed; cached in stages/music/work/)'); H, P = B.hpss(x); A.write(ph, H, bits=16); A.write(pp, P, bits=16)
    return H, P


def _ramp(L, n, r, bt):
    """n beats in L s: the first n - r at bt, the last r beats a linear ramp (in beat period) -> per-beat BPMs, or None"""
    p = 60 / bt; body = (n - r) * p; Lr = L - body
    if Lr <= 0 or r < 1: return None
    pe = p + 2 * (Lr - r * p) / (r + 1)
    if pe <= 0: return None
    return [bt] * (n - r) + [60 / (p + (i + 1) * (pe - p) / r) for i in range(r)]


def tempo_plan(L, bt, b_next, bed_bpm, maxr=MAXR):
    """how a section of L s holds its tempo bt with a WHOLE number of beats (so it lands on its cut), in order:
      hold  - some whole-beat count is within 2.5 % of bt: every beat at n*60/L;
      ramp  - bt for the body, then a linear tempo ramp across the last bar (<= 4 beats, <= half the section; else across the whole
              section) that absorbs the difference, ending within +-12 % of bt and +-15 % of the bed, and no further from the next
              section's tempo than holding would be (a ramp heads into the next section);
      feel  - neither fits (a short window): hold the nearest whole-beat average and carry the tempo difference by feel / density
              instead (>= 8 % slower -> half-time feel; slower -> a thinner kit; faster -> +1..+4 hats per bar), never by collapsing
              to the bed's tempo silently.
    -> dict(n, bpms[per beat], mode, avg, ramp_to, dev)"""
    lo, hi = bed_bpm * (1 - maxr) - 1e-6, bed_bpm * (1 + maxr) + 1e-6; x = L * bt / 60
    ns = sorted({n for n in (int(np.floor(x)), int(np.ceil(x)), int(np.floor(x)) - 1, int(np.ceil(x)) + 1) if n >= 2})
    holds = sorted(((abs(n * 60 / L / bt - 1), n) for n in ns if lo <= n * 60 / L <= hi), key=lambda t: (t[0], t[1] % 4 != 0))
    if holds and holds[0][0] <= 0.025:
        n = holds[0][1]; a = n * 60 / L
        return dict(n=n, bpms=[a] * n, mode='hold', avg=a, ramp_to=None, dev=round(a / bt - 1, 4))
    best = None
    for n in ns:
        a = n * 60 / L; jump_hold = abs(a - b_next) / b_next
        for r in ([min(4, n // 2), n] if n > 2 else [n]):
            bp = _ramp(L, n, r, bt)
            if not bp or min(bp) < lo or max(bp) > hi or abs(bp[-1] / bt - 1) > 0.12: continue
            jump = abs(bp[-1] - b_next) / b_next
            if jump > max(jump_hold, abs(bt - b_next) / b_next) + 0.01: continue
            cost = abs(bp[-1] / bt - 1) + 0.5 * jump + (0.02 if r == n else 0) + (0.01 if n % 4 else 0)
            if best is None or cost < best[0]: best = (cost, n, bp, 'ramp' if r < n else 'ramp-section')
    if best:
        _, n, bp, mode = best
        return dict(n=n, bpms=bp, mode=mode, avg=n * 60 / L, ramp_to=round(bp[-1], 2), dev=0.0)
    n = (holds[0][1] if holds else max(2, int(round(x)))); a = n * 60 / L
    return dict(n=n, bpms=[a] * n, mode='feel', avg=a, ramp_to=None, dev=round(a / bt - 1, 4))


def plan_sections(bm, bed_bpm):
    """per section: the grid tempo + feel (common/clock.py grid_tempo: out-of-range targets become half / double-time feel), then the
    tempo plan (hold / ramp / feel) that lands it on its cut with whole beats. Distinct targets stay distinct on short windows."""
    out = []; warn = []; grid = []
    for s in bm:
        g, feel, note = CK.grid_tempo(s['bpm'], s.get('feel', 'straight'), bed_bpm)
        if note: warn.append(f"{s.get('scene', '?')}: {note}")
        grid.append((g, feel, bool(note and 'feel' in note)))
    for i, s in enumerate(bm):
        L = s['to'] - s['from']; bt, feel, auto = grid[i]; bn = grid[i + 1][0] if i + 1 < len(bm) else bt
        pl = tempo_plan(L, bt, bn, bed_bpm); hats = int(s.get('hats_plus') or 0)          # a map may ask for a density lift itself
        if pl['mode'] == 'feel':
            if hats: how = f"the map's {hats:+d} hats per bar"
            elif pl['dev'] > 0.08 and feel == 'straight': feel, auto, how = 'half', True, 'a half-time feel'   # the grid runs >= 8 % fast: half-time reads slower
            elif pl['dev'] > 0.025: hats, how = -1, 'a thinner kit (no hats)'                                   # a little fast: no hats, the bed's drums at 60 %
            elif pl['dev'] < -0.025:                                                                           # the grid runs slow: denser hats (+1..+4 per bar)
                hats = int(np.clip(round(-pl['dev'] / 0.025), 1, 4)); how = f'+{hats} hats per bar'
            else: how = f'the {feel} feel'
            warn.append(f"{s.get('scene', '?')}: {L:.2f} s can't hold {bt:.1f} BPM on whole beats ({pl['n']} beats = {pl['avg']:.1f} BPM); {how} carries the difference")
        out.append(dict(s, feel=feel, feel_auto=auto, n=pl['n'], beat_bpm=pl['bpms'], bpm_grid=round(bt, 3), bpm_play=round(bt if pl['mode'].startswith('ramp') else pl['avg'], 3),
                        tempo_mode=pl['mode'], ramp_to=pl['ramp_to'], hats_plus=hats, L=L, role=s.get('role', 'build')))
    return out, warn


def sources(an, secs):
    g = np.array(an['beats']); ph = an['downbeat_phase']; gs = an['groove_start_beat']; nb = len(g) - 1
    bar0 = lambda k: k + ((ph - k) % 4)
    intro = list(range(bar0(0), max(bar0(0), gs - (gs - ph) % 4)))
    g0 = bar0(gs); g1 = nb - 8 - ((nb - 8 - ph) % 4)
    groove = list(range(g0, max(g0 + 16, g1)))
    if len(groove) < 16: groove = list(range(bar0(0), nb - 1))
    pos = dict(intro=0, groove=0); beats = []
    for si, s in enumerate(secs):
        mat = 'intro' if (s['role'] == 'suspense' and len(intro) >= 8) else 'groove'
        L = intro if mat == 'intro' else groove
        if s.get('join') in ('drop', 'stop') and mat == 'groove': pos['groove'] = (pos['groove'] + 15) // 16 * 16 % max(16, len(groove) // 16 * 16 or 16)
        for j in range(s['n']):
            k = L[pos[mat] % len(L)]; pos[mat] += 1
            beats.append(dict(k=k, si=si, j=j, bpm=s['beat_bpm'][j], mat=mat))
        s['mat'] = mat
    return beats


def sequence(stem, g, beats, pre=0.045, xf=0.040, tail_s=2.5):
    gk = lambda k: g[min(k, len(g) - 1)] + LEAD
    D = [gk(b['k'] + 1) - gk(b['k']) for b in beats]; pos = LEAD + np.concatenate([[0], np.cumsum(D)])
    runs = []; s = 0
    for i in range(1, len(beats) + 1):
        if i == len(beats) or beats[i]['k'] != beats[i - 1]['k'] + 1: runs.append((s, i)); s = i
    n = int((pos[-1] + tail_s + 0.5) * SR); out = np.zeros((n, stem.shape[1])); nx = int(xf * SR)
    for ri, (a, b) in enumerate(runs):
        last = ri == len(runs) - 1
        src0 = gk(beats[a]['k']) - pre; src1 = gk(beats[b - 1]['k'] + 1) - pre + (tail_s if last else xf)
        i0, i1 = int(round(src0 * SR)), int(round(src1 * SR)); seg = stem[max(0, i0):i1].copy()
        if i0 < 0: seg = np.concatenate([np.zeros((-i0, stem.shape[1])), seg])
        w = np.ones(len(seg))
        if ri > 0: w[:nx] = np.sin(np.linspace(0, np.pi / 2, nx))
        if not last: w[-nx:] = np.cos(np.linspace(0, np.pi / 2, nx))
        seg = seg * w[:, None]; o0 = int(round((pos[a] - pre) * SR)); m = max(0, min(len(seg), n - o0)); out[o0:o0 + m] += seg[:m]
    return out, pos, runs


def stretch(buf, pos_src, T, tail_ratio):
    d = tempfile.mkdtemp(prefix='tl-rb-'); fi, fo, fm = os.path.join(d, 'in.wav'), os.path.join(d, 'out.wav'), os.path.join(d, 'map.txt')
    A.write(fi, buf)
    with open(fm, 'w') as f:
        for s_, t_ in zip(pos_src, LEAD + T): f.write(f'{int(round(s_ * SR))} {int(round(t_ * SR))}\n')
    total = LEAD + T[-1] + (len(buf) / SR - pos_src[-1]) * tail_ratio
    r = subprocess.run(['rubberband', '-3', '-q', '-M', fm, '-D', f'{total:.6f}', fi, fo], capture_output=True, text=True)
    if r.returncode: raise SystemExit('rubberband failed: ' + r.stderr[-400:])
    y = A.load(fo)[int(LEAD * SR):]
    for p in (fi, fo, fm): os.remove(p)
    os.rmdir(d); return y


def slice_perc(Ps, g, beats, T, N, pre=0.003, fade=0.005):
    gk = lambda k: g[min(k, len(g) - 1)] + LEAD
    out = np.zeros((N, 2)); nf = int(fade * SR)
    for j, b in enumerate(beats):
        P0 = gk(b['k'] + 1) - gk(b['k']); d_t = (T[j + 1] - T[j]) / 4
        for i in range(4):
            s0 = gk(b['k']) + i * P0 / 4 - pre; L = min(P0 / 4, d_t); a = int(round(s0 * SR)); n = int(round(L * SR)); seg = Ps[a:a + n].copy()
            if len(seg) < n or n < 96: continue
            seg[:48] *= np.linspace(0, 1, 48)[:, None]; seg[-nf:] *= np.linspace(1, 0, nf)[:, None] ** 2
            o = int(round((T[j] + i * d_t - pre) * SR))
            if 0 <= o and o + n <= N: out[o:o + n] += seg
    return out


def kit_from(P, g, an, x):
    """kick / clap / hat resampled from the bed's percussive stem (median of transient-aligned hits) + a procedural shaker"""
    ph = an['downbeat_phase']; gs = an['groove_start_beat']; nb = len(g) - 2
    ks = [g[k] for k in range(gs, nb) if (k - ph) % 4 in (0, 2)]; cs = [g[k] for k in range(gs, nb) if (k - ph) % 4 in (1, 3)]
    hs = [g[k] + (g[k + 1] - g[k]) * 0.5 for k in range(gs, nb)]
    def align(y, ts, pre=0.012, post=0.3, search=0.02):
        segs = []
        for t in ts[:64]:
            a = int((t - search) * SR); b = int((t + search) * SR)
            if a < 0 or b >= len(y): continue
            w = np.abs(np.diff(y[a:b].mean(1))); on = a + int(np.argmax(w)); s = y[on - int(pre * SR): on + int(post * SR)]
            if len(s) == int(pre * SR) + int(post * SR): segs.append(s / (np.sqrt(np.mean(s ** 2)) + 1e-9))
        return np.median(np.array(segs), 0) if len(segs) >= 4 else None
    fin = lambda s, fade=0.03: None if s is None else (lambda q: q / (np.abs(q).max() + 1e-12))(s * np.r_[np.ones(len(s) - int(fade * SR)), np.linspace(1, 0, int(fade * SR)) ** 2][:, None])
    kick = align(A.filt(P, 'low', 220), ks, post=0.16); clap = align(A.filt(P, 'band', [500, 9000]), cs, post=0.22); hat = align(A.filt(P, 'band', [5000, 16000]), hs, post=0.07, search=0.012)
    g_ = np.random.default_rng(7)
    if kick is None: kick = KT.sub_thump(55, 0.16, 0.9)
    if clap is None:
        nc = int(0.22 * SR); tc = np.arange(nc) / SR
        burst = sum(np.exp(-np.clip(tc - d, 0, None) / 0.004) * (tc >= d) for d in (0.0, 0.009, 0.019))
        clap = A.filt(g_.standard_normal((nc, 2)), 'band', [900, 3600]) * burst[:, None]
    if hat is None: hat = A.filt(g_.standard_normal((int(0.05 * SR), 2)), 'band', [6000, 12000]) * np.exp(-np.arange(int(0.05 * SR)) / SR / 0.01)[:, None]
    ns = int(0.07 * SR); tsn = np.arange(ns) / SR
    shaker = A.filt(g_.standard_normal((ns, 2)), 'band', [3200, 8500]) * (np.minimum(1, tsn / 0.008) * np.exp(-tsn / 0.02))[:, None]
    V = dict(kick=fin(kick), clap=fin(A.filt(clap, 'low', 7000)), hat=fin(A.filt(hat, 'low', 10000), 0.02), shaker=fin(shaker, 0.02))
    def pk(y, ts, lo, hi):
        z = A.filt(y, 'band', [lo, hi]) if lo else A.filt(y, 'low', hi)
        v = [A.todb(np.sqrt(A.env100(z[int(t * SR):int((t + 0.05) * SR)])).max()) for t in ts[:32] if int((t + 0.05) * SR) < len(z)]
        return float(np.median(v)) if v else -30.0
    cal = dict(kick=pk(P, ks, None, 200), clap=pk(P, cs, 1000, 5000) - 1.5, hat=pk(P, hs, 6000, 16000))
    cal['shaker'] = cal['hat'] - 4.0
    return V, cal


def morph_filter(x, cut, kind='low', bank=(300, 600, 1200, 2400, 4800, 9600, 11000)):
    """zero-phase filter-bank morph where the cutoff moves """
    bank = np.array(bank, float); lb = np.log(bank); sel = cut < bank[-1] - 1 if kind == 'low' else cut > bank[0] + 1
    if not sel.any(): return x
    idx_all = np.where(sel)[0]; i0, i1 = max(0, idx_all[0] - int(0.3 * SR)), min(len(x), idx_all[-1] + int(0.3 * SR))
    seg = x[i0:i1]; vers = [seg if (kind == 'low' and f >= 11000) else A.filt(seg, kind, f) for f in bank]
    c = np.log(np.clip(cut[i0:i1], bank[0], bank[-1])); k = np.clip(np.searchsorted(lb, c) - 1, 0, len(bank) - 2); fr = (c - lb[k]) / (lb[k + 1] - lb[k])
    out = np.zeros_like(seg)
    for q in range(len(bank) - 1):
        m = k == q; out[m] = vers[q][m] * (1 - fr[m])[:, None] + vers[q + 1][m] * fr[m][:, None]
    y = x.copy(); y[i0:i1] = out; return y


def arrange(ws, bed, an, bm, out):
    x = A.load(bed); g = np.array(an['beats']); P0 = an['beat_s']; bed_bpm = 60 / P0
    secs, warns = plan_sections(bm, bed_bpm)
    for i, s in enumerate(secs):                                     # default joins
        if 'join' in s or i == 0: s.setdefault('join', 'none'); continue
        prev = secs[i - 1]; dr = s['bpm'] / prev['bpm'] - 1
        s['join'] = 'drop' if (s['role'] == 'climax' and prev['role'] != 'climax') else ('stop' if (s['role'] in ('release', 'suspense') or dr < -0.08) else ('fill' if abs(dr) > 0.04 else 'none'))
    beats = sources(an, secs)
    T = secs[0]['from'] + np.concatenate([[0], np.cumsum([60 / b['bpm'] for b in beats])]); total = secs[-1]['to']
    H, Pst = stems(ws, bed, x)
    pad = np.zeros((int(LEAD * SR), 2)); Hs, Ps = np.concatenate([pad, H]), np.concatenate([pad, Pst])
    bufH, pos, runs = sequence(Hs, g, beats)
    last = beats[-1]; tail_ratio = (60 / last['bpm']) / max(1e-3, (g[min(last['k'] + 1, len(g) - 1)] - g[last['k']]))
    Ho = A.fit(stretch(bufH, pos, T - T[0], tail_ratio), int((total + 1.5) * SR)); Ho = np.concatenate([np.zeros((int(T[0] * SR), 2)), Ho])[:int((total + 1.5) * SR)]
    N = len(Ho); Po = slice_perc(Ps, g, beats, T, N)
    V, CAL = kit_from(Pst, g, an, x); kitb = np.zeros((N, 2))
    s0 = {}; [s0.setdefault(b['si'], i) for i, b in enumerate(beats)]
    def tb(si, q):
        i = s0[si] + int(np.floor(q)); f = q - np.floor(q)
        if i >= len(T) - 1: return T[-1]
        return T[i] + f * (T[i + 1] - T[i])
    def hit(inst, t, vel):
        v = V[inst]; gdb = CAL[inst] - A.peak100(v) + 20 * np.log10(vel); A.place(kitb, v * A.db(gdb), t - 0.001)
    gP = np.zeros(N); lpv = np.full(N, 11000.0); hpv = np.full(N, 20.0); stops = []; lifts = []; lowhits = []; tt = np.arange(N) / SR
    for si, s in enumerate(secs):
        a_, b_ = int(tb(si, 0) * SR), int(tb(si, s['n']) * SR)
        pg = 0.0 if s['feel'] == 'half' else PERC_GAIN.get(s['role'], 0.6) * (0.6 if s.get('hats_plus', 0) < 0 else 1.0)
        gP[a_:b_] = pg
        if s['role'] in LP:
            c0, c1 = LP[s['role']]; lpv[a_:b_] = np.exp(np.linspace(np.log(c0), np.log(c1), b_ - a_))
        pat = feel_pattern(s)
        nxt = secs[si + 1] if si + 1 < len(secs) else None
        lift = (s['n'] - 4, s['n']) if (nxt and nxt.get('join') == 'drop' and s['n'] >= 8) else None
        stop = (s['n'] - 1, s['n']) if (nxt and nxt.get('join') == 'stop') else None
        fill = (s['n'] - 2, s['n']) if (nxt and nxt.get('join') == 'fill') else None
        for bar in range((s['n'] + 3) // 4):
            for inst, p in pat.items():
                for k, ch in enumerate(p):
                    if ch == '.': continue
                    q = bar * 4 + k / 4
                    if q >= s['n'] or (lift and lift[0] <= q) or (stop and stop[0] <= q) or (fill and fill[0] <= q): continue
                    hit(inst, tb(si, q), (1.0 if ch == 'x' else 0.5) * (0.6 if s['role'] == 'suspense' else 1.0))
        if lift:
            a, b = lift; q = a
            while q < b - 1e-6:
                hit('clap', tb(si, q), 0.22 + 0.78 * ((q - a) / (b - a)) ** 1.5); q += 0.5 if q < (a + b) / 2 else 0.25
            ia, ib = int(tb(si, a) * SR), int(tb(si, b) * SR); gP[ia:ib] = 0; hpv[ia:ib] = np.exp(np.linspace(np.log(20), np.log(600), ib - ia))
            lifts.append((round(tb(si, a), 3), round(tb(si, b), 3)))
        if fill:
            for q in np.arange(fill[0], fill[1], 0.25): hit('clap', tb(si, q), 0.35 + 0.5 * (q - fill[0]) / 2)
        if stop: stops.append((tb(si, stop[0]), tb(si, stop[1])))
        if s.get('join') == 'drop' and si > 0: lowhits.append(tb(si, 0))
    sm = lambda v, w: np.convolve(np.pad(v, (int(w * SR), int(w * SR)), mode='edge'), np.ones(int(w * SR)) / int(w * SR), 'same')[int(w * SR):-int(w * SR)]
    gP = sm(gP, 0.03); lpv = np.exp(sm(np.log(lpv), 0.08)); hpv = np.exp(sm(np.log(hpv), 0.08))
    music = Ho + Po * gP[:, None] + kitb
    for t in lowhits:
        pc = B.local_chroma(Ho, t + 0.3, 1.0); r0 = B.triad(pc)[0]; lh = KT.sub_thump(B.near_pc([r0], 49), 1.2, 0.5)
        A.place(music, lh * A.db(CAL['kick'] + 2 - A.peak100(lh)), t - 0.005)
    # stops: the music out for the beat, a hall tail of the beat before it
    for a, b in stops:
        ia, ib = int((a - 0.015) * SR), int((b - 0.008) * SR); pb = music[max(0, ia - int(0.6 * SR)):ia].copy(); pb *= np.linspace(0, 1, len(pb))[:, None] ** 2
        tail = A.reverb(np.pad(pb, ((0, int(3.0 * SR)), (0, 0))), 'hall', 1.0)[len(pb):]; L_ = min(len(tail), ib - ia)
        tail = tail[:L_] * (np.exp(-np.arange(L_) / SR / 1.2) * np.linspace(1, 0, L_) ** 0.5)[:, None]
        w = int(0.025 * SR); gS = np.ones(N); gS[ia:ia + w] = np.linspace(1, 0, w); gS[ia + w:ib] = 0; wi = int(0.008 * SR); gS[ib:ib + wi] = np.linspace(0, 1, wi)
        music = music * gS[:, None]; music[ia:ia + L_] += tail
    # the button ending
    grid_t = T[:-1]; lastsec = len(secs) - 1
    dbs = [tb(lastsec, q) for q in range(0, secs[-1]['n'], 4)]
    cand = [t for t in dbs if t <= total - 1.2]; tbut = cand[-1] if cand else total - 1.2
    ib = int(tbut * SR); fo = int(0.03 * SR); music[ib:ib + fo] *= np.linspace(1, 0, fo)[:, None]; music[ib + fo:] = 0
    gd = [k for k in range(an['groove_start_beat'], len(g) - 1) if (k - an['downbeat_phase']) % 4 == 0][:1] or [0]
    a0 = int((g[gd[0]] + LEAD - 0.01) * SR); ch = (Hs[a0:a0 + int(P0 * 1.6 * SR)] + Ps[a0:a0 + int(P0 * 1.6 * SR)]).copy()
    ch *= np.minimum(1, (len(ch) - np.arange(len(ch))) / (0.5 * SR))[:, None] ** 2
    kk = an['key']; r0 = kk['root']; third = 4 if kk['mode'] == 'major' else 3
    stab = KT.synth_stab([B.midi_hz(43 + r0 % 12), B.midi_hz(50 + r0 % 12), B.midi_hz(55 + r0 % 12), B.midi_hz(59 + (r0 + third) % 12)], 2.2, 1800, 600)
    ref = A.peak100(music[max(0, ib - int(4 * P0 * SR)):ib]); btn = A.hall(A.mx((ch, 0, 1.0), (stab * A.db(A.peak100(ch) - 6 - A.peak100(stab)), 0, 1.0)), 0.45, 'hall', tail=2.5)
    A.place(music, btn * A.db(ref + 1.0 - A.peak100(btn)), tbut - 0.01)
    A.place(music, V['kick'] * A.db(CAL['kick'] - A.peak100(V['kick'])), tbut - 0.001)          # the button's kick
    music = morph_filter(music, lpv, 'low'); music = morph_filter(music, hpv, 'high', (20, 80, 160, 320, 640))
    # the opening echo layer (the first section only, when it is the suspense)
    if secs[0]['role'] == 'suspense':
        e_end = tb(0, secs[0]['n']); seg = A.filt(A.filt(music[:int(e_end * SR)], 'high', 220), 'low', 5200)
        w = A.echo(seg, 60 / secs[0]['bpm_play'] * 1.5, 0.4, 4, 3000); w = A.hall(w, 0.55, 'temple', tail=2.0); w[:len(seg)] -= seg
        tw = np.arange(len(w)) / SR; w *= (np.clip((e_end + 1.0 - tw) / 2.0, 0, 1) ** 1.5)[:, None]; A.place(music, w * A.db(-3), 0.0)
    music = A.fit(music, int(round(total * SR))); fo = int(0.25 * SR); music[-fo:] *= np.linspace(1, 0, fo)[:, None]
    music = A.gain_to(music, -18.0); music = A.limit_to_ceiling(music, -1.0)
    A.write(out, music)
    sec_out = []
    for si, s in enumerate(secs):
        ks = [b['k'] for b in beats if b['si'] == si]
        ratios = [(g[min(b['k'] + 1, len(g) - 1)] - g[b['k']]) / (60 / b['bpm']) for b in beats if b['si'] == si]
        bb = s['beat_bpm']
        sec_out.append(dict(scene=s.get('scene'), role=s['role'], feel=s['feel'], feel_auto=s['feel_auto'], t0=round(tb(si, 0), 6), t1=round(tb(si, s['n']), 6), beats=s['n'],
                            bpm_target=s['bpm'], bpm_grid=s['bpm_grid'], bpm_play=s['bpm_play'], perceived_bpm=round(CK.perceived(s['bpm_play'], s['feel']), 2),
                            tempo_mode=s['tempo_mode'], bpm_range=[round(min(bb), 2), round(max(bb), 2)], ramp_to=s['ramp_to'], hats_plus=s['hats_plus'],
                            tempo_ratio=[round(min(ratios), 3), round(max(ratios), 3)], material=s['mat'], src_beats=[ks[0], ks[-1]], join_in=s.get('join')))
    rep = dict(bed=W.rel(ws, bed), bed_bpm=round(bed_bpm, 2), out=W.rel(ws, out), total=round(total, 3), sections=sec_out, warnings=warns,
               splices=len(runs) - 1, splice_t=[round(float(T[a]), 3) for a, b in runs[1:]], stops=[(round(a, 3), round(b, 3)) for a, b in stops], lifts=lifts,
               lowhits=[round(t, 3) for t in lowhits], button_s=round(tbut, 3), beat_times=[round(float(v), 4) for v in T],
               beat_bpm=[round(b['bpm'], 2) for b in beats], kit_cal=CAL, lufs=round(A.lufs(music), 2), joins=[round(s['t0'], 3) for s in sec_out[1:]])
    W.jwrite(out + '.json', rep)
    ana = dict(an, beats=[round(float(v), 4) for v in T[:-1]], beat_s=round(float(np.median(np.diff(T))), 5), bpm=round(60 / float(np.median(np.diff(T))), 2),
               steady=False, durS=round(total, 3), arranged_from=W.rel(ws, bed), groove_start_s=round(float(T[0]), 3), groove_start_beat=0)
    W.jwrite(os.path.splitext(out)[0] + '.ana.json', ana)
    return rep


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ws'); ap.add_argument('--option'); ap.add_argument('--bed'); ap.add_argument('--bpm-map'); ap.add_argument('--out')
    a = ap.parse_args(); ws = W.ws_root(a.ws); W.disk_guard(ws, 'the arrangement (HPSS cache ~20 MB per bed)')
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import library as LIB
    if a.option:
        of = W.P(ws, 'stages', 'music', 'options', f'{a.option}.json'); o = W.jread(of); b = o['bed']
        bed = LIB.card(b['id'], ws)['_file'] if b.get('source') == 'library' and b.get('id') else os.path.join(ws, b.get('full') or b['file'])
        bm = b['bpmMap']; out = a.out or W.P(ws, 'stages', 'music', 'beds', f'{a.option}-arranged.flac')
    else:
        if not (a.bed and a.bpm_map and a.out): raise SystemExit('need --option, or --bed --bpm-map --out')
        bed = LIB.card(a.bed if (os.path.isabs(a.bed) or not os.path.exists(os.path.join(ws, a.bed))) else os.path.join(ws, a.bed), ws)['_file']; bm = W.jread(a.bpm_map if os.path.isabs(a.bpm_map) else os.path.join(ws, a.bpm_map)); out = a.out if os.path.isabs(a.out) else W.P(ws, a.out)
    try: c = LIB.card(os.path.basename(bed), ws); an = c.get('analysis') or BD.load_analysis(bed)
    except SystemExit: an = BD.load_analysis(bed)
    rep = arrange(ws, bed, an, bm, out)
    d = W.duration(out)
    if abs(d - rep['total']) > 0.06: raise SystemExit(f'arranged bed is {d:.3f} s, the film is {rep["total"]:.3f} s')
    if a.option:                                          # the arrangement is the option's clock from now on
        o['bed']['arranged'] = W.rel(ws, out); o['bed']['arrangement'] = W.rel(ws, out + '.json'); fps = CK.fps_of(ws)
        old = {w['scene']: w for w in o.get('windows') or []}
        o['windows'] = [dict(old.get(s['scene'], {}), scene=s['scene'], **{'from': CK.q(s['t0'], fps)}, to=CK.q(s['t1'], fps), len=round(CK.q(s['t1'], fps) - CK.q(s['t0'], fps), 6),
                             frames=int(round((CK.q(s['t1'], fps) - CK.q(s['t0'], fps)) * fps)), beats=s['beats'], bpm=s['bpm_play']) for s in rep['sections']]
        o['clock'] = dict(o.get('clock') or {}, fps=fps, total=o['windows'][-1]['to'], frames=int(round(o['windows'][-1]['to'] * fps)))
        o['arrangeWarnings'] = rep['warnings']; W.jwrite(of, o)
    for w in rep['warnings']: W.log('WARNING ' + w)
    print(json.dumps(dict(out=rep['out'], total=rep['total'], splices=rep['splices'], button=rep['button_s'],
                          sections=[(s['scene'], s['role'], s['feel'], s['bpm_target'], s['bpm_play'], s['tempo_mode'], s['tempo_ratio'], s['join_in']) for s in rep['sections']])))


if __name__ == '__main__': main()
