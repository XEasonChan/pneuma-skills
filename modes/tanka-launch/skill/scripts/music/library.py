#!/usr/bin/env python3
"""Stage 3 · the music library: list the seed beds, fit one to a length, or build the standard three music options.

  scripts/py music/library.py list [--json]
  scripts/py music/library.py fit --bed placeholder-pulse|<file> --duration 20 --out stages/music/beds/E1-20s.flac [--from-groove] [--start 0]
  scripts/py music/library.py options [--ws DIR] [--script A] [--bed placeholder-pulse] [--contrast auto|<id>] [--recommend auto|grid|bpm]
                                      [--lang en] [--no-arrange] [--no-demo] [--register]

Library = <SKILL>/seed-library/music/*.json cards (+ <ws>/assets/library/music/*.json). Each card: brief, model, BPM, key, beat
grid, groove start, the SFX set it pairs with, the licence note. The shipped cards are procedural placeholders (a `placeholder` block:
common/placeholder_beds.py synthesises the audio into the cache on first use); a run adds its own licensed beds as cards in
assets/library/music/.
fit: cut on the beat grid. Longer beds end on a beat + a 1.2 s raised-cosine ring-out ("button" feel); shorter ones are extended
with 2-bar loops of the groove (music/extend.py's junction search), never stretched. --from-groove starts 1 bar before the groove.
options: the three options of launch-music.md, each on ITS OWN clock (common/clock.py): the script's durationS -> scene windows of
whole bars on the option's grid (never shorter than the estimated VO), frame-exact; bed.bpmMap from/to = those windows.
  A  one-grid density  - the bed's tempo on every scene; feel (suspense half-time, the peak climax double-time, a manifesto beat
                         after the climax half-time) and joins (stop before turns, drop into the first climax, button) carry the arc
  B  per-scene BPM     - the same bed, each scene at its own tempo along the arc (slow suspense -> build -> climax -> slow release,
                         nudged by density); windows on each scene's own bars, so every tempo holds exactly (no collapse)
  C  contrast bed      - a different bed (licence-safe first; else the most different family), arranged the way the recommended
                         option is
Recommended: B when the brief asks for tempo changes (bpm / tempo / テンポ / 节奏 / faster ... in run.brief, or
run.brief.music.tempoMap: true), else A (Q2); --recommend overrides. Each option is arranged (music/arrange.py) and gets its demos
(music/demo.py: music only + guide VO in its windows) unless --no-arrange / --no-demo. Writes stages/music/options/<A|B|C>.json
(bed, bpmMap, windows, clock, demo, licence, recommended) + options.json. No paid call; mock music uses this too.
After the producer's pick: `music/lock.py apply` makes the picked option's windows the scene windows (scenes.json)."""
import argparse, glob, json, os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import ws as W, audio as A, beds as BD, timeline as TL, clock as CK
import re

SR = A.SR


def cards(ws=None):
    out = []
    dirs = [os.path.join(W.seed_library(), 'music')] + ([os.path.join(ws, 'assets', 'library', 'music')] if ws else [])
    for d in dirs:
        for f in sorted(glob.glob(os.path.join(d, '*.json'))):
            c = W.jread(f); c['_card'] = f; c['_file'] = os.path.join(d, c['file'])
            if c.get('placeholder') and not os.path.exists(c['_file']):
                import placeholder_beds as PB
                c['_file'] = PB.ensure(c)                        # procedural placeholder: synthesised into the cache on first use
            out.append(c)
    return out


def card(bed, ws=None):
    for c in cards(ws):
        if bed in (c['id'], os.path.basename(c['_file'])): return c
    if os.path.exists(bed):
        a = BD.load_analysis(bed)
        return dict(id=os.path.splitext(os.path.basename(bed))[0], file=os.path.basename(bed), _file=bed, bpm=a['bpm'], key=a['key']['key'], analysis=a, sfxSet='E', shelf_5k_minus4db=False)
    raise SystemExit(f'no such bed: {bed} (see: music/library.py list)')


