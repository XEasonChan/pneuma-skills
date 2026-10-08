#!/usr/bin/env python3
"""Stage 5 · VO post: tempo + pause rules + -16 LUFS per line, on every raw take -> stages/vo/proc/<lang>/<id>.t<n>.flac + .json

  scripts/py vo/post.py [--ws DIR] [--lang ja,en|all] [--only S1] [--tempo-en 1.11] [--lufs -16]

EN: atempo x1.11 first (a linear time map: the word times are scaled with it), then the pause rules: commas keep the voice's own
    pause, capped at 0.35 s (never opened); : ; 0.20-0.40 s; . ? ! ... 0.40-0.55 s (opened to 0.45 when shorter).
JA: no speed-up; natural pauses: 、 0.25-0.35 s, 。？！ 0.45-0.60 s (opened to 0.28 / 0.50 when shorter).
    Pauses are placed on the MEASURED gaps (a -42 dB speech/silence envelope), matched to the punctuation in order by a small
    dynamic programme — whisper's JA character times are spread evenly per token and put marks on the wrong gap.
    Only when no gap is near a mark is a pause opened at the quietest 5 ms frame near its expected position ("forced").
Both: lead 0.15 s before the first onset, 0.25 s after the last offset, 20 ms fade-out, -16 LUFS, sample peak <= -1 dBFS.
The word timings (from <take>.scribe.json) are mapped through every edit. Needs vo/readcheck.py first."""
import argparse, difflib, json, os, re, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import ws as W, audio as A

SR = A.SR; HOP = 0.005
JA_PUN = re.compile(r'[、。？！]'); SKIP = re.compile(r'[\s、。，．「」『』！？!?,.・…]')
JA_T = {'、': (0.25, 0.35, 0.28), '。': (0.45, 0.60, 0.50), '？': (0.45, 0.60, 0.50), '！': (0.45, 0.60, 0.50)}
EN_T = {',': (0.0, 0.35, 0.0), ':': (0.20, 0.40, 0.28), ';': (0.20, 0.40, 0.28), '.': (0.40, 0.55, 0.45), '?': (0.40, 0.55, 0.45), '!': (0.40, 0.55, 0.45), '…': (0.40, 0.55, 0.45)}


def load(p, tempo=1.0):
    af = ['-af', f'atempo={tempo}'] if tempo != 1.0 else []
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', p, *af, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True)
    return np.frombuffer(r.stdout, np.float32).astype(np.float64)


def env_db(x):
    n = int(HOP * SR); m = len(x) // n
    e = np.sqrt((x[:m * n].reshape(m, n) ** 2).mean(1) + 1e-12); return 20 * np.log10(e / e.max())


def speech_segs(x, thr=-42, min_gap=0.05):
    db = env_db(x); on = db > thr; segs = []; i = 0; m = len(on)
    while i < m:
        if on[i]:
            j = i
            while j < m and on[j]: j += 1
            segs.append([i * HOP, j * HOP]); i = j
        else: i += 1
    mg = []
    for a, b in segs:
        if mg and a - mg[-1][1] < min_gap: mg[-1][1] = b
        else: mg.append([a, b])
    return [s for s in mg if s[1] - s[0] >= 0.02], db


def ja_marks(tts, words, span):
    """punctuation marks inside the line -> [(mark, expected_t)]: the whisper-aligned position when the alignment is good, else the
    character-proportional position over the speech span (both only an EXPECTATION: the pause goes on a measured gap)"""
    T = [(c, i) for i, c in enumerate(tts) if not SKIP.match(c)]
    Sc = []
    for w in words:
        if w.get('type') != 'word': continue
        for c in (w.get('characters') or [dict(text=w['text'], start=w['start'], end=w['end'])]):
            for ch in c['text']:
                if not SKIP.match(ch): Sc.append((ch, c['start'], c['end']))
    sm = difflib.SequenceMatcher(None, [c for c, _ in T], [c for c, *_ in Sc], autojunk=False)
    t0 = [None] * len(T)
    for a, b, n in sm.get_matching_blocks():
        for k in range(n): t0[a + k] = Sc[b + k][1]
    matched = sum(n for *_, n in sm.get_matching_blocks()) / max(1, len(T))
    s0, s1 = span; out = []
    for pi, ch in enumerate(tts):
        if not JA_PUN.match(ch): continue
        before = [k for k, (_, i) in enumerate(T) if i < pi]; after = [k for k, (_, i) in enumerate(T) if i > pi]
        if not before or not after: continue
        prop = s0 + (s1 - s0) * len(before) / len(T)
        al = t0[after[0]] if (matched > 0.6 and t0[after[0]] is not None) else None
        out.append((ch, prop if al is None else 0.5 * (prop + al)))
    return out, matched


