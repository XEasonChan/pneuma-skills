#!/usr/bin/env python3
"""Stage 8/9 · mix + master and remux onto the picture.

  scripts/py mix/mix.py [--ws DIR] [--lang ja|en|en-jasub] [--format short-16x9] [--kind roughcut|final] [--video <VO-only picture>]
                        [--music <bed>] [--sfx <layer>] [--shelf auto|on|off] [--vo-from-picture --delay-samples 2048]

VO: the picked lines laid on timeline.json (or the picture's own audio with --vo-from-picture: a VO-only master, where every added
layer rides the render's time base, +2048 samples by default), one linear gain to -14.3 LUFS.
Music: E1-style beds first get a -4 dB high shelf at 5 kHz (--shelf auto = the option's shelf5k); -26.8 LUFS pre-duck; ducked 9 dB
under every VO line (attack 0.25 s / release 0.5 s).
Typing margin: over every typing span and around every click the music gives way (a broadband dip + a deeper dip above 1.2 kHz)
until the key sounds sit >= 6 dB over the music in 1.5-6 kHz (checked per span, deepened up to 9 dB more when short).
SFX: the sfx/render.py layer as rendered (not ducked). Master: the true-peak limiter ONLY, -1.6 dBTP; if the AAC reads over -1.6 the
WAV is re-limited at -1.9 (then -2.2). NO whole-mix re-normalising (the gating artefact added ~3 dB), so integrated loudness reads
~ -15.5 LUFS. Output: out/<kind>/<format>-<lang>.{wav,m4a,mp4,json}; the MP4 is the picture stream-copied + this audio.
Verifies frames, audio length, LUFS / TP after AAC, VO clearance per line, music-in-gaps level, typing / click margins.
The WAV is deleted after the AAC is verified (disk); TL_KEEP_WAV=1 keeps it."""
import argparse, glob, json, os, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sfx'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ws as W, audio as A, vostem, timeline as TL
import render as SR_, remux as RX

SR = A.SR; VO_LUFS = -14.3; MUSIC_LUFS = -26.8; DUCK = 9.0; CEILS = (-1.6, -1.9, -2.2)


def key_spans(ws, lang):
    p = W.P(ws, 'stages', 'sound', f'soundmap-{lang}.json')
    if not os.path.exists(p): return []
    sm = W.jread(p); out = []
    for c in sm['plan']['sfx']:
        if c['role'] == 'typing': out.append((c['t'], c['t'] + c.get('dur', 1.5), 0.2, 0.5, 'typing'))
        elif c['role'] == 'click': out.append((c['t'], c['t'] + 0.1, 0.05, 0.3, 'click'))
    return out


def carve_gain(N, spans, kda, kdh):
    tt = np.arange(N) / SR; a_ = np.zeros(N); h_ = np.zeros(N)
    for (a, b, at, rl, _), extra in spans:
        i0, i1 = max(0, int((a - at - 0.01) * SR)), min(N, int((b + rl + 0.01) * SR)); t = tt[i0:i1]
        e = np.minimum(np.clip((t - (a - at)) / at, 0, 1), np.clip(1 - (t - b) / rl, 0, 1))
        a_[i0:i1] = np.maximum(a_[i0:i1], kda * e); h_[i0:i1] = np.maximum(h_[i0:i1], (kda + kdh + extra) * e)
    return a_, h_


