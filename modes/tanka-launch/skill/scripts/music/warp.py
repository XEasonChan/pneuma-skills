#!/usr/bin/env python3
"""Stage 9 · the EN bed from the JA bed: whole-beat edits + a small Rubber Band remainder, so the groove survives (warp_en.py method).

  scripts/py music/warp.py --bed <JA bed> --ja <timeline-ja.json|scenes.json> --en <timeline-en.json|scenes.json> --out <EN bed>
                           [--pin S1,S4] [--lockup OUTRO] [--maxr 0.04] [--option A] [--ws DIR]

--ja / --en: a timeline.json (scenes from/len) or a JSON list [{id, start, end}] per language; scene ids must match.
Stretching EN shots one by one swings the tempo by up to 23 %, so each anchor-to-anchor span is realised as (a) an EVEN whole-beat
edit (remove or repeat 2 / 4 / 8 beats, so the backbeat stays on 2 and 4) spliced 12 ms before a beat with a 16 ms equal-power
cross-fade at the most self-similar beat pair in the span, plus (b) the remainder as a smooth stretch (Rubber Band R2 crisp 6 on
grooved spans, R3 on ambient ones), <= 4 % in a groove (--maxr) and <= 9 % in ambient spans. A dynamic programme chooses which scene
starts to pin (mandatory: the first, the last and --pin; a cut where the bed does something — a level step or strong onset — costs
more to miss). After the lockup (--lockup, default the last scene) the bed runs 1:1, so the ending / button lands exactly as in JA.
Writes the EN bed + <out>.json (spans, edits, stretch %, unpinned-cut offsets, the EN beat grid) + <out-stem>.ana.json. No paid call."""
import argparse, json, os, subprocess, sys, tempfile
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import ws as W, audio as A, beds as BD, beats as B, timeline as TL

SR = A.SR; MAXR_AMB = 0.09


def scene_starts(ws, p):
    j = W.jread(p)
    if isinstance(j, list): items = [dict(id=s['id'], start=s.get('start', s.get('from', 0)), end=s.get('end', s.get('start', s.get('from', 0)) + s.get('len', 0))) for s in j]
    elif 'tracks' in j or 'formats' in j: items = TL.load(ws, path=p)['scenes']
    else: items = TL.scenes(ws, p)['scenes']
    total = max(s['end'] for s in items)
    return [s['id'] for s in items], [s['start'] for s in items], total


def beat_similarity(x, beats, i, j, P):
    def spec(t0):
        a = int(t0 * SR); seg = x[a:a + int(P * SR)].mean(1)
        if len(seg) < 1024: return None
        return np.log1p(np.abs(np.fft.rfft(seg * np.hanning(len(seg)), 8192))[:1500] * 50)
    s = []
    for off in (0.0, -P):
        u, v = spec(beats[i] + off), spec(beats[j] + off)
        if u is not None and v is not None: s.append(float(u @ v / (np.linalg.norm(u) * np.linalg.norm(v) + 1e-9)))
    return float(np.mean(s)) if s else 0.0


