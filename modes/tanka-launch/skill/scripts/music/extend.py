#!/usr/bin/env python3
"""Stage 3/8 · extend a LOCKED bed by beat loops where the picture gained hold time.

  scripts/py music/extend.py --bed stages/music/beds/A.flac --insert 12.40:1.05 [--insert 30.2:2.1] --out stages/music/beds/A-ext.flac [--loop-beats 2]

--insert <bed time s>:<inserted s>  the point in the OLD bed where the picture holds longer, and by how much.
At each point a loop of `--loop-beats` (default 2) that sits in the groove is replayed n times, n x loop = the insert EXACTLY (each
loop is 2 beats +- a few ms; the timeline rule "round inserted holds to whole beats" keeps that error tiny — the script warns when a
loop is off the beat by more than 10 ms). Junction: the quietest point 30-300 ms before the loop's end beat whose band spectrum best
matches the audio one loop earlier; a 60 ms equal-power cross-fade (the next kick comes from one side only: no flam).
Writes the bed + <out>.json (per seam: new-time junctions for qc/qc.py seams, spectral match, level). No paid call."""
import argparse, json, os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import ws as W, audio as A, beats as B, beds as BD

SR = A.SR; XF = 0.060


def junction(x, s, Lp):
    best = None
    for m in np.arange(max(Lp + 0.05, s - 0.30), s - 0.03, 0.005):
        d = np.abs(B.band_spec(x, m - 0.04, m + 0.04) - B.band_spec(x, m - 0.04 - Lp, m + 0.04 - Lp)).mean()
        e = 20 * np.log10(np.sqrt(np.mean(x[int((m - 0.04) * SR):int((m + 0.04) * SR)] ** 2)) + 1e-9)
        c = d + 0.15 * (e + 30)
        if best is None or c < best[0]: best = (c, m, d, e)
    return best


def extend(x, grid, P, inserts, loop_beats=2):
    """inserts [(bed_t, seconds)] -> (y, report); every junction reported in NEW time"""
    grid = np.asarray(grid); out = []; pos = 0; rep = []; shift = 0.0; h = int(XF * SR / 2)
    w = np.linspace(0, np.pi / 2, 2 * h)[:, None]; fo, fi = np.cos(w), np.sin(w)
    for t, D in sorted(inserts):
        base = loop_beats * P; n = max(1, int(round(D / base))); Lp = D / n
        s = float(grid[np.argmin(abs(grid - t))]) if len(grid) else t
        s = max(s, Lp + 0.4)
        _, m, d, e = junction(x, s, Lp)
        im = int(round(m * SR)); KT = int(round(D * SR)); k = KT // n; rem = KT - k * n
        if im - h < pos: raise SystemExit(f'insert at {t:.2f} s overlaps the previous one; merge them')
        out.append(x[pos:im + h].copy())
        for r in range(n):
            kk = k + (rem if r == 0 else 0); blk = x[im - kk - h: im + h].copy()
            out[-1][-2 * h:] = out[-1][-2 * h:] * fo + blk[:2 * h] * fi; out.append(blk[2 * h:])
        tail = x[im - h: im + h]; out[-1][-2 * h:] = out[-1][-2 * h:] * fo + tail * fi; pos = im + h
        off_ms = abs(Lp - base) * 1000
        rep.append(dict(at_bed_s=round(t, 3), loop_end_beat=round(s, 3), inserted_s=round(D, 5), repeats=n, loop_s=round(Lp, 5), loop_beats=round(Lp / P, 3),
                        off_beat_ms=round(off_ms, 1), warn=('insert is not whole beats: round the hold to %d beats (%.3f s)' % (round(D / P), round(D / P) * P) if off_ms > 10 else None),
                        junctions_new_s=[round(m + shift + r * Lp, 3) for r in range(n + 1)], spectral_diff=round(float(d), 2), level_dbfs=round(float(e), 1)))
        shift += D
    out.append(x[pos:])
    return np.concatenate(out), rep


def loop_fill(x, grid, P, need, groove_start=0.0):
    """make a short bed longer: 2-bar loops inserted 4 bars before the end of its groove (the ending stays the ending)"""
    grid = np.asarray(grid); total = len(x) / SR
    t = float(np.clip(total - 18 * P, groove_start + 4 * P, max(groove_start + 4 * P, total - 4 * P)))
    n = int(np.ceil(need / (8 * P))); return extend(x, grid, P, [(t, n * 8 * P)], loop_beats=8)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ws'); ap.add_argument('--bed', required=True); ap.add_argument('--insert', action='append', required=True)
    ap.add_argument('--out', required=True); ap.add_argument('--loop-beats', type=int, default=2)
    a = ap.parse_args()
    ws = W.ws_root(a.ws); bed = a.bed if os.path.isabs(a.bed) else os.path.join(ws, a.bed); W.disk_guard(ws, 'the extended bed')
    x = A.load(bed); an = BD.load_analysis(bed)
    ins = [(float(s.split(':')[0]), float(s.split(':')[1])) for s in a.insert]
    y, rep = extend(x, an['beats'], an['beat_s'], ins, a.loop_beats)
    out = a.out if os.path.isabs(a.out) else W.P(ws, a.out); A.write(out, y)
    want = len(x) / SR + sum(d for _, d in ins); got = W.duration(out)
    if abs(got - want) > 0.03: raise SystemExit(f'extended bed is {got:.3f} s, wanted {want:.3f} s')
    for r in rep:
        if r['warn']: W.log('WARNING ' + r['warn'])
    W.jwrite(out + '.json', dict(bed=W.rel(ws, bed), out=W.rel(ws, out), beat_s=an['beat_s'], len_old=round(len(x) / SR, 4), len_new=round(got, 4), seams=rep))
    print(json.dumps(dict(out=W.rel(ws, out), len_old=round(len(x) / SR, 3), len_new=round(got, 3), seams=[(r['at_bed_s'], r['repeats'], r['loop_s'], r['warn']) for r in rep])))


if __name__ == '__main__': main()
