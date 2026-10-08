#!/usr/bin/env python3
"""Stage 5 · take pick: the best measured take per line x language -> stages/vo/final/<lang>/<id>.mp3 + stages/vo/lines.json (contracts §5)

  scripts/py vo/pick.py [--ws DIR] [--lang ja,en|all] [--prefer S1:ja:2,S2:en:1] [--music A] [--lead 0.3] [--register]

The clock (music-locked, common/clock.py): the picked music option's scene windows (--music, else film.json stages.music.pick,
else stages/music/clock.json; the script's durationS only as the VO-locked fallback, with a warning). Every line is PLACED in its
window: `at` = seconds from the window start (the kit's 0.3 s lead; lines of one scene back to back with a 0.35 s gap), and it FITS
when at + duration + the kit's 0.35 s tail <= the window (else the picture would stretch the scene off the music).
Ranking per line: read check OK (then unchecked, never a failed read unless nothing else exists) > fits its window > fewer forced
pauses > less pause editing > take 1. --prefer pins a take (The producer's ear wins).
Rules checked and flagged into stages/vo/options.json (row `flags`, summary), picks.json and takes-board.json:
  fit      a line that overruns its window (other take -> shorter wording -> extend the window by whole beats)
  ja-en    each JA line <= its EN line + 25 % (launch-vo.md rule 7)
  density  JA <= 190 chars per minute of runtime, EN <= 140 words per minute of runtime (runtime = the clock's total; style-presets)
lines.json words are DISPLAY tokens (the brand's display form, not a mishearing) timed from the aligned transcript; JA entries also carry
caption chunks per sentence ("caps"). Each entry also carries `at`, `window` {from, to} and `fit`. Also stages/vo/takes-board.json
(every take, the pick marked: the canvas's VO page). Writes stages/vo/options.json (one option, "measured picks") for `tl.mjs options set vo`."""
import argparse, difflib, glob, json, os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import ws as W, audio as A, clock as CK

SKIP = re.compile(r'[\s、。，．「」『』！？!?,.・…]')
JA_CPM, EN_WPM, JA_OVER_EN = 190.0, 140.0, 1.25


def ja_chars(text):
    return len(SKIP.sub('', text or ''))


def en_words(text):
    return len([w for w in re.split(r'\s+', text or '') if re.search(r'[A-Za-z0-9]', w)])


def interp_times(n, pairs, first, last):
    """pairs {index: (start, end)} -> per index (start, end), gaps linearly interpolated"""
    s = [None] * n; e = [None] * n
    for i, (a, b) in pairs.items(): s[i], e[i] = a, b
    for i in range(n):
        if s[i] is None:
            a = i - 1
            while a >= 0 and s[a] is None: a -= 1
            b = i + 1
            while b < n and s[b] is None: b += 1
            ta = e[a] if a >= 0 else first; tb = s[b] if b < n else last; g = b - a - 1; r = i - a - 1
            s[i] = ta + (tb - ta) * r / g; e[i] = ta + (tb - ta) * (r + 1) / g
    return s, e


def ja_tokens(rec):
    tts = rec['tts']; T = [c for c in tts if not SKIP.match(c)]
    Sc = [(ch, c['start'], c['end']) for w in rec['words'] if w.get('type') == 'word'
          for c in (w.get('characters') or [dict(text=w['text'], start=w['start'], end=w['end'])]) for ch in c['text'] if not SKIP.match(ch)]
    if not Sc: return [], []
    sm = difflib.SequenceMatcher(None, T, [c for c, *_ in Sc], autojunk=False); pairs = {}
    for a, b, n in sm.get_matching_blocks():
        for k in range(n): pairs[a + k] = (Sc[b + k][1], Sc[b + k][2])
    s, e = interp_times(len(T), pairs, Sc[0][1], Sc[-1][2])
    toks = []; i = 0; txt = ''.join(T); br = W.brand()
    sp = SKIP.sub('', br['spoken']['ja']) if br else ''; disp = br['display'] if br else ''
    while i < len(T):
        if sp and txt[i:i + len(sp)] == sp and disp in rec['text']: toks.append(dict(text=disp, start=round(s[i], 3), end=round(e[i + len(sp) - 1], 3))); i += len(sp)
        else: toks.append(dict(text=T[i], start=round(s[i], 3), end=round(e[i], 3))); i += 1
    # caption chunks = display sentences, timed by their characters
    caps = []; disp = rec['text']; sents = [x for x in re.split(r'(?<=[。？！])', disp) if x.strip()]
    k = 0
    for snt in sents:
        n = len(SKIP.sub('', snt.replace(disp, 'T') if disp else snt))
        if n <= 0 or k >= len(toks): continue
        seg = toks[k:k + n]; caps.append(dict(text=snt, start=seg[0]['start'], end=seg[-1]['end'])); k += n
    return toks, caps