def plan(ids, J, E, beats, P0, wt, mand, maxr, last=True):
    def rhythmic(a, b):
        inb = beats[(beats >= a) & (beats <= b)]; P = float(np.median(np.diff(inb))) if len(inb) > 2 else P0
        return np.sum((beats > a) & (beats < b)) >= max(3, 0.7 * (b - a) / P)
    def seg_cost(i, j):
        Lj, Le = J[j] - J[i], E[j] - E[i]; rh = rhythmic(J[i], J[j]); lim = maxr if rh else max(MAXR_AMB, maxr); best = None
        inb = beats[(beats >= J[i]) & (beats <= J[j])]; P = float(np.median(np.diff(inb))) if len(inb) > 2 else P0   # the local beat (arranged beds change tempo)
        for k in ((0, 4, -4, 2, -2, 8, -8) if rh else (0,)):
            L2 = Lj - k * P
            if L2 < 0.5: continue
            if k and np.sum((beats > J[i] + 0.6) & (beats < J[j] - 0.6 - max(0, k) * P)) < 1: continue
            r = Le / L2
            if abs(r - 1) > lim: continue
            c0 = {0: 0, 4: 1.0, 8: 1.8, 2: 2.0}[abs(k)] + (abs(r - 1) / 0.02) ** 2
            bounds = [J[i]] + [J[m] for m in range(i + 1, j)] + [J[j]]
            for q in (range(len(bounds) - 1) if k else [0]):
                lo, hi = bounds[q], bounds[q + 1]
                if k and np.sum((beats > lo + 0.3) & (beats < hi - 0.3 - max(0, k) * P)) < 1: continue
                c = c0
                for m in range(i + 1, j):
                    mapped = E[i] + (J[m] - J[i] - (k * P if (J[m] >= hi and k) else 0)) * r; c += wt[m] * ((mapped - E[m]) / 0.25) ** 2
                if best is None or c < best[0]: best = (c, k, r, (lo, hi))
        return best
    n = len(J); INF = 1e18; cost = [INF] * n; prev = [None] * n; cost[0] = 0; choice = {}
    for j in range(1, n):
        for i in range(j - 1, -1, -1):
            if any(m in mand for m in range(i + 1, j)): break
            sc = seg_cost(i, j)
            if sc is None or cost[i] >= INF: continue
            if cost[i] + sc[0] < cost[j]: cost[j] = cost[i] + sc[0]; prev[j] = i; choice[j] = sc
    if cost[-1] >= INF and not last: return None
    if cost[-1] >= INF:                                              # nothing fits the limits: pin everything, stretch as needed
        W.log('WARNING: no span plan within the stretch limits; pinning every cut (listen for tempo drift)')
        return [dict(a=ids[i], b=ids[i + 1], ja=[J[i], J[i + 1]], en=[E[i], E[i + 1]], k=0, ratio=round((E[i + 1] - E[i]) / (J[i + 1] - J[i]), 4), edit_window=[J[i], J[i + 1]]) for i in range(n - 1)]
    path = [n - 1]
    while path[-1] != 0: path.append(prev[path[-1]])
    path = path[::-1]; spans = []
    for a, b in zip(path[:-1], path[1:]):
        c, k, r, win = choice[b]; spans.append(dict(a=ids[a], b=ids[b], ja=[J[a], J[b]], en=[E[a], E[b]], k=int(k), ratio=round(r, 4), edit_window=[round(win[0], 2), round(win[1], 2)]))
    return spans


