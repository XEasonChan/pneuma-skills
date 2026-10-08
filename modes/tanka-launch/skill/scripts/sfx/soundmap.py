#!/usr/bin/env python3
"""Stage 8 · the sound map: the animation / rhythm / info-density model of the film -> stages/sound/soundmap-<lang>.json

  scripts/py sfx/soundmap.py [--ws DIR] [--lang ja|en] [--format short-16x9]

Inputs: timeline.json (scenes, VO spans, optional tracks.sfx the director placed) and remotion/scenes.json (scene types + props);
stages/vo/lines.json for word spans; the script option for each scene's density. Each kit scene type has a template of its
signature moments (below); a scene's props.events [{at, kind, label, n?, end?}] add or override them, and are the way a run's
custom scenes (remotion/src/custom/) declare theirs (kinds: typing, send, notch, lockup, ring-spin, card-flip, confirm, click, pop,
tap, notify, tick, dock, whoosh, slide, lowhit, found, fold, entrance, spin, assist, approve).
  logo-lockup   the logo lands: a low hit + a tone with a little echo
  text-screen   one micro-moment per line reveal (no SFX by default: type screens are carried by the VO and the bed)
  footage-card  the card docks, then folds away
Output: shots, sections, vo, events (discrete), continuous [{start,end,kind,intensity}], micro (selections / micro-moments),
density rows [t, n_events, animation, vo, info] per 0.25 s, and plan.sfx [{t, role, lvl (dB re VO), group, why, rhythmic}] with
the density rule (<= 3 cues per second; the lowest-priority cue is dropped and logged). No paid call."""
import argparse, json, os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import ws as W, timeline as TL, kit as KT

PRIO = {'entrance': 9, 'rain': 9, 'spin': 8, 'arrival': 8, 'lock': 8, 'chime': 9, 'lowhit': 7, 'click': 8, 'typing': 8, 'breath': 6, 'confirm': 7,
        'ratchet': 7, 'found': 7, 'notify': 6, 'assist': 6, 'approve': 5, 'allok': 7, 'dock': 5, 'flip': 4, 'tap': 4, 'post': 4, 'tuck': 3, 'tick': 3,
        'swipe': 3, 'whoosh': 3, 'push': 4, 'dusk': 6, 'tone': 5, 'orbbreath': 6, 'bed': 2, 'typeacc': 2, 'riser': 4}
LVL = dict(tone=-17, spin=-16, arrival=-14, lowhit=-10, push=-16, entrance=-12, flip=-24, tap=-20, tick=-21, confirm=-16, ratchet=-24, lock=-13, found=-15,
           notify=-15, dock=-18, tuck=-20, send=-19, swipe=-19, whoosh=-19, riser=-15, dusk=-16, chime=-12, breath=-19, click=-24, typing=-17, typeacc=-24,
           assist=-14, approve=-16, fix=-17, post=-18, allok=-11, rain=-30, orbbreath=-21, bed=-26)


def template(sc):
    """-> (events [(t_rel, role, kw)], continuous [(a_rel, b_rel, kind, kw)], micro [(t_rel, kind, label)])"""
    t, L, p = sc['type'], sc['len'], sc.get('props') or {}; ev, co, mi = [], [], []
    if t == 'logo-lockup':
        ev += [(0.1, 'lowhit', dict(lvl=-10, why='the logo lands')), (0.1, 'tone', dict(f=523, echo=True, lvl=-15, why='the logo: a tone with echo'))]
    elif t == 'text-screen':
        for k, ln in enumerate(p.get('lines', [])):
            mi.append((float(ln.get('at', 0.5 + k)), 'text-reveal', ln.get('text', f'line {k + 1}')))
        if p.get('transitionIn') == 'depth': ev.append((0.0, 'push', dict(align='end', why='the depth push into the type screen')))
    elif t == 'footage-card':
        ev += [(0.2, 'dock', dict(why='the footage card lands')), (max(0.3, L - 0.4), 'tuck', dict(why='the card folds away'))]
    return ev, co, mi


KIND = {'card-flip': 'flip', 'flip': 'flip', 'confirm': 'confirm', 'dimension-select': 'confirm', 'lockup': 'chime', 'click': 'click', 'send': 'click', 'pop': 'tap',
        'tap': 'tap', 'notify': 'notify', 'tick': 'tick', 'check': 'tick', 'dock': 'dock', 'whoosh': 'swipe', 'slide': 'swipe', 'panel-slide': 'swipe', 'lowhit': 'lowhit',
        'found': 'found', 'fold': 'tuck', 'tuck': 'tuck', 'entrance': 'entrance', 'spin': 'spin', 'ring-spin': 'spin', 'assist': 'assist', 'approve': 'approve'}


