#!/usr/bin/env python3
"""Stage 8 · render the SFX layer from the sound map: Set A "paper & key" or Set E "electronic", one event map for both.

  scripts/py sfx/render.py [--ws DIR] [--lang ja|en] [--set A|E] [--bed <music bed>] [--quantise auto|on|off] [--no-ui]

Voicing: every tonal cue is pitch-snapped to the bed's LOCAL harmony (chroma +-1.2 s around the cue, triads kept inside the bed's
key / scale); rhythmic cues are quantised to the bed's 16th grid within +-40 ms when the bed grooves (Set E default; --quantise on
forces it), the vernier detents + their lock-in to 32nds as a group (only when the spacing stays >= 55 ms).
Signature moments (common/kit.py): `rain` drops (the only water sound; a temple bloom on the first 4 s),
the ring spin + arrival, an entrance (full swell + bloom, dry 0.4 s fade, NO echo tail, ducked under words), the orb
breath, card turns, dimension confirms, the vernier ratchet with ONE detent per notch + a felt lock-in (no click), the send press +
breath, typing and clicks (ui samples from the seed library when present, else procedural; always audible), low soft panel slides,
the lockup chime.
Set A samples: when seed-library/sfx/set-a/ holds samples the run supplied (flip, dock, tap, tuck, lowhit) they replace the procedural
voice of those roles (the log's `note` says `sample set-a/<name>`); else procedural (the default: no samples ship).
Levels: each cue's 100 ms peak = its map level re the VO's loudness, then SFX -2.5 dB / whooshes (air) -4 dB; a word guard keeps a
cue's body <= the local VO - 10 dB. Set A adds soft 3 ms attacks and darkening; Set E darkens to 4.8 kHz.
The VO stem is only used as the level reference / word guard; output = the SFX layer alone: stages/sound/sfx-<set>-<lang>.flac
+ .json (every cue: time, quantise shift, note, gain, guard). No paid call."""
import argparse, glob, json, os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import ws as W, audio as A, beats as B, beds as BD, kit as KT, vostem

SR = A.SR


def music_option(ws):
    st = W.film(ws).get('stages', {}).get('music', {}); pick = st.get('pick')
    files = sorted(glob.glob(W.P(ws, 'stages', 'music', 'options', '*.json')))
    for f in files:
        if pick and os.path.basename(f)[:-5] == pick: return W.jread(f)
    oj = W.P(ws, 'stages', 'music', 'options.json')
    if os.path.exists(oj):
        rec = [o['id'] for o in W.jread(oj) if o.get('recommended')]
        for f in files:
            if os.path.basename(f)[:-5] in rec: return W.jread(f)
    return W.jread(files[0]) if files else None


def bed_for(ws, o, lang):
    if not o: return None
    b = o['bed']
    for k in ([f'arranged_{lang}', f'file_{lang}'] + ['arranged', 'file']):
        if b.get(k) and os.path.exists(os.path.join(ws, b[k])): return os.path.join(ws, b[k])
    return None


