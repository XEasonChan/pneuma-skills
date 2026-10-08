#!/usr/bin/env python3
"""Stage 3 · analyse a bed: BPM, beat grid, downbeat phase, groove start, key (+ scale / pentatonic / triad), per-section loudness,
onset density and centroid, a 3 s loudness curve, and (with --scenes) the cut-sync check -> <out>.json (default <bed>.ana.json).

  scripts/py music/analyse.py <bed.(mp3|flac|wav|pcm)> [--ws DIR] [--sections sections.json] [--script A] [--bpm-hint 102] [--out file.json]

Beat grid: onset-flux dynamic-programme tracker, refined to the transients; a machine-steady bed (grid residual <= 8 ms rms: most
Eleven Music beds) gets the straight-line fit over its whole length (one clock for intro, groove and outro). Key: Krumhansl on a
magnitude chroma (80-2500 Hz). Sections: --sections [{name,start,end}], else the script's scenes (--script), else 8-bar blocks.
--pcm input = ElevenLabs pcm_44100 (s16le stereo). Cut-sync (with --script): level step and onset strength at each scene cut
vs 400 random points — Video-to-Music follows mood, not cuts; the SFX layer lands the cuts. No paid call."""
import argparse, json, os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import ws as W, audio as A, beds as BD, beats as B, timeline as TL

SR = A.SR


def cut_sync(x, cuts, total):
    t, fl = B.onset_env(x); z = (fl - np.median(fl)) / (np.percentile(fl, 90) - np.median(fl) + 1e-9)
    m = B.mono(x)
    rms = lambda a, b: 20 * np.log10(np.sqrt(np.mean(m[int(max(a, 0) * SR):int(min(b, total) * SR)] ** 2)) + 1e-9)
    def at(c):
        w = (t > c - 0.12) & (t < c + 0.12)
        return dict(t=round(c, 2), dL=round(rms(c, c + 0.5) - rms(c - 0.5, c), 1), onset=round(float(z[w].max()) if w.any() else 0, 1))
    per = [at(c) for c in cuts]; base = [at(c) for c in np.random.default_rng(0).uniform(1, total - 1, 400)]
    thr = np.percentile(z, 97)
    return dict(per_cut=per, mean_abs_dL_cuts=round(float(np.mean([abs(r['dL']) for r in per])), 2) if per else None,
                mean_abs_dL_random=round(float(np.mean([abs(r['dL']) for r in base])), 2),
                strong_onset_cuts=round(float(np.mean([r['onset'] >= thr for r in per])), 2) if per else None,
                strong_onset_random=round(float(np.mean([r['onset'] >= thr for r in base])), 2))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('bed'); ap.add_argument('--ws'); ap.add_argument('--sections'); ap.add_argument('--script'); ap.add_argument('--bpm-hint', type=float)
    ap.add_argument('--out')
    a = ap.parse_args()
    ws = W.ws_root(a.ws); p = a.bed if os.path.isabs(a.bed) else os.path.join(ws, a.bed)
    x = A.load_pcm(p) if p.endswith('.pcm') else A.load(p)
    secs = W.jread(a.sections) if a.sections else None; cuts = []
    if a.script:
        sc, _ = TL.from_script(W.script_option(ws, a.script)); secs = secs or [dict(name=s['id'], start=s['start'], end=s['end']) for s in sc]
        cuts = [s['start'] for s in sc][1:]
    r = BD.analyse(x, secs, a.bpm_hint); r['file'] = W.rel(ws, p)
    if cuts: r['cut_sync'] = cut_sync(x, cuts, len(x) / SR)
    out = (a.out if os.path.isabs(a.out) else W.P(ws, a.out)) if a.out else (os.path.splitext(p)[0] + '.ana.json')   # --out is workspace-relative
    W.jwrite(out, r)
    print(json.dumps({k: v for k, v in r.items() if k not in ('beats', 'loudness_curve', 'key')} | dict(key=r['key']['key'], out=W.rel(ws, out)), ensure_ascii=False)[:2000])


if __name__ == '__main__': main()
