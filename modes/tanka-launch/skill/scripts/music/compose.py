#!/usr/bin/env python3
"""Stage 3 · Eleven Music composition plan from the script's scene list: one chunk per section, each with its own BPM and styles.

  scripts/py music/compose.py [--ws DIR] [--script A] [--bpm 102] [--bpm-map option-or-map.json] [--model music_v2_5] [--id D]
                              [--tail 3] [--seed 7] [--dry-run] [--register]

Clock: without --bpm-map, the scenes' windows are whole bars at each scene's arc tempo (library.py option_clock; common/clock.py),
so the composed bed, its option's windows and later the scenes.json lengths share one clock.
Sections: consecutive scenes merged until each is >= 3 s (the API minimum; <= 120 s, <= 30 chunks); BPM per section from --bpm-map
(an option JSON or a bpmMap list), else the arc (slow suspense -> build -> climax -> slow release) around --bpm. Styles: the first
chunk carries the full palette (it sets the genre) + its section styles + "<bpm> BPM"; later chunks their section styles + BPM;
every chunk the negatives from references/style-presets.md (music-negatives; the .md wins over style.json). music_v2 / v2_5 get
composition_plan.chunks; music_v1 gets the sections form (positive/negative_global_styles + sections[]).
The last chunk is --tail s longer so the model's own ending can be trimmed. GOTCHA (2026-09-24): v2.5 ignores section dynamics and
normalises the whole piece to ~ -14 dB RMS, so per-section gain automation is applied afterwards (suspense -8, build -3, climax 0,
release -5 dB; 0.5 s ramps).
Paid: ~$0.60/min (ledger reserve first; request / song id recorded). Mock: the placeholder-pulse seed bed fitted + the same gain automation.
--dry-run prints the plan + the estimate and exits. Writes stages/music/beds/<id>-compose.flac, the plan JSON, the option."""
import argparse, json, os, re, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ws as W, paid, audio as A, timeline as TL, style as STY, clock as CK
import library as LIB

STYLE = STY.load()          # references/style-presets.md wins; common/style.json is only the fallback
ROLE_DB = {'suspense': -8.0, 'build': -3.0, 'climax': 0.0, 'release': -5.0}


def sections(bm):
    out = []
    for s in bm:
        if out and (out[-1]['to'] - out[-1]['from'] < 3.0 or s['to'] - s['from'] < 3.0) and out[-1]['role'] == s['role']:
            out[-1]['to'] = s['to']; out[-1]['scenes'].append(s['scene']); continue
        out.append(dict(s, scenes=[s['scene']]))
    i = 0
    while i < len(out):                                              # anything still < 3 s joins its neighbour
        if out[i]['to'] - out[i]['from'] < 3.0 and len(out) > 1:
            j = i - 1 if i > 0 else i + 1; a, b = sorted((i, j))
            out[a]['to'] = out[b]['to']; out[a]['scenes'] += out[b]['scenes']; out.pop(b); i = 0; continue
        i += 1
    return out[:30]


def plan(secs, model, tail):
    neg = STYLE['negatives']; chunks = []
    for i, s in enumerate(secs):
        st = STYLE['section_styles'].get(s['role'], []) + ([] if i < len(secs) - 1 else STYLE['section_styles']['outro'])
        pal = [x.strip() for x in re.split(r'(?<=[.;])\s+', STYLE['palette']) if x.strip()]
        pos = (pal + ['instrumental', 'great production quality'] if i == 0 else []) + st + [f"{s['bpm']:.0f} BPM"]
        if i == 0: pos += STYLE['section_styles']['intro'][:3]
        dur = int(round((s['to'] - s['from'] + (tail if i == len(secs) - 1 else 0)) * 1000))
        chunks.append(dict(text=f"[{s['role'].title()} · {'+'.join(s['scenes'])}]", duration_ms=max(3000, min(120000, dur)), positive_styles=pos[:50],
                           negative_styles=neg, context_adherence='medium' if (i and abs(s['bpm'] / secs[i - 1]['bpm'] - 1) > 0.05) else 'high'))
    if model in ('music_v2', 'music_v2_5'): return dict(chunks=chunks)
    return dict(positive_global_styles=[x.strip() for x in re.split(r'(?<=[.;])\s+', STYLE['palette']) if x.strip()] + ['instrumental'], negative_global_styles=neg,
                sections=[dict(section_name=c['text'].strip('[]')[:100], positive_local_styles=c['positive_styles'], negative_local_styles=neg, duration_ms=c['duration_ms'], lines=[]) for c in chunks])