def fit(c, duration, start=None, from_groove=False, ring=1.2):
    x = A.load(c['_file']); a = c.get('analysis') or BD.load_analysis(c['_file']); g = np.array(a['beats']); P = a['beat_s']
    s0 = start if start is not None else (max(0.0, a['groove_start_s'] - 4 * P) if from_groove else 0.0)
    if s0 > 0:
        k = int(np.argmin(abs(g - s0))); s0 = max(0.0, g[k] - 0.012); x = x[int(s0 * SR):]; g = g[g >= s0] - s0
    n = int(round(duration * SR)); notes = dict(start_s=round(s0, 3))
    if len(x) >= n:
        cut = g[(g > duration - ring - 2 * P) & (g <= duration - ring)]
        tc = float(cut[-1]) if len(cut) else duration - ring
        y = x[:n].copy(); i = int(tc * SR); r = n - i
        y[i:] *= (0.5 + 0.5 * np.cos(np.pi * np.linspace(0, 1, r)))[:, None]
        notes.update(mode='trim', button_at_s=round(tc, 3))
    else:
        import extend as EX
        need = duration - len(x) / SR + 0.5
        y, rep = EX.loop_fill(x, g, P, need, a.get('groove_start_s', 0.0))
        y = A.fit(y, n); fo = int(0.5 * SR); y[-fo:] *= np.linspace(1, 0, fo)[:, None]
        notes.update(mode='extend', seams=rep)
    return y, notes


def scene_energy(s):
    lv = {'low': 0.2, 'mid': 0.55, 'high': 0.9}
    d = s.get('density') or {}
    return 0.5 * lv.get(str(d.get('info', 'mid')), 0.55) + 0.5 * lv.get(str(d.get('anim', 'mid')), 0.55)


def arc(sc, total=None):
    """per scene: (f = tempo factor on the arc 0.86 -> 1.06 at ~70 % -> 0.92, nudged +-6 % by density; role; energy)"""
    scenes, tot = TL.from_script(sc); total = total or tot; out = []
    for i, s in enumerate(scenes):
        p = (s['start'] + s['end']) / 2 / max(0.1, total)
        e = scene_energy(sc['scenes'][i]); f = float(np.interp(p, [0, 0.35, 0.7, 1.0], [0.86, 0.98, 1.06, 0.92]) + 0.12 * (e - 0.5))
        role = 'suspense' if i == 0 else ('release' if i == len(scenes) - 1 and len(scenes) > 2 else ('climax' if f >= 1.02 else 'build'))
        out.append(dict(scene=s['id'], f=f, role=role, energy=round(e, 2)))
    return out


def grid_feels(rows):
    """one-grid density: the feel per scene (suspense half-time, the peak climax double-time, a build right after the climax -
    the manifesto beat - half-time, else straight)"""
    peak = max((i for i, r in enumerate(rows) if r['role'] == 'climax'), key=lambda i: rows[i]['f'], default=None)
    seen_climax = False; out = []
    for i, r in enumerate(rows):
        if r['role'] == 'suspense': fe = 'half'
        elif i == peak and sum(1 for x in rows if x['role'] == 'climax') > 1: fe = 'double'
        elif r['role'] == 'build' and seen_climax: fe = 'half'
        else: fe = 'straight'
        seen_climax |= r['role'] == 'climax'; out.append(fe)
    return out


def bpm_map(sc, bed_bpm, total=None, windows=None, kind='per-scene'):
    """the bpmMap of an option: kind 'per-scene' (the arc x the bed's tempo) or 'grid' (the bed's tempo, feel per grid_feels);
    from/to = windows (the option's clock) when given, else the script's durationS sequence (legacy callers)"""
    rows = arc(sc, total); feels = grid_feels(rows) if kind == 'grid' else ['straight'] * len(rows)
    if windows is None:
        scenes, _ = TL.from_script(sc); windows = [dict(scene=s['id'], **{'from': s['start']}, to=s['end']) for s in scenes]
    out = []
    for r, fe, w in zip(rows, feels, windows):
        bpm = round(float(bed_bpm), 2) if kind == 'grid' else round(float(bed_bpm * r['f']), 1)
        out.append(dict(scene=r['scene'], **{'from': w['from']}, to=w['to'], bpm=bpm, feel=fe, role=r['role'], energy=r['energy']))
    return out


def option_clock(sc, bed_bpm, kind, fps, langs=('ja', 'en')):
    """(windows, bpmMap) of an arranged option: the per-scene grid tempos (after feel resolution) -> whole-bar windows -> the map"""
    rows = arc(sc); feels = grid_feels(rows) if kind == 'grid' else ['straight'] * len(rows)
    tempos = [bed_bpm if kind == 'grid' else CK.grid_tempo(bed_bpm * r['f'], fe, bed_bpm)[0] for r, fe in zip(rows, feels)]
    wins = CK.windows_ideal(sc['scenes'], tempos, fps, langs)
    return wins, bpm_map(sc, bed_bpm, windows=wins, kind=kind)