def explicit(e):
    k, at = e.get('kind'), float(e.get('at', 0)); lab = e.get('label', k); ev, co, mi = [], [], []
    if k == 'notch':
        n = int(e.get('n', 4)); g = f"n{at:.2f}"
        for i in range(n): ev.append((at + i * float(e.get('step', 0.1)), 'ratchet', dict(i=i, n=n, grp=g, rhythmic=True, why=f'{lab}: detent {i + 1}/{n}')))
        ev.append((at + n * float(e.get('step', 0.1)) + 0.2, 'lock', dict(grp=g, rhythmic=True, why=f'{lab}: lock-in')))
    elif k == 'typing': co.append((at, float(e.get('end', at + 1.5)), 'typing', dict(why=lab)))
    elif k == 'send': ev += [(at, 'click', dict(why=lab)), (at + 0.12, 'breath', dict(lvl=-19, why='send breath')), (at + 0.4, 'breath', dict(lvl=-17, why='reveal'))]
    elif k == 'lockup': ev += [(at, 'chime', dict(why=lab)), (at, 'lowhit', dict(lvl=-6, why=lab))]
    elif k == 'ring-spin': ev += [(at, 'spin', dict(dur=1.7, peak=0.5, why=lab)), (at + 1.03, 'arrival', dict(why='the ring settles'))]
    elif k in KIND: ev.append((at, KIND[k], dict(why=lab, **{kk: vv for kk, vv in e.items() if kk in ('idx', 'lvl', 'f', 'echo', 'rhythmic')})))
    else: mi.append((at, k, lab))
    if k in ('card-flip', 'dimension-select', 'confirm'): mi.append((at, k, lab))
    return ev, co, mi