def automate(y, secs, ramp=0.5):
    n = len(y); t = np.arange(n) / A.SR; gdb = np.zeros(n)
    for s in secs: gdb[(t >= s['from']) & (t < s['to'])] = ROLE_DB.get(s['role'], -3.0)
    k = int(ramp * A.SR); gdb = np.convolve(np.pad(gdb, (k, k), mode='edge'), np.ones(k) / k, 'same')[k:-k]
    return y * A.db(gdb)[:, None]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ws'); ap.add_argument('--script'); ap.add_argument('--bpm', type=float, default=102.0); ap.add_argument('--bpm-map')
    ap.add_argument('--model', default='music_v2_5', choices=['music_v1', 'music_v2', 'music_v2_5']); ap.add_argument('--id', default='D')
    ap.add_argument('--tail', type=float, default=3.0); ap.add_argument('--seed', type=int); ap.add_argument('--dry-run', action='store_true'); ap.add_argument('--register', action='store_true')
    a = ap.parse_args()
    ws = W.ws_root(a.ws); sc = W.script_option(ws, a.script); W.disk_guard(ws, 'the composed bed'); wins = None
    if a.bpm_map:
        j = W.jread(a.bpm_map if os.path.isabs(a.bpm_map) else os.path.join(ws, a.bpm_map)); bm = j['bed']['bpmMap'] if isinstance(j, dict) else j
        wins = j.get('windows') if isinstance(j, dict) else None
    else: wins, bm = LIB.option_clock(sc, a.bpm, 'per-scene', CK.fps_of(ws), tuple(W.languages(ws)))   # the option's clock: whole bars per scene tempo
    total = bm[-1]['to']
    secs = sections(bm); cp = plan(secs, a.model, a.tail)
    secs_len = sum(s['to'] - s['from'] for s in secs) + a.tail; est = round(paid.est_music(secs_len), 3)
    pf = W.P(ws, 'stages', 'music', 'compose', f'{a.id}-plan.json'); W.jwrite(pf, dict(model=a.model, composition_plan=cp, sections=secs, est_usd=est))
    if a.dry_run:
        print(json.dumps(dict(plan=W.rel(ws, pf), model=a.model, seconds=round(secs_len, 1), est_usd=est, chunks=len(secs),
                              sections=[(s['role'], '+'.join(s['scenes']), round(s['to'] - s['from'], 1), s['bpm']) for s in secs]), ensure_ascii=False)); return
    pd = paid.Paid(ws, 'music'); flac = W.P(ws, 'stages', 'music', 'beds', f'{a.id}-compose.flac')
    if pd.mock:
        c = LIB.card('placeholder-pulse', ws); y, _ = LIB.fit(c, total); rid = 'mock'; pd.mock_record(f'compose {a.id} ({len(secs)} chunks) -> library placeholder-pulse')
    else:
        mp3 = W.P(ws, 'stages', 'music', 'compose', f'{a.id}.mp3')
        with paid.Slots(ws, 'elevenlabs-music', 2):
            with pd.call('elevenlabs', f'music compose {a.id} {secs_len:.0f}s {a.model} {len(secs)} chunks', est) as cc:
                import el
                r = el.compose(mp3, composition_plan=cp, model_id=a.model, seed=a.seed); cc['request_id'] = r['request_id'] or r.get('song_id')
        rid = cc['request_id']; y = A.load(mp3)
        if len(y) / A.SR < total - 0.5: W.log(f'WARNING: composed {len(y) / A.SR:.1f} s for a {total:.1f} s film (padded)')
    y = A.fit(y, int(round(total * A.SR))); fo = int(1.0 * A.SR); y[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 1.5
    y = automate(y, secs); A.write(flac, y)
    meta = dict(title=f'Composed · per-section BPM ({a.model})', model=a.model, plan=W.rel(ws, pf), requestId=rid, bpmMap=bm, licence=STYLE['licence_note'])
    if wins: meta['windows'] = wins
    of, row = LIB.write_option(ws, a.id, flac, 'compose', meta, sc, total)
    of2 = LIB.merge_options(ws, [row]); W.register_options(ws, 'music', of2, a.register)
    print(json.dumps(dict(option=a.id, bed=W.rel(ws, flac), chunks=len(secs), requestId=rid, est_usd=est)))


if __name__ == '__main__': main()