def write_tracks(ws, fmt, lang, total, mpath, spath, delay=0, touch_lead=True):
    """the music + SFX lanes of the canvas timeline: timelines/<fmt>-<lang>.json (and timeline.json when it holds this version's clock),
    in the file's own units (frames at fps for the kit's renders)"""
    targets = [W.P(ws, 'timelines', f'{fmt}-{lang}.json')]
    tj = W.P(ws, 'timeline.json')
    if os.path.exists(tj) and touch_lead:
        t = W.jread(tj, {}); lead = t.get('lead')
        if lead == f'{fmt}-{lang}' or (not lead and (f'{fmt}-{lang}' in t.get('formats', {}) or fmt in t.get('formats', {}))): targets.append(tj)
    log = []
    if spath and os.path.exists(spath[:-5] + '.json'): log = W.jread(spath[:-5] + '.json', {}).get('log', [])
    for p in targets:
        if not os.path.exists(p): continue
        t = W.jread(p); fps = float(t.get('fps', 30)); frames = str(t.get('units', 'frames')).startswith('f')
        k = (lambda x: int(round((x + delay / SR) * fps))) if frames else (lambda x: round(x + delay / SR, 3))
        tr = t.setdefault('tracks', {})
        tr['bgm'] = [dict(**{'from': 0}, dur=k(total), file=W.rel(ws, mpath), label=os.path.basename(mpath).rsplit('.', 1)[0])] if mpath else []
        tr['sfx'] = [dict(t=k(c['t']), id=c.get('role'), group=c.get('group')) for c in log if c.get('t') is not None and 0 <= c['t'] < total]
        W.jwrite(p, t)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ws'); ap.add_argument('--lang'); ap.add_argument('--format'); ap.add_argument('--kind', default='roughcut', choices=['roughcut', 'final'])
    ap.add_argument('--video'); ap.add_argument('--music'); ap.add_argument('--sfx'); ap.add_argument('--shelf', default='auto', choices=['auto', 'on', 'off'])
    ap.add_argument('--vo-from-picture', action='store_true'); ap.add_argument('--delay-samples', type=int, default=0); ap.add_argument('--no-mp4', action='store_true')
    a = ap.parse_args(); ws = W.ws_root(a.ws); rp = lambda p: p if (p is None or os.path.isabs(p)) else os.path.join(ws, p); W.disk_guard(ws, 'the mix')
    fmts = [a.format] if a.format else (W.film(ws).get('run', {}).get('brief', {}).get('formats') or ['short-16x9'])
    langs = [a.lang] if a.lang else (W.film(ws).get('run', {}).get('brief', {}).get('languages') or ['ja', 'en'])
    o = SR_.music_option(ws); results = []
    for fmt in fmts:
        for lang in langs:
            vl = 'en' if lang.startswith('en') else lang
            # a subtitle variant (en-jasub) is the same VO under a DIFFERENT picture (its captions): never remux it onto the voice
            # language's picture (that shipped EN captions labelled en-jasub). The rough cut is the voiced languages only (SKILL.md).
            if lang != vl and not a.lang and a.kind == 'roughcut':
                W.log(f'{fmt}-{lang}: a subtitle variant, not part of the rough cut (finals render and mix it)'); continue
            own = W.P(ws, 'out', 'picture', f'{fmt}-{lang}.mp4')
            if lang != vl and not a.video and not os.path.exists(own):
                W.log(f'SKIP {fmt}-{lang}: render its picture first (node render.mjs {fmt}-{lang}); its captions differ from {fmt}-{vl}'); continue
            video = rp(a.video) or next((p for p in (own, W.P(ws, 'out', 'picture', f'{fmt}-{vl}.mp4')) if os.path.exists(p)), None)
            tl = TL.load(ws, fmt, vl) if os.path.exists(W.P(ws, 'timeline.json')) else None
            total = (RX.video_info(video)['dur'] if video else tl['total']); N = int(round(total * SR)); D = a.delay_samples
            # VO
            if a.vo_from_picture:
                if not video: raise SystemExit('--vo-from-picture needs the picture')
                vo = A.fit(A.load(video), N); vo = A.gain_to(vo, VO_LUFS); spans = [(v['start'] + D / SR, v['dur']) for v in (tl['vo'] if tl else [])]
            else:
                vo, sp, _, _, info = vostem.build(ws, vl, total, VO_LUFS); vo = A.fit(vo, N); spans = [(s, d) for s, d, _ in sp]
                if info['guide']: W.log(f"NOTE: guide VO (say) used for {info['guide']} - no picked take yet")
                if info['overruns']: W.log(f"WARNING VO longer than its scene: {info['overruns']}")
            shift = lambda y: np.pad(y, ((D, 0), (0, 0)))[:len(y)] if D else y
            # music
            mpath = rp(a.music) or SR_.bed_for(ws, o, vl)
            if mpath:
                m = A.fit(A.load(mpath), N); shelf = a.shelf == 'on' or (a.shelf == 'auto' and bool((o or {}).get('bed', {}).get('shelf5k')))
                if shelf: m = A.high_shelf(m)
                m = A.gain_to(m, MUSIC_LUFS)
            else: m = np.zeros((N, 2)); shelf = False; W.log('no music bed: VO + SFX only')
            m = shift(m)
            duck = A.duck_gain(N, spans, DUCK, 0.25, 0.5)
            spath = rp(a.sfx) or next(iter(sorted(glob.glob(W.P(ws, 'stages', 'sound', f"sfx-{(o or {}).get('sfxSet', '*')}-{vl}.flac")))), None)
            sfx = shift(A.fit(A.load(spath), N)) if spath else np.zeros((N, 2))
            # typing / click margin: carve the music, deepen per span until >= 6 dB (1.5-6 kHz)
            ks = [(k[0] + D / SR, k[1] + D / SR, *k[2:]) for k in key_spans(ws, vl)]
            kda, kdh = (3.0, 9.0) if shelf else (3.0, 3.0); extra = [0.0] * len(ks); margins = []
            hi_m = A.filt(m, 'high', 1200); lo_m = m - hi_m
            for it in range(4):
                ga, gh = carve_gain(N, list(zip(ks, extra)), kda, kdh)
                md = lo_m * np.minimum(duck, A.db(-ga))[:, None] + hi_m * np.minimum(duck, A.db(-gh))[:, None]
                keys = vo + sfx; margins = []
                for k_, (a0, b0, _, _, kind) in enumerate(ks):
                    mg = A.band_peak_db(keys, a0 - 0.02, b0 + 0.08) - A.band_peak_db(md, a0 - 0.02, b0 + 0.08)
                    margins.append(dict(what=kind, t=round(a0, 2), over_music_db=round(mg, 1), extra_dip_db=extra[k_]))
                    if mg < 6.0 and extra[k_] < 9.0: extra[k_] = min(9.0, extra[k_] + max(1.5, 6.0 - mg))
                if all(x['over_music_db'] >= 6.0 or x['extra_dip_db'] >= 9.0 for x in margins): break
            pre = vo + md + sfx
            outd = W.P(ws, 'out', a.kind); base = os.path.join(outd, f'{fmt}-{lang}'); os.makedirs(outd, exist_ok=True)
            for ceil in CEILS:
                y = A.limit_to_ceiling(pre, ceil); A.write(base + '.wav', y)
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', base + '.wav', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', base + '.m4a'], check=True)
                st = W.ebur128(base + '.m4a')
                if st['tp'] is None or st['tp'] <= -1.6 + 0.05: break
                W.log(f'AAC true peak {st["tp"]} dBTP > -1.6 with the WAV at {ceil}: re-limiting lower')
            gr = float(A.todb(np.abs(pre).max() / (np.abs(y).max() + 1e-12)))
            clr = []
            for s, d in spans:
                i, j = int(s * SR), int((s + d) * SR)
                if j - i > SR // 2: clr.append(dict(t=round(s, 2), vo_over_music_lu=round(A.lufs(vo[i:j]) - A.lufs(md[i:j]), 1)))
            gaps = np.ones(N, bool)
            for s, d in spans: gaps[int(max(0, s - 0.25) * SR):int((s + d + 0.5) * SR)] = False
            gap_lu = round(A.lufs(md[gaps]) - A.lufs(vo), 1) if gaps.sum() > SR and np.abs(md[gaps]).max() > 0 else None
            rec = dict(format=fmt, lang=lang, kind=a.kind, wav=W.rel(ws, base + '.wav'), m4a=W.rel(ws, base + '.m4a'), music=mpath and W.rel(ws, mpath), sfx=spath and W.rel(ws, spath),
                       shelf_5k=shelf, vo_lufs=round(A.lufs(vo), 2), music_pre_duck_lufs=MUSIC_LUFS, duck_db=DUCK, ceiling_dbtp=ceil, limiter_gr_db=round(gr, 2),
                       mix_lufs_wav=round(A.lufs(y), 2), tp_wav=round(A.true_peak_db(y), 2), aac=st, vo_clearance_min=min(clr, key=lambda x: x['vo_over_music_lu']) if clr else None,
                       music_in_gaps_lu_re_vo=gap_lu, key_margins=margins, key_margin_ok=(all(x['over_music_db'] >= 6.0 for x in margins) if margins else None), delay_samples=D, renormalised=False)
            if video and not a.no_mp4:
                rx = RX.remux(video, base + '.m4a', base + '.mp4'); rx['out'] = W.rel(ws, rx['out']); rec['mp4'] = rx
                if not rx['audio_matches']: raise SystemExit(f'audio length {rx["audio_s"]} != picture {rx["video_s"]}')
            if st['tp'] is not None and st['tp'] > -1.6 + 0.05: raise SystemExit(f'true peak after AAC {st["tp"]} dBTP > -1.6 even at -2.2 on the WAV')
            if os.environ.get('TL_KEEP_WAV') != '1': os.remove(base + '.wav'); rec['wav'] = None      # disk: keep the AAC (TL_KEEP_WAV=1 keeps the WAV)
            W.jwrite(base + '.json', rec); results.append(rec)
            # finals never touch the clock of a version the rough cut approved (its option lists timelines/<key>.json)
            if a.kind == 'roughcut' or not os.path.exists(W.P(ws, 'out', 'roughcut', f'{fmt}-{lang}.mp4')): write_tracks(ws, fmt, lang, total, mpath, spath, D, a.kind == 'roughcut')
            print(json.dumps(dict(out=rec.get('mp4', {}).get('out') or rec['m4a'], lufs=st['lufs'], tp=st['tp'], wav_ceiling=ceil, vo_clearance_min=rec['vo_clearance_min'],
                                  music_gaps_lu=gap_lu, keys_ok=rec['key_margin_ok'], frames=rec.get('mp4', {}).get('frames_out'))))
    return results


if __name__ == '__main__': main()
