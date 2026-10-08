"""The VO stem of a film in one language: every picked line (stages/vo/lines.json) laid at its timeline position.

Positions, in order of preference: explicit `windows` (the music clock, common/clock.py: each line at its window start + its `at`
from lines.json, else + the 0.3 s lead; what music/demo.py uses, so a demo plays on the option's own windows) -> timeline.json
tracks.vo (from/dur, id, lang) -> the scene start + lead (0.3 s) from timeline.json scenes -> the script option's durationS
sequence. A guide VO (`say`) stands in for lines that don't exist yet."""
import os
import numpy as np
import audio as A, ws as W, timeline as TL, mock, clock as CK

SR = A.SR


def window_positions(ws, lang, windows, lead=CK.LEAD):
    """{line_id: start_s} on the music clock: lines of a scene run from its window start + `at` (lines.json, written by vo/pick.py)
    or back to back from the lead with the kit's 0.3 s lead / 0.35 s gap; a scene without a picked line gets its guide at the lead"""
    lines = [l for l in W.jread(os.path.join(ws, 'stages', 'vo', 'lines.json'), []) if l['lang'] == lang]
    pos = {}
    for sid, (a, b) in windows.items():
        mine = [l for l in lines if l.get('sceneId') == sid]; cur = lead
        for l in mine:
            at = float(l['at']) if l.get('at') is not None else cur; pos[l['id']] = round(a + at, 4); cur = at + float(l.get('durS', 0)) + CK.GAP
        if not mine: pos[sid] = round(a + lead, 4)
    return pos


def positions(ws, lang, lead=0.3, windows=None):
    """{line_id: start_s}, the film length and {scene: (start, end)}; windows = [{scene, from, to}] (the music clock) wins"""
    if windows:
        m = {w['scene']: (float(w['from']), float(w['to'])) for w in windows}
        return window_positions(ws, lang, m, lead), max(b for a, b in m.values()), m
    tlp = os.path.join(ws, 'timeline.json')
    if os.path.exists(tlp):
        t = TL.load(ws, lang=lang)
        pos = {v['id']: v['start'] for v in t['vo'] if str(v.get('lang', lang))[:2] == lang[:2]}
        if pos: return pos, t['total'], {s['id']: (s['start'], s['end']) for s in t['scenes']}
        sc = {s['id']: (s['start'], s['end']) for s in t['scenes']}
        return {k: a + lead for k, (a, b) in sc.items()}, t['total'], sc
    sc, total = TL.from_script(W.script_option(ws))
    m = {s['id']: (s['start'], s['end']) for s in sc}
    return {k: a + lead for k, (a, b) in m.items()}, total, m


def build(ws, lang, total=None, target_lufs=-14.3, guide_ok=True, windows=None):
    """-> (stem (n,2), spans [(start, dur, id)], words [(a, b)], total_s, info). The stem is normalised to target_lufs (the VO-only
    master convention) with one linear gain; a line longer than its scene (or window) is reported, never squeezed."""
    pos, tot, scenes = positions(ws, lang, windows=windows)
    total = total or tot; n = int(round(total * SR)); stem = np.zeros((n, 2)); spans = []; words = []; info = dict(guide=[], missing=[], overruns=[])
    lines = {l['id']: l for l in W.jread(os.path.join(ws, 'stages', 'vo', 'lines.json'), []) if l['lang'] == lang}
    sc = None
    for lid, at in sorted(pos.items(), key=lambda kv: kv[1]):
        ln = lines.get(lid)
        if ln and os.path.exists(os.path.join(ws, ln['file'])):
            x = A.load(os.path.join(ws, ln['file'])); wl = [(at + w['start'], at + w['end']) for w in ln.get('words', []) if w['end'] > w['start']]
        elif guide_ok:
            if sc is None: sc = {s['id']: s for s in W.script_option(ws).get('scenes', [])}
            text = ((sc.get(lid) or {}).get('vo') or {}).get(lang)
            if not text: continue
            p = os.path.join(ws, 'stages', 'music', 'guide', lang, f'{lid}.mp3')
            if not os.path.exists(p): mock.say(W.tts_text(text, lang), p, lang)
            x = A.trim_silence(A.load(p)); x = A.gain_to(x, -16.0); wl = [(at, at + len(x) / SR)]; info['guide'].append(lid)
        else:
            info['missing'].append(lid); continue
        A.place(stem, x, at); d = len(x) / SR; spans.append((at, d, lid)); words += wl
        sid = (ln or {}).get('sceneId') or lid
        if sid in scenes and at + d + (CK.TAIL if windows else 0) > scenes[sid][1] + 0.05:
            info['overruns'].append(dict(id=lid, scene=sid, over_s=round(at + d + (CK.TAIL if windows else 0) - scenes[sid][1], 2), guide=ln is None))
    if np.abs(stem).max() > 0: stem = A.gain_to(stem, target_lufs)
    return stem, spans, words, total, info