def licence_safe(c):
    """procedural / owned / royalty-free beds (a card's licenceSafe flag wins); Eleven Music output never is (Q4)"""
    if 'licenceSafe' in c: return bool(c['licenceSafe'])
    t = f"{c.get('licence', '')} {c.get('provider', '')} {c.get('source', '')}".lower()
    if 'eleven' in t: return False
    return bool(re.search(r'procedural|owned|royalty[- ]free|cc0|licen[cs]e[- ]safe|public domain', t))


def family(c):
    return re.sub(r'v\d+$', '', re.sub(r'^[^-]*-', '', c['id']))


def pick_contrast(main, cs, want='auto'):
    if want and want != 'auto': return card(want)
    others = [c for c in cs if c['id'] != main['id']]
    if not others: raise SystemExit('the library has one bed: no contrast option possible (add a bed, or --contrast <file>)')
    return min(others, key=lambda c: (not licence_safe(c), family(c) == family(main), -abs(float(c.get('bpm', 0)) / float(main.get('bpm', 1)) - 1)))


TEMPO_RE = re.compile(r'\bbpm\b|tempo|テンポ|节奏|速度|faster|slower|speed[- ]?up|slow[- ]?down|per[- ]scene', re.I)


def tempo_asked(ws):
    """does the brief ask for tempo changes? run.brief.music.tempoMap (bool) wins, else a keyword scan of the brief's text"""
    b = W.film(ws).get('run', {}).get('brief', {}) or {}
    m = b.get('music') if isinstance(b.get('music'), dict) else {}
    if isinstance(m.get('tempoMap'), bool): return m['tempoMap'], 'run.brief.music.tempoMap'
    txt = json.dumps({k: v for k, v in b.items() if k not in ('sources',)}, ensure_ascii=False)
    hit = TEMPO_RE.search(txt)
    return bool(hit), (f'the brief says "{hit.group(0)}"' if hit else 'the brief asks no tempo change')


def write_option(ws, oid, bed_file, source, meta, sc, total, recommended=False):
    """register one music option from a generated / chosen bed (used by v2m.py and compose.py) -> (option json path, options row).
    Windows: meta['windows'], else the bpmMap's from/to when it covers the bed, else whole bars on the bed's own beat grid."""
    a = BD.load_analysis(bed_file); fps = CK.fps_of(ws); bl = W.duration(bed_file)
    wins = meta.pop('windows', None); bm = meta.pop('bpmMap', None)
    if not wins and bm and abs(bm[-1]['to'] - bl) <= 0.05: wins = CK.windows_from_map(bm, fps)
    if not wins: wins = CK.windows_on_grid(sc['scenes'], a['beats'], a.get('downbeat_phase', 0), fps, total=bl)
    bm = bm or bpm_map(sc, a['bpm'], windows=wins)
    for b, w in zip(bm, wins): b['from'], b['to'] = w['from'], w['to']
    shelf = meta.pop('shelf5k', None)
    if shelf is None: shelf = 95 <= a['bpm'] <= 110
    sfx = meta.pop('sfxSet', None) or ('E' if 95 <= a['bpm'] <= 110 else 'A')
    o = dict(id=oid, title=meta.pop('title', f'{source} {oid}'), bed=dict(source=source, file=W.rel(ws, bed_file), full=W.rel(ws, bed_file), bpm=a['bpm'], bpmMap=bm,
                                                                           key=a['key']['key'], shelf5k=bool(shelf), **meta), sfxSet=sfx, windows=wins,
             clock=dict(fps=fps, total=wins[-1]['to'], frames=int(round(wins[-1]['to'] * fps)), grid='bed'), demo=dict(music=None, guideVo=None))
    of = W.jwrite(W.P(ws, 'stages', 'music', 'options', f'{oid}.json'), o)
    row = dict(id=oid, title=o['title'], summary=f"{a['bpm']:.0f} BPM {a['key']['key']} · SFX set {sfx} · {source} · windows on the bed's grid = {wins[-1]['to']:.2f} s",
               recommended=recommended, files=[W.rel(ws, of), W.rel(ws, bed_file)], preview=W.rel(ws, bed_file))
    return of, row


