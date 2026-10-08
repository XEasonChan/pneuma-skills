#!/usr/bin/env python3
"""Stage 3 · pacing demos per music option: a music-only listen (bed at the mix level + 8 dB, limited) and a guide-VO demo (the VO laid
in the option's scene windows over the bed at -26.8 LUFS, ducked 9 dB under every line) -> stages/music/demos/<id>-{music,guide-<lang>}.mp3.

  scripts/py music/demo.py [--ws DIR] [--option A|A,B|all] [--lang en|ja] [--register]

ONE clock (music-locked): the demo runs on the option's own windows (option.windows, else its arranged sections, else its bpmMap
from/to; common/clock.py) — the same windows vo/pick.py fits the lines into and `music/lock.py apply` writes into scenes.json. So
the demo's length = the windows' total = the bed's length, to the frame (checked; a mismatch stops the script).
Guide VO: the picked lines (stages/vo/lines.json, each at its window start + `at`) when they exist, else a free macOS `say` guide read
of the script's VO at window start + 0.3 s (never a paid TTS call); a guide line that overruns its window (+ 0.35 s tail) is reported.
Uses the option's arranged bed (bed.arranged) when music/arrange.py has run, else its bed.file; E1-style beds get the -4 dB
5 kHz shelf. Updates each option's demo{music, guideVo (the brief's lead language when made), byLang, clock, vo_at, overruns} and
options.json previews. Verifies lengths and TP <= -1.6 dBTP."""
import argparse, glob, json, os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import ws as W, audio as A, vostem, clock as CK

SR = A.SR; MUSIC_LUFS = -26.8; LISTEN_GAIN = 8.0; CEIL = -1.6


def make_demo(ws, f, lang, fps=None):
    """the two demos of one option file; returns the demo record (also written into the option)"""
    fps = fps or CK.fps_of(ws); o = W.jread(f); wins = CK.option_windows(ws, o, fps)
    if not wins: raise SystemExit(f"{W.rel(ws, f)}: no windows / bpmMap: nothing to place the VO in")
    total = float(wins[-1]['to']); n = int(round(total * SR))
    bed = o['bed'].get('arranged') or o['bed']['file']; x = A.load(os.path.join(ws, bed)); bl = len(x) / SR
    if abs(bl - total) > 0.5 / fps + 1e-3:
        raise SystemExit(f"{o['id']}: the bed {bed} is {bl:.3f} s but its windows end at {total:.3f} s ({(bl - total) * fps:+.1f} frames): "
                         f"re-run music/arrange.py --option {o['id']} (or library.py fit to {total:.3f} s)")
    vo, spans, words, _, info = vostem.build(ws, lang, total=total, windows=wins)
    if info['guide']: W.log(f"{o['id']}: guide VO via `say` for: {', '.join(info['guide'])}")
    for ov in info['overruns']: W.log(f"{o['id']} {lang}: {'guide ' if ov['guide'] else ''}line {ov['id']} overruns window {ov['scene']} by {ov['over_s']} s (+0.35 s tail)")
    m = A.fit(x, n)
    if o['bed'].get('shelf5k'): m = A.high_shelf(m)
    m = A.gain_to(m, MUSIC_LUFS)
    duck = A.duck_gain(len(m), [(s, d) for s, d, _ in spans], 9.0, 0.25, 0.5)
    music_only = A.limit_to_ceiling(m * A.db(LISTEN_GAIN), CEIL)
    guide = A.limit_to_ceiling(vo + m * duck[:, None], CEIL)
    fo = int(0.3 * SR); guide[-fo:] *= np.linspace(1, 0, fo)[:, None]; music_only[-fo:] *= np.linspace(1, 0, fo)[:, None]
    pm = W.P(ws, 'stages', 'music', 'demos', f"{o['id']}-music.mp3"); pg = W.P(ws, 'stages', 'music', 'demos', f"{o['id']}-guide-{lang}.mp3")
    A.write(pm, music_only); A.write(pg, guide)
    for p in (pm, pg):
        d = W.duration(p)
        if abs(d - total) > 0.1: raise SystemExit(f'{p}: {d:.2f} s != the windows {total:.2f} s')
    st = W.ebur128(pg)
    if st['tp'] is not None and st['tp'] > CEIL + 0.3: W.log(f"WARNING {pg}: TP {st['tp']} dBTP after MP3")
    clr = []
    for s, d, lid in spans:
        i, j = int(s * SR), int((s + d) * SR); clr.append(round(A.lufs(vo[i:j]) - A.lufs((m * duck[:, None])[i:j]), 1))
    by = dict((o.get('demo') or {}).get('byLang') or {}); by[lang] = W.rel(ws, pg)
    lead = W.voice_lang(W.languages(ws)[0]) if W.languages(ws) else lang
    o['demo'] = dict(music=W.rel(ws, pm), guideVo=by.get(lead) or W.rel(ws, pg), byLang=by, lang=lang, guide_from=('say' if info['guide'] else 'vo/lines.json'),
                     guide_lufs=st['lufs'], guide_tp=st['tp'], vo_clearance_lu_min=min(clr) if clr else None,
                     clock=dict(fps=fps, total=round(total, 6), frames=int(round(total * fps)), bed_s=round(bl, 4)),
                     vo_at={lid: round(s, 3) for s, d, lid in spans}, overruns=info['overruns'])
    W.jwrite(f, o)
    return o['demo']


def refresh_rows(ws, register=False):
    of = W.P(ws, 'stages', 'music', 'options.json')
    if not os.path.exists(of): return None
    opts = W.jread(of)
    for op in opts:
        j = W.P(ws, 'stages', 'music', 'options', f"{op['id']}.json")
        if os.path.exists(j):
            d = W.jread(j).get('demo') or {}
            if d.get('guideVo'): op['preview'] = d['guideVo']; op['files'] = sorted(set(op.get('files', []) + [d['music'], d['guideVo']]))
    W.jwrite(of, opts); W.register_options(ws, 'music', of, register)
    return of


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ws'); ap.add_argument('--option', default='all'); ap.add_argument('--lang'); ap.add_argument('--register', action='store_true')
    a = ap.parse_args()
    ws = W.ws_root(a.ws); lang = W.voice_lang(a.lang or W.languages(ws)[0])
    files = sorted(glob.glob(W.P(ws, 'stages', 'music', 'options', '*.json')))
    if a.option != 'all': files = [f for f in files if os.path.basename(f)[:-5] in a.option.split(',')]
    if not files: raise SystemExit('no music options (run music/library.py options, music/v2m.py or music/compose.py first)')
    for f in files:
        d = make_demo(ws, f, lang)
        print(json.dumps(dict(option=os.path.basename(f)[:-5], music=d['music'], guide=d['guideVo'], total=d['clock']['total'], frames=d['clock']['frames'],
                              lufs=d['guide_lufs'], tp=d['guide_tp'], vo_over_music_lu_min=d['vo_clearance_lu_min'], overruns=len(d['overruns']))))
    refresh_rows(ws, a.register)


if __name__ == '__main__': main()