def en_tokens(rec):
    disp = rec['text'].split(); sw = [w for w in rec['words'] if w.get('type') == 'word']
    if not sw: return []
    br = W.brand(); alias = {h: br['display'].lower() for h in br['heard']['en']} if br else {}
    norm = lambda t: (lambda v: alias.get(v, v))(re.sub(r'[^a-z0-9]', '', t.lower()))
    sm = difflib.SequenceMatcher(None, [norm(t) for t in disp], [norm(w['text']) for w in sw], autojunk=False); pairs = {}
    for a, b, n in sm.get_matching_blocks():
        for k in range(n): pairs[a + k] = (sw[b + k]['start'], sw[b + k]['end'])
    s, e = interp_times(len(disp), pairs, sw[0]['start'], sw[-1]['end'])
    return [dict(text=t, start=round(s[i], 3), end=round(e[i], 3)) for i, t in enumerate(disp)]


def the_clock(ws, music=None):
    """the scene windows lines are fitted into: {scene: window} + the clock (common/clock.py resolve)"""
    clk = CK.resolve(ws, music)
    if clk['source'] == 'script':
        W.log('WARNING no music option picked (film.json stages.music.pick) and no stages/music/clock.json: fitting to the script durationS '
              '(VO-locked fallback). Music-locked order: script -> music -> voice -> VO; pass --music <id> to fit a specific option.')
    return {s['id']: s for s in clk['scenes']}, clk


def place(lines, wins, lead=CK.LEAD):
    """set at / window / fit on every entry: lines of a scene back to back from the lead (kit layout: 0.3 s lead, 0.35 s gap, 0.35 s tail)"""
    flags = []
    for lang in sorted({l['lang'] for l in lines}):
        by = {}
        for l in lines:
            if l['lang'] == lang: by.setdefault(l['sceneId'], []).append(l)
        for sid, ls in by.items():
            w = wins.get(sid); cur = lead
            for l in sorted(ls, key=lambda x: x['id']):
                l['at'] = round(cur, 3)
                if not w:
                    l['fit'] = dict(status='no-window'); flags.append(dict(rule='fit', id=l['id'], lang=lang, note=f'scene {sid} is not on the music clock')); continue
                end = cur + l['durS'] + CK.TAIL; margin = round(w['len'] - end, 3)
                l['window'] = {'from': w['start'], 'to': w['end'], 'len': w['len'], 'frames': w['frames']}
                l['fit'] = dict(status='fits' if margin >= -1e-3 else 'overflow', margin_s=margin, end_s=round(cur + l['durS'], 3))
                if margin < -1e-3:
                    flags.append(dict(rule='fit', id=l['id'], lang=lang, over_s=round(-margin, 3),
                                      note=f"{lang} {l['id']}: {l['durS']:.2f} s + {lead:.1f} s lead + {CK.TAIL:.2f} s tail > window {w['len']:.2f} s by {-margin:.2f} s "
                                           f"-> the other take, a shorter line, or extend {sid} by whole beats (music/extend.py)"))
                cur = cur + l['durS'] + CK.GAP
    return flags