def merge_options(ws, rows):
    of = W.P(ws, 'stages', 'music', 'options.json'); cur = {r['id']: r for r in W.jread(of, [])}
    for r in rows: cur[r['id']] = r
    if rows and any(r.get('recommended') for r in rows):
        for k in cur:
            if k not in {r['id'] for r in rows}: cur[k]['recommended'] = False
    return W.jwrite(of, sorted(cur.values(), key=lambda r: r['id']))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('cmd', choices=['list', 'fit', 'options']); ap.add_argument('--ws'); ap.add_argument('--json', action='store_true')
    ap.add_argument('--bed'); ap.add_argument('--duration', type=float); ap.add_argument('--out'); ap.add_argument('--start', type=float)
    ap.add_argument('--from-groove', action='store_true'); ap.add_argument('--script')
    ap.add_argument('--contrast', default='auto', help='the contrast bed (library id | file), default: licence-safe first, else the most different family')
    ap.add_argument('--beds', help='(legacy) main,contrast bed ids'); ap.add_argument('--recommend', default='auto', choices=['auto', 'grid', 'bpm'])
    ap.add_argument('--lang', help='the guide-VO demo language (default: the brief\'s first)'); ap.add_argument('--no-arrange', action='store_true')
    ap.add_argument('--no-demo', action='store_true'); ap.add_argument('--register', action='store_true')
    a = ap.parse_args()
    ws = W.ws_root(a.ws) if a.cmd != 'list' or a.ws else None
    if a.cmd == 'list':
        cs = cards(ws)
        if a.json: print(json.dumps([{k: v for k, v in c.items() if k not in ('analysis', 'key_detail')} for c in cs], ensure_ascii=False, indent=1)); return
        for c in cs: print(f"{c['id']:14s} {c.get('bpm', 0):6.1f} BPM  {c.get('key', '?'):9s} {c.get('durS', 0):6.1f}s  set {c.get('sfxSet')}  {c.get('model', '')}  | {c.get('title', '')}")
        return
    if a.cmd == 'fit':
        if not (a.bed and a.duration and a.out): raise SystemExit('fit needs --bed --duration --out')
        c = card(a.bed, ws); y, notes = fit(c, a.duration, a.start, a.from_groove)
        out = a.out if os.path.isabs(a.out) else W.P(ws, a.out); A.write(out, y)
        d = W.duration(out)
        if abs(d - a.duration) > 0.06: raise SystemExit(f'fit produced {d:.3f} s, wanted {a.duration}')
        print(json.dumps(dict(out=W.rel(ws, out), durS=round(d, 3), bed=c['id'], **notes))); return
    options(ws, a)


KINDS = {'A': ('grid', 'One-grid density'), 'B': ('per-scene', 'Per-scene BPM'), 'C': (None, 'Contrast bed')}