def assign_gaps(marks, gaps, reach=0.45):
    """monotonic DP: each mark takes one measured gap (in order) or none; cost = distance to its expected time, minus a bonus for a
    real pause; a missing gap costs 1.2 (the pause would have to be forced)"""
    M, G = len(marks), len(gaps); INF = 1e9
    cost = np.full((M + 1, G + 1), INF); cost[0, :] = 0; back = {}
    for i in range(1, M + 1):
        e = marks[i - 1][1]
        for j in range(G + 1):
            best = (cost[i - 1, j] + 1.2, (i - 1, j, None))                       # mark i gets no gap
            for k in range(j):                                                      # mark i takes gap k (< j), previous marks used < k
                g0, g1 = gaps[k]; d = abs(0.5 * (g0 + g1) - e)
                if d > reach: continue
                c = cost[i - 1, k] + (d / 0.35) ** 2 - 0.6 * min(g1 - g0, 0.4) / 0.4
                if c < best[0]: best = (c, (i - 1, k, k))
            cost[i, j] = best[0]; back[(i, j)] = best[1]
    i, j = M, G; out = [None] * M
    while i > 0:
        pi, pj, k = back[(i, j)]; out[i - 1] = k; i, j = pi, pj
    return out


def en_bounds(text, words):
    sw = [w for w in words if w.get('type') == 'word']
    toks = text.replace('…', '… ').split()
    br = W.brand(); BR = {'ok': 'okay', **({re.sub(r'[^a-z0-9]', '', h): re.sub(r'[^a-z0-9]', '', br['display'].lower()) for h in br['heard']['en']} if br else {})}
    norm = lambda s: (lambda v: BR.get(v, v))(re.sub(r'[^a-z0-9]', '', s.lower().replace('’', "'")))
    sm = difflib.SequenceMatcher(None, [norm(t) for t in toks], [norm(w['text']) for w in sw], autojunk=False); m = {}
    for a, b, n in sm.get_matching_blocks():
        for k in range(n): m[a + k] = b + k
    out = []
    for i, t in enumerate(toks[:-1]):
        pm = re.search(r'([,.:;?!…])[’”"]?$', t)
        if not pm: continue
        pa = next((m[k] for k in range(i, -1, -1) if k in m), None); nb = next((m[k] for k in range(i + 1, len(toks)) if k in m), None)
        if pa is None or nb is None: continue
        out.append((pm.group(1), sw[pa]['end'] - 0.08, sw[nb]['start']))
    return out, len(m) / max(1, len(toks))


def tmap_fn(ops):
    ops_t = sorted(ops)
    def f(t):
        add = 0.0
        for ot, d in ops_t:
            if d > 0:
                if t > ot: add += d
            else:
                r = -d; a = ot - r / 2
                if t >= a + r: add -= r
                elif t > a: add -= (t - a)
        return t + add
    return f


def apply_ops(x, ops):
    y = x.copy(); fade = int(0.006 * SR)
    for t, d in sorted(ops, key=lambda o: -o[0]):
        i = int(t * SR)
        if d > 0:
            pre, post = y[:i].copy(), y[i:].copy()
            if len(pre) > fade: pre[-fade:] *= np.linspace(1, 0, fade)
            if len(post) > fade: post[:fade] *= np.linspace(0, 1, fade)
            y = np.concatenate([pre, np.zeros(int(d * SR)), post])
        elif d < 0:
            r = int(-d * SR); a = i - r // 2; b = a + r
            pre, post = y[:a].copy(), y[b:].copy()
            if len(pre) > fade: pre[-fade:] *= np.linspace(1, 0, fade)
            if len(post) > fade: post[:fade] *= np.linspace(0, 1, fade)
            y = np.concatenate([pre, post])
    return y