def rules(lines, clk):
    """JA <= EN + 25 % per line, and the density ceilings per minute of RUNTIME (the clock's total) -> (flags, stats)"""
    flags = []; by = {(l['id'], l['lang']): l for l in lines}
    for (iid, lang), l in sorted(by.items()):
        if lang != 'ja' or (iid, 'en') not in by: continue
        en = by[(iid, 'en')]; r = l['durS'] / max(1e-3, en['durS'])
        l['jaOverEn'] = round(r, 3)
        if r > JA_OVER_EN + 1e-3:
            flags.append(dict(rule='ja-en', id=iid, lang='ja', ratio=round(r, 3),
                              note=f"JA {iid} {l['durS']:.2f} s is {r - 1:+.0%} vs EN {en['durS']:.2f} s (rule: <= +25 %) -> shorten the JA wording in the script"))
    runtime = max(1e-3, float(clk.get('total') or 0)); stats = dict(runtime_s=round(runtime, 3), denominator='minutes of runtime (the music clock total)')
    ja = [l for l in lines if l['lang'] == 'ja']; en = [l for l in lines if l['lang'] == 'en']
    if ja:
        n = sum(ja_chars(l['text']) for l in ja); v = n / (runtime / 60); stats.update(ja_chars=n, ja_chars_per_min=round(v, 1), ja_vo_s=round(sum(l['durS'] for l in ja), 2))
        if v > JA_CPM: flags.append(dict(rule='density', lang='ja', value=round(v, 1), note=f'JA {v:.0f} chars/min of runtime > {JA_CPM:.0f} ({n} chars / {runtime:.1f} s) -> cut JA wording'))
    if en:
        n = sum(en_words(l['text']) for l in en); v = n / (runtime / 60); stats.update(en_words=n, en_wpm=round(v, 1), en_vo_s=round(sum(l['durS'] for l in en), 2))
        if v > EN_WPM: flags.append(dict(rule='density', lang='en', value=round(v, 1), note=f'EN {v:.0f} wpm of runtime > {EN_WPM:.0f} ({n} words / {runtime:.1f} s) -> cut EN wording'))
    return flags, stats


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ws'); ap.add_argument('--lang'); ap.add_argument('--prefer', default=''); ap.add_argument('--register', action='store_true')
    ap.add_argument('--music', help='the music option whose windows the lines fit (default: film.json stages.music.pick, else stages/music/clock.json)')
    ap.add_argument('--lead', type=float, default=CK.LEAD, help='seconds from the window start to the first line (the kit default 0.3)')
    a = ap.parse_args()
    ws = W.ws_root(a.ws); langs = W.languages(ws, a.lang)
    rc = {(r['id'], r['lang'], r['take']): r for r in W.jread(W.P(ws, 'stages', 'vo', 'readcheck.json'), {'takes': []})['takes']}
    wins, clk = the_clock(ws, a.music)
    room = {k: w['len'] - a.lead - CK.TAIL for k, w in wins.items()}
    prefer = {}
    for p in [x for x in a.prefer.split(',') if x]:
        i, lg, t = p.split(':'); prefer[(i, lg)] = int(t)
    procs = {}
    for f in sorted(glob.glob(W.P(ws, 'stages', 'vo', 'proc', '*', '*.json'))):
        r = W.jread(f)
        if r['lang'] in langs: procs.setdefault((r['id'], r['lang']), []).append(r)
    if not procs: raise SystemExit('no processed takes: run vo/post.py first')
    old = [l for l in W.jread(W.P(ws, 'stages', 'vo', 'lines.json'), []) if l['lang'] not in langs]
    out = list(old); report = []; board = []
    for (iid, lang), rs in sorted(procs.items()):
        def score(r):
            c = rc.get((iid, lang, r['take']), {}); ok = c.get('ok')
            fits = r['metrics']['dur'] <= room.get(r['sceneId'], 1e9) + 1e-3
            return ({True: 0, None: 1, False: 2}[ok], 0 if fits else 1, r['forced'], round(r['edit_s'], 2), r['take'])
        rs.sort(key=score); best = next((r for r in rs if r['take'] == prefer.get((iid, lang))), rs[0])
        chk = rc.get((iid, lang, best['take']), {})
        if chk.get('ok') is False: W.log(f'WARNING {lang} {iid}: every take failed the read check ({chk.get("note")}); picked t{best["take"]} — regenerate or listen')
        mp3 = W.P(ws, 'stages', 'vo', 'final', lang, f'{iid}.mp3'); x = A.load(os.path.join(ws, best['file'])); A.write(mp3, x, bitrate='192k')
        d = W.duration(mp3)
        if abs(d - best['metrics']['dur']) > 0.08: raise SystemExit(f'{mp3}: duration {d:.3f} != processed {best["metrics"]["dur"]:.3f}')
        if lang == 'ja': words, caps = ja_tokens(best)
        else: words, caps = en_tokens(best), None
        ent = dict(id=iid, sceneId=best['sceneId'], lang=lang, text=best['text'], take=best['take'], file=W.rel(ws, mp3), durS=round(d, 3), words=words)
        if caps: ent['caps'] = caps
        ent['readOk'] = chk.get('ok'); out.append(ent)
        for r in sorted(rs, key=lambda r: r['take']):      # the canvas's take board: every take, the pick marked
            c = rc.get((iid, lang, r['take']), {})
            board.append(dict(id=iid, sceneId=r['sceneId'], lang=lang, text=r['text'], take=r['take'], file=r['file'], durS=round(r['metrics']['dur'], 3),
                              picked=r is best, check=('read OK' if c.get('ok') else 'read FAILED' if c.get('ok') is False else 'unchecked') + (f" · {c['note']}" if c.get('note') else ''),
                              window=round(wins[r['sceneId']]['len'], 3) if r['sceneId'] in wins else None,
                              fits=(r['metrics']['dur'] <= room[r['sceneId']] + 1e-3) if r['sceneId'] in room else None))
        report.append(dict(id=iid, lang=lang, pick=f"t{best['take']}", durS=round(d, 3), read=chk.get('ok'), note=chk.get('note'), forced=best['forced'],
                           windowS=wins[best['sceneId']]['len'] if best['sceneId'] in wins else None))
    out.sort(key=lambda l: (l['lang'], l['id']))
    mine = [l for l in out if l['lang'] in langs]
    flags = place(mine, wins, a.lead)
    fl2, stats = rules(out, clk); flags += fl2
    fit_of = {(l['id'], l['lang']): l for l in mine}
    for r in report:
        l = fit_of.get((r['id'], r['lang']), {}); r.update(at=l.get('at'), fit=(l.get('fit') or {}).get('status'), margin_s=(l.get('fit') or {}).get('margin_s'), jaOverEn=l.get('jaOverEn'))
        print(f"{r['lang']} {r['id']:10s} {r['pick']} {r['durS']:5.2f}s in {r['windowS'] if r['windowS'] is not None else '?':>7} s window at {r['at']} -> {r['fit']} "
              f"({r['margin_s']:+.2f} s) read {r['read']} forced {r['forced']}" if r.get('margin_s') is not None else f"{r['lang']} {r['id']} {r['pick']} {r['durS']:.2f}s (no window)")
    for b in board:
        b['flags'] = [f['rule'] for f in flags if f.get('id') == b['id'] and f.get('lang') == b['lang']] if b['picked'] else []
    for f in flags: W.log('FLAG ' + f['note'])
    lf = W.jwrite(W.P(ws, 'stages', 'vo', 'lines.json'), out)
    W.jwrite(W.P(ws, 'stages', 'vo', 'picks.json'), dict(clock=dict(source=clk['source'], option=clk.get('option'), total=clk['total'], frames=clk['frames'], fps=clk['fps']),
                                                       lines=report, flags=flags, stats=stats))
    bf = W.jwrite(W.P(ws, 'stages', 'vo', 'takes-board.json'), sorted(board, key=lambda b: (b['lang'], b['id'], b['take'])))
    bad = [r for r in report if r['read'] is False]
    cnt = {k: sum(1 for f in flags if f['rule'] == k) for k in ('fit', 'ja-en', 'density')}
    summ = (f"{len(report)} lines · {sum(1 for r in report if r['read'])} read-checked OK" + (f" · {len(bad)} FAILED" if bad else '')
            + f" · clock {clk['source']} {clk['total']:.2f} s" + (f" · JA {stats['ja_chars_per_min']:.0f} chars/min" if 'ja_chars_per_min' in stats else '')
            + (f" · EN {stats['en_wpm']:.0f} wpm" if 'en_wpm' in stats else '')
            + (' · FLAGS: ' + ', '.join(f'{v} {k}' for k, v in cnt.items() if v) if flags else ' · all lines fit their windows'))
    opts = [dict(id='A', title='Measured picks', summary=summ, recommended=True, files=[W.rel(ws, bf)], preview=out[0]['file'] if out else None,
                 flags=flags, clock=dict(source=clk['source'], total=clk['total'], frames=clk['frames']))]   # lines.json + picks.json are hashed as the stage's own files
    of = W.jwrite(W.P(ws, 'stages', 'vo', 'options.json'), opts)
    W.register_options(ws, 'vo', of, a.register)


if __name__ == '__main__': main()