def word_duck(x, at, wsp, vm0, below_db=12.0, max_db=None):
    n = len(x); t = at + np.arange(n) / SR; act = np.zeros(n, bool)
    for a, b in wsp:
        if b > at and a < at + n / SR: act |= (t >= a - 0.03) & (t <= b + 0.05)
    if not act.any(): return x
    e = A.todb(np.sqrt(np.maximum(A.env100(x), 1e-14))); i0 = int(at * SR)
    vl = A.todb(vm0[np.clip(np.arange(i0, i0 + n), 0, len(vm0) - 1)])
    red = np.where(act, np.maximum(0, e - (vl - below_db)), 0)
    if max_db is not None: red = np.minimum(red, max_db)
    k = int(0.05 * SR); red = np.convolve(red, np.ones(k) / k, 'same')
    return x * A.db(-red)[:, None]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ws'); ap.add_argument('--lang'); ap.add_argument('--set', choices=['A', 'E']); ap.add_argument('--bed')
    ap.add_argument('--quantise', default='auto', choices=['auto', 'on', 'off']); ap.add_argument('--no-ui', action='store_true')
    a = ap.parse_args(); ws = W.ws_root(a.ws); lib = os.path.join(W.seed_library(), 'sfx'); W.disk_guard(ws, 'the SFX layer')
    o = music_option(ws)
    for lang in W.languages(ws, a.lang):
        sm = W.jread(W.P(ws, 'stages', 'sound', f'soundmap-{lang}.json')); total = sm['total']; N = int(round(total * SR))
        SET = a.set or (o or {}).get('sfxSet') or 'A'
        bedp = (a.bed if (a.bed and os.path.isabs(a.bed)) else (os.path.join(ws, a.bed) if a.bed else bed_for(ws, o, lang)))
        if bedp:
            raw = A.fit(A.load(bedp), N); an = BD.load_analysis(bedp); grid = np.array(an['beats']); P = float(an['beat_s']); key = an['key']
        else:
            W.log('no music bed: SFX voiced on A minor, no grid'); raw = np.zeros((N, 2)); grid = np.array([]); P = 0.55; key = B.key_of(np.roll(B.MIN, 9))
        B.SCALE = key['scale']
        quant = a.quantise == 'on' or (a.quantise == 'auto' and SET == 'E' and len(grid) > 8)
        g16, g32 = (B.subgrid(grid, 4), B.subgrid(grid, 8)) if len(grid) > 1 else (None, None)
        vo, spans, _, _, vinfo = vostem.build(ws, lang, total)
        vo_l = A.lufs(vo) if np.abs(vo).max() > 0 else -14.3
        kk = int(0.4 * SR); vm0 = np.sqrt(np.convolve((vo ** 2).mean(1), np.ones(kk) / kk, 'same')) + 1e-9
        wsp = [(w[1], w[2]) for v in sm['vo'] for w in v.get('words', []) if w[2] > w[1]] or [(s, s + d) for s, d, _ in spans]
        CL = [dict(c) for c in sm['plan']['sfx']]
        if quant and g16 is not None:
            for c in CL:
                if c.get('rhythmic') and c['role'] not in ('ratchet', 'lock'):
                    tq, dm = B.quantise(c['t'], g16, 0.040)
                    if dm is not None: c['t_pic'] = c['t']; c['t'] = round(tq, 3); c['quant_ms'] = dm
            for g_ in sorted({c['grp'] for c in CL if c.get('grp')}):
                gc = sorted([c for c in CL if c.get('grp') == g_], key=lambda x: x['t']); qs = [B.quantise(c['t'], g32, 0.040) for c in gc]; ts_ = [q[0] for q in qs]
                if all(y - x >= 0.055 for x, y in zip(ts_[:-1], ts_[1:])):
                    for c, (tq, dm) in zip(gc, qs):
                        if dm is not None: c['t_pic'] = c['t']; c['t'] = round(tq, 3); c['quant_ms'] = dm
            CL.sort(key=lambda x: x['t'])
        sfx = np.zeros((N, 2)); rain = np.zeros((N, 2)); gb = {}; log = []; rng = np.random.default_rng(5151)
        def put(x, at, grp, c, g, extra=None):
            A.place(sfx, x * A.db(g), at); A.place(gb.setdefault(grp, np.zeros((N, 2))), x * A.db(g), at)
            r = dict(t=c['t'], role=c['role'], group=grp, why=c.get('why'), gain_db=round(float(g), 1), target=c.get('lvl'))
            for k_ in ('t_pic', 'quant_ms', 'note', 'guard_db'):
                if c.get(k_) is not None: r[k_] = c[k_]
            if extra: r.update(extra)
            log.append(r)
        def guard(x, at, g):
            pk = A.peak100(x); e_ = 10 * np.log10(A.env100(x) + 1e-14); body = np.where(e_ >= pk - 12)[0]
            if not len(body): return g, None
            a0, a1 = at + body[0] / SR, at + body[-1] / SR; ov = [(wa, wb) for wa, wb in wsp if wa < a1 and wb > a0]
            if ov:
                loc = min(A.todb(vm0[max(0, int(wa * SR) - 4800):int(wb * SR) + 4800].max()) for wa, wb in ov)
                if pk + g > loc - 10: return loc - 10 - pk, round(loc - 10 - pk - g, 1)
            return g, None
        for c in CL:
            r = c['role']; t = c['t']
            if t >= total: continue
            pc = B.local_chroma(raw, t, 1.2)
            if r == 'typing':
                if a.no_ui: continue
                x = A.darken(KT.ui_typing(c.get('dur', 1.5), lib, int(t * 100)), 6000, -2); gt = c['lvl'] + vo_l - A.peak100(x)
                put(word_duck(x * A.db(gt), t, wsp, vm0, 6.0, 4.0), t, 'key', c, 0.0, dict(gain_db=round(gt, 1))); continue
            if r == 'typeacc':
                if SET != 'E' or g16 is None: continue
                acc = [q for q in g16 if t <= q < t + c.get('dur', 1.5)][::2]
                for j, q in enumerate(acc):
                    x = KT.e_click(1300, B.near_pc(B.chord_tones(pc), 700), 0.0025, seed=j); g = c['lvl'] + vo_l - A.peak100(x) + KT.SOFT_GAIN['key'] - (1.5 if j % 2 else 0)
                    put(x, q - 0.001, 'key', dict(c, t=round(q, 3), why=f'typing accent {j + 1}/{len(acc)} (a 16th)'), g)
                continue
            if r == 'click':
                if a.no_ui: continue
                x = KT.ui_click(lib, int(t * 100)); g = c['lvl'] + vo_l - A.peak100(x); put(x, t, 'key', c, g); continue
            if r == 'rain':
                f = B.near_pc(key['pent'], rng.uniform(360, 640)); x = A.filt(KT.lotus_drop(f, int(t * 1000)), 'low', 2600); p = rng.uniform(-0.5, 0.5)
                x = x * np.array([1 - max(0, p), 1 + min(0, p)]); g = c['lvl'] + vo_l - A.peak100(x) + KT.SOFT_GAIN['rain']
                A.place(rain, x * A.db(g), t - 0.002); log.append(dict(t=t, role='rain', group='rain', why=c.get('why'), gain_db=round(g, 1), hz=round(f, 1))); continue
            if r == 'entrance':
                pcl = B.local_chroma(raw, t + 0.9, 1.0); r0, q = B.triad(pcl)
                notes = [B.midi_hz(48 + r0), B.midi_hz(60 + (r0 + 7) % 12), B.midi_hz(72 + (r0 + q) % 12)]
                gfull = c['lvl'] + vo_l - A.peak100(KT.entrance(notes, dry=False)); x = KT.entrance(notes) * A.db(gfull)
                put(word_duck(x, t, wsp, vm0, 12.0), t, 'tone', dict(c, note=f"{B.NAMES[r0]} {'minor' if q == 3 else 'major'} triad, dry"), 0.0, dict(gain_db=round(gfull, 1))); continue
            if r == 'orbbreath':
                tonic = B.snap_f(B.hz('Bb2'), B.local_chroma(raw, t + 2.5, 2.5)); x = KT.orb_breath(t, c['t1'], c.get('cyc0', t), 4.0, tonic)
                g = c['lvl'] + vo_l - A.peak100(x) + KT.SOFT_GAIN['air'] + 6.0; x = word_duck(x * A.db(g), t, wsp, vm0, 12.0) * A.db(-g)
                put(x, t, 'air', dict(c, note=f'tonic {tonic:.1f} Hz'), g); continue
            x, note = KT.voice(r, c, SET, pc, P, lib); x = A.st(x)
            grp = c.get('group') or KT.GROUP.get(r, 'paper')
            if c.get('lp'): x = A.filt(x, 'low', c['lp'])
            if SET == 'A':
                if grp in ('paper', 'key') and r != 'lock': x = A.soften(x, 3.0)
                x = A.darken(x, 4200, -4.5) if grp == 'paper' else A.darken(x)
            elif grp not in ('air', 'low'): x = A.darken(x, 4800, -3.5)
            g = c['lvl'] + vo_l - A.peak100(x) + KT.SOFT_GAIN.get(grp, -2.5)
            at = t - 0.02 if grp in ('paper', 'key', 'tone') else t
            if c.get('align') == 'end': at = t - len(x) / SR + 0.02
            if c.get('align') == 'peak' or r == 'riser': at = t - int(np.argmax(np.sqrt(A.env100(x)))) / SR
            gd = None
            if r not in ('lowhit', 'arrival', 'bed', 'dusk'): g, gd = guard(x, at, g)
            put(x, at, grp, dict(c, note=note, guard_db=gd), g)
        rb = rain[:int(4 * SR)].copy(); rain[:int(4 * SR)] = rb + A.reverb(rb, 'temple', 0.45); gb['rain'] = rain; sfx = sfx + rain
        out = W.P(ws, 'stages', 'sound', f'sfx-{SET}-{lang}.flac'); A.write(out, sfx)
        if abs(W.duration(out) - total) > 0.05: raise SystemExit(f'{out}: length != film')
        se = np.sqrt(A.env100(sfx)); worst = []
        for wa, wb in wsp:
            i, j = int(wa * SR), int(wb * SR)
            if j > i: worst.append((round(wa, 2), round(float(A.todb(se[i:j].max()) - A.todb(vm0[max(0, i - 4800):j + 4800].max())), 1)))
        worst.sort(key=lambda x: -x[1])
        stats = {k: dict(lufs=round(A.lufs(v), 1) if np.abs(v).max() > 1e-6 else None) for k, v in gb.items()}
        rep = dict(set=SET, set_name={'A': 'paper & key', 'E': 'electronic'}[SET], lang=lang, out=W.rel(ws, out), bed=bedp and W.rel(ws, bedp), key=key['key'],
                   grid=dict(beats=int(len(grid)), bpm=round(60 / P, 2)) if len(grid) else None, quantised=quant, vo_lufs=round(vo_l, 2), n_cues=len(log),
                   sfx_lufs_re_vo=round(A.lufs(sfx) - vo_l, 1) if np.abs(sfx).max() > 0 else None, sfx_under_words_worst_db=worst[:5], groups=stats,
                   dropped_for_density=sm['plan'].get('dropped_for_density', []), guide_vo=vinfo['guide'], log=log)
        W.jwrite(out[:-5] + '.json', rep)
        print(json.dumps({k: v for k, v in rep.items() if k not in ('log', 'groups')}, ensure_ascii=False))


if __name__ == '__main__': main()