def process(ws, ln, tk, tempo_en=1.11, target=-16.0):
    lang = ln['lang']; raw = os.path.join(ws, tk['file']); sc = W.jread(raw[:-4] + '.scribe.json')
    tempo = tempo_en if lang == 'en' else 1.0
    words = json.loads(json.dumps(sc['words']))
    if tempo != 1.0:
        k = 1.0 / tempo
        for w in words:
            w['start'] *= k; w['end'] *= k
            for c in (w.get('characters') or []): c['start'] *= k; c['end'] *= k
    x = load(raw, tempo); segs, db = speech_segs(x)
    if not segs: raise SystemExit(f"{tk['file']}: no speech found")
    text = re.sub(r'^\[[^\]]*\]\s*', '', ln['tts'])
    gaps = [(segs[i][1], segs[i + 1][0]) for i in range(len(segs) - 1) if segs[i + 1][0] - segs[i][1] >= 0.06]
    ops, report = [], []
    if lang == 'ja':
        marks, align = ja_marks(text, words, (segs[0][0], segs[-1][1]))
        asg = assign_gaps(marks, gaps)
        for (ch, e), k in zip(marks, asg):
            lo, hi, tgt = JA_T[ch]
            if k is not None:
                g0, g1 = gaps[k]; nat = g1 - g0; new = tgt if nat < lo else min(nat, hi)
                ops.append((g0 + nat * 0.5, new - nat)); report.append(dict(mark=ch, at=round(g0, 3), natural=round(nat, 3), new=round(new, 3), forced=False, expected=round(e, 3)))
            else:
                a_, b_ = int(max(0, e - 0.15) / HOP), int((e + 0.05) / HOP); b_ = max(b_, a_ + 1)
                f = a_ + int(np.argmin(db[a_:b_])); t = f * HOP
                ops.append((t, tgt)); report.append(dict(mark=ch, at=round(t, 3), natural=0.0, new=tgt, forced=True, expected=round(e, 3), floor_db=round(float(db[f]), 1)))
    else:
        bounds, align = en_bounds(text, words); used = set()
        allg = [(segs[i][1], segs[i + 1][0]) for i in range(len(segs) - 1)]
        for ch, ta, tb in bounds:
            lo, hi, tgt = EN_T[ch]
            cand = [(k, g) for k, g in enumerate(allg) if k not in used and g[1] > ta - 0.02 and g[0] < tb + 0.08]
            if cand:
                k, g = max(cand, key=lambda kg: kg[1][1] - kg[1][0]); used.add(k)
                nat = g[1] - g[0]; new = tgt if nat < lo else min(nat, hi)
                if abs(new - nat) > 0.005: ops.append((g[0] + nat * 0.5, new - nat))
                report.append(dict(mark=ch, at=round(g[0], 3), natural=round(nat, 3), new=round(new, 3), forced=False))
            elif tgt <= 0:
                report.append(dict(mark=ch, at=None, natural=0.0, new=0.0, forced=False))
            else:
                a_, b_ = int(max(ta, tb - 0.15) / HOP), int((tb + 0.03) / HOP); b_ = max(b_, a_ + 1)
                f = a_ + int(np.argmin(db[a_:b_])); t = f * HOP
                ops.append((t, tgt)); report.append(dict(mark=ch, at=round(t, 3), natural=0.0, new=tgt, forced=True))
    s0 = max(0.0, segs[0][0] - 0.15); s1 = min(len(x) / SR, segs[-1][1] + 0.25)
    y = apply_ops(x, ops); tm = tmap_fn(ops)
    a0 = int(tm(s0) * SR); b0 = int(tm(s1) * SR); y = y[a0:b0].copy(); lead = a0 / SR
    ft = min(len(y) // 4, int(0.02 * SR)); y[-ft:] *= np.linspace(1, 0, ft)
    ys = A.st(y); ys = A.gain_to(ys, target); pk = np.abs(ys).max()
    if pk > 0.89: ys *= 0.89 / pk
    out = W.P(ws, 'stages', 'vo', 'proc', lang, f"{ln['id']}.t{tk['take']}.flac"); A.write(out, ys)
    mp = lambda t: round(max(0.0, tm(t) - lead), 3)
    mw = [dict(text=w['text'], start=mp(w['start']), end=mp(w['end']), type=w.get('type', 'word'),
               **({'characters': [dict(text=c['text'], start=mp(c['start']), end=mp(c['end'])) for c in w['characters']]} if w.get('characters') else {}))
          for w in words]
    ps, _ = speech_segs(ys[:, 0]); pg = [round(ps[i + 1][0] - ps[i][1], 3) for i in range(len(ps) - 1)]
    dur = len(ys) / SR; span = ps[-1][1] - ps[0][0] if ps else dur
    met = dict(dur=round(dur, 3), span=round(span, 3), pauses=[g for g in pg if g >= 0.15], lufs=round(A.lufs(ys), 2))
    if lang == 'ja': nch = len(SKIP.sub('', ln['text'])); met.update(chars=nch, chars_per_min=round(nch / max(0.1, span) * 60, 1))
    else: nw = len(re.findall(r"[A-Za-z0-9’'-]+", ln['text'])); met.update(words=nw, wpm=round(nw / max(0.1, span) * 60, 1))
    rec = dict(id=ln['id'], sceneId=ln['sceneId'], take=tk['take'], lang=lang, tempo=tempo, text=ln['text'], tts=text, scribe=sc.get('text'),
               scribe_source=sc.get('source'), align=round(align, 2), bounds=report, metrics=met, lead_trim=round(lead, 3), file=W.rel(ws, out), words=mw,
               edit_s=round(sum(abs(b['new'] - b['natural']) for b in report), 3), forced=sum(1 for b in report if b['forced']))
    W.jwrite(out[:-5] + '.json', rec)
    return rec


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ws'); ap.add_argument('--lang'); ap.add_argument('--only'); ap.add_argument('--tempo-en', type=float, default=1.11)
    ap.add_argument('--lufs', type=float, default=-16.0)
    a = ap.parse_args()
    ws = W.ws_root(a.ws); tk = W.jread(W.P(ws, 'stages', 'vo', 'takes.json')); langs = W.languages(ws, a.lang)
    only = set(a.only.split(',')) if a.only else None
    for ln in tk['lines']:
        if ln['lang'] not in langs or (only and ln['id'] not in only): continue
        for t in ln['takes']:
            r = process(ws, ln, t, a.tempo_en, a.lufs); m = r['metrics']
            print(f"{r['lang']} {r['id']:10s} t{r['take']} dur {m['dur']:5.2f} lufs {m['lufs']:6.2f} "
                  + ' '.join(f"{b['mark']}{b['natural']:.2f}->{b['new']:.2f}{'F' if b['forced'] else ''}" for b in r['bounds']))


if __name__ == '__main__': main()