def build(ws, lang, fmt=None):
    tl = TL.load(ws, fmt, lang) if os.path.exists(os.path.join(ws, 'timeline.json')) else None
    sj = TL.scenes(ws)
    if tl is None and sj is None: raise SystemExit('need timeline.json or remotion/scenes.json')
    total = tl['total'] if tl else max(s['end'] for s in sj['scenes'])
    types = {s['id']: s for s in (sj['scenes'] if sj else [])}
    shots = []
    for s in (tl['scenes'] if tl else sj['scenes']):
        st = types.get(s['id'], {})
        shots.append(dict(id=s['id'], start=s['start'], end=s['end'], len=s['end'] - s['start'], type=st.get('type') or s.get('type'), props=st.get('props') or {}))
    try: dens = {s['id']: s.get('density') or {} for s in W.script_option(ws).get('scenes', [])}
    except SystemExit: dens = {}
    lines = {l['id']: l for l in W.jread(os.path.join(ws, 'stages', 'vo', 'lines.json'), []) if l['lang'] == lang}
    vo = []
    if tl and tl['vo']:
        for v in tl['vo']:
            ln = lines.get(v['id'], {}); vo.append(dict(id=v['id'], start=v['start'], end=v['start'] + (v['dur'] or ln.get('durS', 0)), text=ln.get('text'),
                                                        words=[[w['text'], round(v['start'] + w['start'], 3), round(v['start'] + w['end'], 3)] for w in ln.get('words', [])]))
    else:
        for s in shots:
            ln = lines.get(s['id'])
            if ln: a = s['start'] + 0.3; vo.append(dict(id=ln['id'], start=a, end=a + ln['durS'], text=ln['text'], words=[[w['text'], round(a + w['start'], 3), round(a + w['end'], 3)] for w in ln['words']]))
    events, cont, micro, plan = [], [], [], []
    for s in shots:
        e1, c1, m1 = template(dict(type=s['type'], len=s['len'], props=s['props']))
        for e in (s['props'].get('events') or []):
            e2, c2, m2 = explicit(e); e1 += e2; c1 += c2; m1 += m2
        for t, role, kw in e1:
            ta = round(s['start'] + t, 3)
            if not (0 <= ta < total): continue
            events.append(dict(t=ta, kind=role, label=kw.get('why', role), shot=s['id']))
            plan.append(dict(t=ta, role=role, lvl=kw.pop('lvl', LVL.get(role, -20)), group=KT.GROUP.get(role, 'paper'), why=kw.pop('why', role), shot=s['id'], **kw))
        for a, b, kind, kw in c1:
            aa, bb = round(s['start'] + a, 3), round(min(total, s['start'] + b), 3)
            cont.append(dict(start=aa, end=bb, kind=kind, label=kw.get('why', kind), shot=s['id']))
            if kind == 'typing': plan += [dict(t=aa, role='typing', lvl=LVL['typing'], group='key', why=kw.get('why', 'typing'), dur=round(bb - aa, 3), shot=s['id']),
                                          dict(t=aa, role='typeacc', lvl=LVL['typeacc'], group='key', why='typing accents on the grid (Set E)', dur=round(bb - aa, 3), shot=s['id'])]
            if kind == 'orb-breath': plan.append(dict(t=aa, role='orbbreath', lvl=LVL['orbbreath'], group='air', why=kw.get('why'), t1=bb, cyc0=round(s['start'] + kw.get('cyc0', 0), 3), shot=s['id']))
            if kind == 'orbit': plan.append(dict(t=aa, role='bed', lvl=LVL['bed'], group='air', why=kw.get('why'), dur=round(bb - aa, 3), shot=s['id']))
        for t, kind, lab in m1: micro.append(dict(t=round(s['start'] + t, 3), kind=kind, label=lab, shot=s['id']))
    for x in (tl['sfx'] if tl else []):
        plan.append(dict(t=round(x['t'], 3), role=x.get('id', 'tap'), lvl=LVL.get(x.get('id'), -20), group=x.get('group') or KT.GROUP.get(x.get('id'), 'paper'), why='timeline.json tracks.sfx'))
    plan.sort(key=lambda c: c['t']); events.sort(key=lambda e: e['t']); micro.sort(key=lambda e: e['t'])
    # density rule: <= 3 discrete cues in any 1 s (rain drops, ratchet detents and typing are textures, exempt)
    exempt = {'rain', 'ratchet', 'typing', 'typeacc', 'orbbreath', 'bed', 'lock'}; dropped = []
    while True:
        disc = [c for c in plan if c['role'] not in exempt]; worst = None
        for c in disc:
            win = [d for d in disc if c['t'] <= d['t'] < c['t'] + 1.0]
            if len(win) > 3: worst = min(win, key=lambda d: (PRIO.get(d['role'], 3), -d['t'])); break
        if not worst: break
        plan.remove(worst); dropped.append(dict(t=worst['t'], role=worst['role'], why=worst['why']))
    bins = np.arange(0, total, 0.25); lv = {'low': 0.2, 'mid': 0.55, 'high': 0.9}; rows = []
    for b in bins:
        ne = sum(1 for e in events if b <= e['t'] < b + 0.25); an = sum(1 for c in cont if c['start'] <= b < c['end'])
        v = int(any(x['start'] <= b < x['end'] for x in vo)); sh = next((s for s in shots if s['start'] <= b < s['end']), None)
        info = lv.get(str((dens.get(sh['id']) or {}).get('info', 'mid')), 0.55) if sh else 0
        rows.append([round(float(b), 2), ne, an, v, info])
    gaps = []; t0 = 0.0
    for x in sorted(vo, key=lambda x: x['start']):
        if x['start'] - t0 >= 1.0: gaps.append([round(t0, 2), round(x['start'], 2)])
        t0 = max(t0, x['end'])
    if total - t0 >= 1.0: gaps.append([round(t0, 2), round(total, 2)])
    return dict(lang=lang, total=round(total, 3), fps=(tl or sj)['fps'], shots=[{k: v for k, v in s.items() if k != 'props'} for s in shots],
                sections=[dict(name=s['id'], start=s['start'], end=s['end']) for s in shots], vo=vo, events=events, continuous=cont, micro=micro,
                density=dict(columns=['t', 'n_events', 'animation', 'vo', 'info'], bin_s=0.25, rows=rows),
                plan=dict(sfx=plan, dropped_for_density=dropped, bgm_windows=gaps, rules=['<= 3 discrete cues per second', 'SFX low-mid, rounded; whooshes dark',
                          'typing and clicks always audible (mix keeps >= 6 dB over the music in 1.5-6 kHz)', 'rain drops are the only water-like sound']),
                timbre_groups=['rain', 'paper', 'key', 'air', 'tone', 'low'])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ws'); ap.add_argument('--lang'); ap.add_argument('--format')
    a = ap.parse_args(); ws = W.ws_root(a.ws)
    for lang in W.languages(ws, a.lang):
        m = build(ws, lang, a.format); p = W.jwrite(W.P(ws, 'stages', 'sound', f'soundmap-{lang}.json'), m)
        print(json.dumps(dict(file=W.rel(ws, p), total=m['total'], shots=len(m['shots']), events=len(m['events']), continuous=len(m['continuous']), micro=len(m['micro']),
                              cues=len(m['plan']['sfx']), dropped=len(m['plan']['dropped_for_density']), vo=len(m['vo']))))


if __name__ == '__main__': main()