def rubberband(y, r, grooved):
    d = tempfile.mkdtemp(prefix='tl-rb-'); fi, fo = os.path.join(d, 'i.wav'), os.path.join(d, 'o.wav'); A.write(fi, y)
    eng = ['-2', '-c', '6'] if grooved else ['-3']
    rr = subprocess.run(['rubberband', '-q'] + eng + ['-t', f'{r:.8f}', fi, fo], capture_output=True, text=True)
    if rr.returncode: raise SystemExit('rubberband failed: ' + rr.stderr[-300:])
    q = A.load(fo); os.remove(fi); os.remove(fo); os.rmdir(d); return q, ' '.join(eng)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ws'); ap.add_argument('--bed', required=True); ap.add_argument('--ja', required=True); ap.add_argument('--en', required=True)
    ap.add_argument('--out', required=True); ap.add_argument('--option', help='music option id: record the EN bed as bed.arranged_en'); ap.add_argument('--pin', default=''); ap.add_argument('--lockup'); ap.add_argument('--maxr', type=float, default=0.04)
    a = ap.parse_args(); ws = W.ws_root(a.ws); W.disk_guard(ws, 'the EN warp')
    rp = lambda p: p if os.path.isabs(p) else os.path.join(ws, p)
    bed = rp(a.bed); x = A.load(bed); an = BD.load_analysis(bed)
    idj, J, totj = scene_starts(ws, rp(a.ja)); ide, E0, tote = scene_starts(ws, rp(a.en)); em = dict(zip(ide, E0))
    if idj != ide: W.log('WARNING: scene ids differ between JA and EN; matching by id')
    lock = a.lockup or idj[-1]; iL = idj.index(lock)
    ids = idj[:iL + 1]; Jl = J[:iL + 1]; El = [em[i] for i in ids]
    NJ = int(round(totj * SR)); x = A.fit(x, max(NJ, len(x)))
    beats = np.array(an['beats']); P = float(an['beat_s'])
    import analyse as AN
    cs = AN.cut_sync(x, Jl[1:], len(x) / SR)['per_cut']; wt = [0.4] + [0.4 + abs(r['dL']) / 2.5 + max(0, r['onset']) / 3 for r in cs]
    mand = {0, len(ids) - 1} | {ids.index(p) for p in a.pin.split(',') if p in ids}
    spans = None
    for mul in (1.0, 2.0, 3.0):                                        # widen the stretch limit before giving up on beat edits
        spans = plan(ids, Jl, El, beats, P, wt, mand, a.maxr * mul, last=(mul == 3.0))
        if spans is not None:
            if mul > 1: W.log(f'NOTE: needed a stretch limit of {a.maxr * mul:.0%} (x{mul:.0f}); listen to the flagged spans')
            break
    eps = 0.012; cuts = []
    for s in spans:
        k = s['k']
        if not k: continue
        lo, hi = s['edit_window'][0] + 0.3, s['edit_window'][1] - 0.3
        idx = [i for i, b in enumerate(beats) if lo < b and i + abs(k) < len(beats) and beats[i + abs(k)] < hi]
        if not idx: s['k'] = 0; continue
        best = max(idx, key=lambda i: beat_similarity(x, beats, i, i + abs(k), P)); sim = beat_similarity(x, beats, best, best + abs(k), P)
        cuts.append((beats[best] - eps, beats[best + k] - eps) if k > 0 else (beats[best - k] - eps, beats[best] - eps))
        s['edit'] = dict(at_ja=round(float(beats[best]), 3), beats=k, similarity=round(sim, 3), kind=('remove %d beats' % k) if k > 0 else ('repeat %d beats' % -k))
    # splice
    pieces = []; t0 = 0.0
    for f, to in sorted(cuts): pieces.append((t0, f)); t0 = to
    pieces.append((t0, len(x) / SR))
    h = int(0.008 * SR); xf = 2 * h; fin = np.sin(np.linspace(0, np.pi / 2, xf))[:, None]; fout = np.cos(np.linspace(0, np.pi / 2, xf))[:, None]
    y = np.zeros((int(sum(b_ - a_ for a_, b_ in pieces) * SR) + 4 * xf, 2)); E0p = 0; segmap = []
    for n, (a_, b_) in enumerate(pieces):
        i0, i1 = int(round(a_ * SR)), int(round(b_ * SR)); lo_, hi_ = (i0 - h if n else i0), (min(len(x), i1 + h) if n < len(pieces) - 1 else i1)
        seg = x[lo_:hi_].copy()
        if n: seg[:xf] *= fin
        if n < len(pieces) - 1: seg[-xf:] *= fout
        st0 = E0p - (i0 - lo_); y[st0:st0 + len(seg)] += seg; segmap.append((a_, b_, E0p / SR)); E0p += i1 - i0
    y = y[:E0p]
    def ja2sp(t):
        for a_, b_, s0 in segmap:
            if a_ - 1e-6 <= t <= b_ + 1e-6: return s0 + (t - a_)
        return None
    anchors = [(0.0, 0.0)] + [(ja2sp(s['ja'][1]), s['en'][1]) for s in spans]
    tail = len(y) / SR - anchors[-1][0]; anchors.append((len(y) / SR, anchors[-1][1] + tail))
    sp = np.array([p for p, _ in anchors]); en_ = np.array([q for _, q in anchors])
    bsp = np.array([v for v in (ja2sp(b) for b in beats) if v is not None])
    joins = [0.0]
    for a_ in sp[1:-1]:
        near = bsp[np.abs(bsp - a_) < 0.35]; joins.append(float(near[np.argmin(np.abs(near - a_))] - 0.012) if len(near) else float(a_))
    joins.append(len(y) / SR); ej = [float(np.interp(v, sp, en_)) for v in joins]
    NE = int(round(tote * SR)); z = np.zeros((max(NE, int(ej[-1] * SR)) + SR, 2)); segs = []; m = int(0.25 * SR)
    for k in range(len(joins) - 1):
        a_, b_ = joins[k], joins[k + 1]; ta, tb = ej[k], ej[k + 1]
        if b_ - a_ < 0.02: continue
        r = (tb - ta) / (b_ - a_); ia, ib = int(round(a_ * SR)), int(round(b_ * SR)); oa = int(round(ta * SR)); nt = int(round(tb * SR)) - oa
        grooved = int(np.sum((bsp > a_) & (bsp < b_))) >= 3
        if abs(r - 1) < 5e-4: core = y[max(0, ia - h):ib + h]; pre = ia - max(0, ia - h); eng = 'copy'
        else:
            lo_, hi_ = max(0, ia - m), min(len(y), ib + m); q, eng = rubberband(y[lo_:hi_], r, grooved); c0 = int(round((ia - lo_) * r))
            core = q[max(0, c0 - h):c0 + nt + h]; pre = c0 - max(0, c0 - h)
        core = core.copy()
        if k: core[:xf] *= fin
        if k < len(joins) - 2: core[-xf:] *= fout
        st0 = oa - pre; L = min(len(core) - max(0, -st0), len(z) - max(0, st0)); z[max(0, st0):max(0, st0) + L] += core[max(0, -st0):max(0, -st0) + L]
        segs.append(dict(ja_sp=[round(a_, 3), round(b_, 3)], en=[round(ta, 3), round(tb, 3)], ratio=round(r, 4), engine=eng, grooved=grooved))
    z = A.fit(z, NE); fo = int(0.05 * SR); z[-fo:] *= np.linspace(1, 0, fo)[:, None]
    out = rp(a.out); A.write(out, z)
    beats_en = sorted(float(np.interp(s_, np.array(joins), np.array(ej))) for s_ in (ja2sp(b) for b in beats) if s_ is not None)
    for s in spans:
        s['stretch_pct'] = round((s['ratio'] - 1) * 100, 2)
        s['audible_risk'] = 'ok' if abs(s['ratio'] - 1) <= 0.02 else ('mild' if abs(s['ratio'] - 1) <= 0.035 else 'audible?')
    pinned = {s['b'] for s in spans} | {ids[0]}; miss = []
    for i, tj in zip(ids, Jl):
        if i in pinned: continue
        s_ = ja2sp(tj); mm = float(np.interp(s_, np.array(joins), np.array(ej))) if s_ is not None else None
        miss.append(dict(scene=i, ja=tj, en=em[i], bed_lands=None if mm is None else round(mm, 3), off_s=None if mm is None else round(mm - em[i], 3)))
    rec = dict(bed=W.rel(ws, bed), out=W.rel(ws, out), beat_s=round(P, 4), lockup=lock, spans=spans, unpinned_cuts=miss, segments=segs,
               crossfade_ms=16, beats_en=[round(b, 4) for b in beats_en], len_s=round(W.duration(out), 3), en_total=tote)
    W.jwrite(out + '.json', rec)
    W.jwrite(os.path.splitext(out)[0] + '.ana.json', dict(an, beats=rec['beats_en'], durS=tote, steady=False, warped_from=W.rel(ws, bed)))
    if abs(rec['len_s'] - tote) > 0.06: raise SystemExit(f"EN bed {rec['len_s']} s != EN film {tote} s")
    if a.option:
        of = W.P(ws, 'stages', 'music', 'options', f'{a.option}.json'); o = W.jread(of); o['bed']['arranged_en'] = rec['out']; o['bed']['warp_en'] = W.rel(ws, out + '.json'); W.jwrite(of, o)
    print(json.dumps(dict(out=rec['out'], len_s=rec['len_s'], spans=[(s['a'], s['b'], s['k'], s['stretch_pct'], s['audible_risk']) for s in spans],
                          unpinned=[(u['scene'], u['off_s']) for u in miss])))


if __name__ == '__main__':
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main()