def options(ws, a):
    import arrange as AR, demo as DM
    sc = W.script_option(ws, a.script); fps = CK.fps_of(ws); langs = tuple(W.languages(ws))
    beds = [b for b in (a.beds or '').split(',') if b]
    main_c = card(a.bed or (beds[0] if beds else next((c['id'] for c in cards(ws) if c.get('default')), cards(ws)[0]['id'])), ws)
    cont = pick_contrast(main_c, cards(ws), a.contrast if a.contrast != 'auto' or len(beds) < 2 else beds[1])
    asked, why = tempo_asked(ws)
    rec = {'grid': 'A', 'bpm': 'B'}.get(a.recommend) or ('B' if asked else 'A')
    rec_why = f'--recommend {a.recommend}' if a.recommend in ('grid', 'bpm') else f"{why} -> {'per-scene BPM' if rec == 'B' else 'one-grid density'} (Q2)"
    lang = W.voice_lang(a.lang or W.languages(ws)[0]); rows = []
    for oid, c in (('A', main_c), ('B', main_c), ('C', cont)):
        kind = KINDS[oid][0] or KINDS[rec][0]
        an = c.get('analysis') or BD.load_analysis(c['_file']); bed_bpm = 60 / an['beat_s']
        wins, bm = option_clock(sc, bed_bpm, kind, fps, langs)
        total = wins[-1]['to']; safe = licence_safe(c)
        bed = dict(source='library', id=c['id'], bpm=round(bed_bpm, 2), bpmMap=bm, key=c.get('key'), shelf5k=bool(c.get('shelf_5k_minus4db')),
                   model=c.get('model'), licence=c.get('licence'), licenceSafe=safe)
        o = dict(id=oid, kind=('contrast:' + kind) if oid == 'C' else kind, title=f"{KINDS[oid][1]} · {c.get('title', c['id'])}", bed=bed, windows=wins,
                 clock=dict(fps=fps, total=total, frames=int(round(total * fps)), grid='ideal'), sfxSet=c.get('sfxSet', 'E'), demo=dict(music=None, guideVo=None),
                 recommended=(oid == rec), recommendedWhy=rec_why if oid == rec else None, recommendedFor=c.get('recommended_for'))
        of = W.P(ws, 'stages', 'music', 'options', f'{oid}.json')
        if a.no_arrange:
            y, notes = fit(c, total); f = W.P(ws, 'stages', 'music', 'beds', f'{oid}-{c["id"]}.flac'); A.write(f, y)
            fa = BD.load_analysis(f); o['windows'] = wins = CK.windows_on_grid(sc['scenes'], fa['beats'], fa.get('downbeat_phase', 0), fps, total=W.duration(f), langs=langs)
            for b, w in zip(bm, wins): b['from'], b['to'] = w['from'], w['to']
            bed['file'] = W.rel(ws, f); o['fit'] = notes; o['clock'].update(grid='bed', total=wins[-1]['to'], frames=int(round(wins[-1]['to'] * fps)))
        else:
            out = W.P(ws, 'stages', 'music', 'beds', f'{oid}-arranged.flac')
            rep = AR.arrange(ws, c['_file'], an, bm, out)
            for w_, s_ in zip(wins, rep['sections']):          # the arrangement lands every section on its window, to the frame
                if abs(s_['t0'] - w_['from']) * fps > 0.5 or abs(s_['t1'] - w_['to']) * fps > 0.5:
                    raise SystemExit(f"{oid} {w_['scene']}: arranged {s_['t0']}-{s_['t1']} != window {w_['from']}-{w_['to']}")
            bed.update(file=W.rel(ws, out), arranged=W.rel(ws, out), arrangement=W.rel(ws, out + '.json'))
            o['arrangeWarnings'] = rep['warnings']
            for w in rep['warnings']: W.log(f'{oid}: {w}')
        W.jwrite(of, o)
        if not a.no_demo: DM.make_demo(ws, of, lang, fps); o = W.jread(of)
        bpms = [b['bpm'] for b in bm]; feels = '/'.join(dict.fromkeys(b['feel'] for b in bm))
        tempo = (f"{bpms[0]:.0f} -> {max(bpms):.0f} -> {bpms[-1]:.0f} BPM per scene" if len(set(bpms)) > 1 else f"{bpms[0]:.1f} BPM one grid, feel {feels}")
        d = o.get('demo') or {}
        summ = ' · '.join(x for x in [('Recommended: ' + rec_why) if oid == rec else None, f"{c.get('title', c['id'])}", tempo, f"{c.get('key')}",
                                        f"{sum(w['bars'] for w in wins):g} bars = {total:.2f} s ({o['clock']['frames']} f)", f"SFX set {o['sfxSet']}",
                                        ('licence-safe' if safe else 'licence: Eleven Music (review drafts only until the plan is confirmed)')
                                        + ('' if oid != 'C' or safe else ' — no licence-safe bed in the library'),
                                        f"VO clearance {d['vo_clearance_lu_min']} LU" if d.get('vo_clearance_lu_min') is not None else None,
                                        f"{len(d.get('overruns') or [])} guide lines overrun" if d.get('overruns') else None,
                                        'MOCK library bed' if W.is_mock(ws) else None] if x)
        files = [W.rel(ws, of), bed['file']] + [x for x in (d.get('music'), d.get('guideVo')) if x]
        rows.append(dict(id=oid, title=o['title'], summary=summ, recommended=(oid == rec), files=files, preview=d.get('guideVo') or bed['file']))
        print(json.dumps(dict(option=oid, kind=o['kind'], bed=c['id'], total=total, frames=o['clock']['frames'],
                              bpmMap=[(b['scene'], b['bpm'], b['feel']) for b in bm], recommended=(oid == rec)), ensure_ascii=False))
    of = W.jwrite(W.P(ws, 'stages', 'music', 'options.json'), rows)
    W.register_options(ws, 'music', of, a.register)


if __name__ == '__main__':
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main()
