#!/usr/bin/env python3
"""QC for renders and mixes -> out/qc/*.json + *.jpg

  scripts/py qc/qc.py check   [--ws DIR] [--kind roughcut|final] [--files a.mp4,b.mp4]      frames vs the comp, audio length, LUFS/TP after AAC, audio md5
  scripts/py qc/qc.py seams   [--ws DIR] --audio <bed|mix> [--at 9.0,12.3] [--from arrange.json|extend.json|warp.json] [--beat 0.588]
  scripts/py qc/qc.py sheets  [--ws DIR] --video out/roughcut/short-16x9-ja.mp4 [--step 1] [--cols 6] [--boundaries auto|t1,t2] [--fps10-window 0.5]
  scripts/py qc/qc.py footage [--ws DIR] --clip assets/footage/X.mp4                           contact sheet + the footage defect checklist
  scripts/py qc/qc.py all     [--ws DIR] [--kind roughcut]                                     check + sheets + storyboard for every MP4 of that kind
  scripts/py qc/qc.py lint    [--ws DIR] [--script]                                            the text lint alone (qc/lint.py) -> out/qc/lint.json

Per version (files named by the naming rule, <format>-<lang>.mp4) it also writes the canvas QC record out/qc/<kind>-<key>.json
({format, lang, file, durationS, frames, lufs, truePeak, pass, checks[], storyboard[]}): the measured checks, the mix's VO clearance and
typing margin, plus every row of out/qc/<kind>-review.json whose `version` is that key (or "all"). Write the review rows FIRST, then run
this: the rough-cut approval hashes out/qc/roughcut*. The expected size is the comp x the render scale (out/picture/<key>.json).
Every record also carries the text lint rows (qc/lint.py: lint-names, lint-brand-caps, lint-integrations, lint-leftovers on
remotion/scenes.json + stages/vo/lines.json; a failure fails the record's `pass`, not the measured `ok`) and, once a music option is
picked, a music-clock row: the version's scene frames == the music clock's (common/clock.py), to the frame.

check: frame count == timeline.json formats.<fmt>.frames (the comp); audio duration rounds to the same frame count (+- half a
frame); integrated LUFS and true peak read from the AAC (ffmpeg ebur128; TP must be <= -1.6 dBTP); the audio stream's md5 (to prove
"audio unchanged" when only picture changed). Seam proxies at every music join: spectral-flux z-score vs 40 reference points,
the 20 ms RMS step vs the bed's p90 step, the onset grid (IOIs) across the join vs the beat. Sheets: 1 s contact sheet + a 10 fps
sheet around every scene boundary (+-0.5 s), labelled with time / frame / scene (a built-in bitmap font: no PIL needed).
Footage checklist (Seedance yield was ~1 in 3): screen facing the camera while someone types on it, clay / CG look on humans,
wrong scale, extra people, continuity, text legibility — a sheet + a checklist JSON for a human / vision pass. No paid call."""
import argparse, glob, json, os, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import ws as W, audio as A, beats as B, timeline as TL, font5x7 as F, clock as CK
import lint as LN

SR = A.SR
FOOTAGE_CHECKS = ['device screen faces the camera while someone types on it (reversed screen)', 'clay / 3D / CG look on a human (must be live-action)',
                  'wrong scale (the assistant figure vs people / props)', 'extra or duplicated people', 'continuity with the neighbouring shots (clothes, props, light)',
                  'readable text / logos that should be unreadable', 'hands / faces deformed', 'camera cuts inside the clip (should be one take)']


def audio_md5(p):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', p, '-map', '0:a:0', '-f', 'md5', '-'], capture_output=True, text=True)
    return r.stdout.strip().replace('MD5=', '') or None


def _tl_for(ws, name):
    """(version dict, timeline) for an MP4 named by the naming rule; (None, None) when the name isn't a version"""
    v = W.parse_version(name)
    if not v: return None, None
    try: return v, TL.load(ws, v['format'], W.voice_lang(v['lang']) if not os.path.exists(W.P(ws, 'timelines', v['key'] + '.json')) else v['lang'])
    except SystemExit: return v, None


def check(ws, files):
    out = []
    for p in files:
        v, tl = _tl_for(ws, p)
        want = tl['frames'] if tl else None
        meta = W.picture_meta(ws, v['key']) if v else {}
        scale = meta.get('scale') or (tl or {}).get('scale') or (v or {}).get('scale') or 1
        pr = W.ffprobe(p); vs = [s for s in pr['streams'] if s['codec_type'] == 'video']; a = [s for s in pr['streams'] if s['codec_type'] == 'audio']
        num, den = (vs[0].get('r_frame_rate', '30/1') if vs else '30/1').split('/'); fps = float(num) / float(den)
        frames = W.count_frames(p) if vs else None; ad = float(a[0].get('duration') or 0) if a else 0.0; st = W.ebur128(p) if a else {}
        rec = dict(file=W.rel(ws, p), version=v and v['key'], format=v and v['format'], lang=v and v['lang'], fps=fps, frames=frames, comp_frames=want,
                   frames_ok=(want is None or frames == want),
                   width=vs[0].get('width') if vs else None, height=vs[0].get('height') if vs else None, scale=scale, audio_s=round(ad, 4),
                   audio_frames=round(ad * fps, 2), audio_ok=bool(a) and frames is not None and abs(ad * fps - frames) <= 0.5 + 0.03 * fps,
                   lufs=st.get('lufs'), tp=st.get('tp'), lra=st.get('lra'), tp_ok=st.get('tp') is not None and st['tp'] <= -1.6 + 0.05, audio_md5=audio_md5(p) if a else None)
        if tl and tl.get('width') and rec['width']:
            ew, eh = round(tl['width'] * scale), round(tl['height'] * scale)
            rec['size_ok'] = abs(rec['width'] - ew) <= 2 and abs(rec['height'] - eh) <= 2; rec['expected_size'] = [ew, eh]
        if v and meta.get('file') and os.path.exists(W.P(ws, meta['file'])):
            rec['picture'] = meta['file']; rec['picture_frames_match'] = meta.get('frames') == frames
        rec['ok'] = all(rec.get(k, True) for k in ('frames_ok', 'audio_ok', 'tp_ok', 'size_ok'))
        out.append(rec)
        print(f"{'OK ' if rec['ok'] else 'BAD'} {rec['file']}: {frames} f (comp {want}) {rec['width']}x{rec['height']} (x{scale:g}) audio {ad:.3f}s LUFS {rec['lufs']} TP {rec['tp']}")
    return out


def storyboard(ws, video, key, tl):
    """one still per scene (its midpoint) -> out/qc/storyboard/<key>/<scene>.jpg (the canvas's storyboard strip)"""
    if not tl or not tl.get('scenes'): return []
    d = W.duration(video); rows = []
    for sc in tl['scenes']:
        t = min(max(0.0, (sc['start'] + sc['end']) / 2), max(0.0, d - 0.05))
        o = W.P(ws, 'out', 'qc', 'storyboard', key, f"{sc['id']}.jpg"); W.mkdirs(o)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{t:.3f}', '-i', video, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', o], check=True)
        rows.append(dict(sceneId=sc['id'], t=round(t, 3), file=W.rel(ws, o)))
    return rows


def clock_row(ws, tl):
    """the music-locked clock vs the version's rendered scenes (None before a music pick / clock.json)"""
    try: clk = CK.resolve(ws)
    except SystemExit: return None
    if clk['source'] == 'script' or not tl: return None
    fps = tl.get('fps') or clk['fps']
    diff = CK.compare_frames(clk, [(s['id'], int(round(s['len'] * fps))) for s in tl['scenes']])
    missing = [s['id'] for s in clk['scenes'] if s['id'] not in {x['id'] for x in tl['scenes']}]
    note = f"{clk['source']} {clk['frames']} f vs {tl.get('frames')} f" + (f" · differ: {', '.join(f'{i} {a}->{b} f' for i, a, b in diff[:6])}" if diff else '') + (f" · missing: {', '.join(missing)}" if missing else '')
    return dict(id='music-clock', status='fail' if (diff or missing) else 'pass', label='Scene frames = the music clock (music-locked)', note=note)


def readcheck_row(ws, lang=None):
    """the VO read check (vo/readcheck.py) for a version's language: pass when every picked take read OK; "unchecked" with a clear
    "read check unavailable" note when whisper / its model was missing (hosted: the model download failed) — never a silent pass"""
    p = W.P(ws, 'stages', 'vo', 'readcheck.json')
    if not os.path.exists(p): return None
    rc = W.jread(p, {}); vl = (lang or '').split('-')[0]
    takes = [t for t in rc.get('takes', []) if not vl or t.get('lang') == vl]
    if not takes: return None
    lp = W.P(ws, 'stages', 'vo', 'lines.json'); lines = W.jread(lp, []) if os.path.exists(lp) else []
    picked = {(l.get('id'), l.get('lang'), l.get('take')) for l in lines if isinstance(l, dict)}
    rows = [t for t in takes if (t.get('id'), t.get('lang'), t.get('take')) in picked] or takes
    label = 'VO read check (local whisper.cpp)'
    if rc.get('available') is False or all(t.get('ok') is None for t in rows):
        why = rc.get('unavailable') or 'no local whisper'
        return dict(id='vo-readcheck', status='unchecked', label=label, note=f'read check unavailable: {why} · listen to every line before approving')
    bad = [t for t in rows if t.get('ok') is False]; unk = [t for t in rows if t.get('ok') is None]
    note = f"{len(rows) - len(bad) - len(unk)} / {len(rows)} picked takes read OK" + \
        (' · failed: ' + ', '.join('%s t%s' % (t.get('id'), t.get('take')) for t in bad[:6]) if bad else '') + (f" · unchecked: {len(unk)}" if unk else '')
    return dict(id='vo-readcheck', status='pass' if not (bad or unk) else 'unchecked', label=label, note=note)


def version_record(ws, kind, rec, review_rows, board=None, extra=()):
    """the canvas QC record out/qc/<kind>-<key>.json (_viewer-contract §4): measured checks + the director's review rows"""
    key = rec['version']; mixp = W.P(ws, 'out', kind, f'{key}.json'); mix = W.jread(mixp, {}) if os.path.exists(mixp) else {}
    st = lambda ok: 'pass' if ok else 'fail'
    checks = [dict(id='frames', status=st(rec['frames_ok']), label='Frame count = the composition', note=f"{rec['frames']} / {rec['comp_frames']}"),
              dict(id='audio-length', status=st(rec['audio_ok']), label='Audio length = the picture', note=f"{rec['audio_s']} s"),
              dict(id='true-peak', status=st(rec['tp_ok']), label='True peak <= -1.6 dBTP after AAC', note=f"{rec['tp']} dBTP · {rec['lufs']} LUFS")]
    if 'size_ok' in rec: checks.append(dict(id='size', status=st(rec['size_ok']), label='Frame size = comp x render scale', note=f"{rec['width']}x{rec['height']} (x{rec['scale']:g})"))
    if mix.get('vo_clearance_min'):
        c = mix['vo_clearance_min']; checks.append(dict(id='vo-clearance', status=st(c['vo_over_music_lu'] >= 8), label='VO over music (worst line)', note=f"{c['vo_over_music_lu']} LU at {c['t']} s"))
    if 'key_margins' in mix and not mix.get('key_margins'):
        checks.append(dict(id='typing-margin', status='unchecked', label='Typing / clicks >= 6 dB over the music (1.5-6 kHz)', note='no typing / click spans in the sound map: nothing measured'))
    if mix.get('key_margins'):
        checks.append(dict(id='typing-margin', status=st(mix.get('key_margin_ok')), label='Typing / clicks >= 6 dB over the music (1.5-6 kHz)', note=f"{len(mix['key_margins'])} spans"))
    checks += [dict(c) for c in extra if c]
    for r in review_rows:
        if r.get('version') not in (None, '', 'all', '*', key) and r.get('version') != rec['format'] and r.get('version') != rec['lang']: continue
        res = r.get('result'); checks.append(dict(id=str(r.get('check', 'review')), status='pass' if res == 'pass' else 'fail' if res == 'fail' else 'unchecked',
                                                  label=str(r.get('check', 'review')), note=' · '.join(str(x) for x in (r.get('numbers'), r.get('note')) if x)))
    doc = dict(format=rec['format'], lang=rec['lang'], file=rec['file'], durationS=round(rec['audio_s'] or (rec['frames'] or 0) / rec['fps'], 3), frames=rec['frames'],
               lufs=rec['lufs'], truePeak=rec['tp'], pass_=None, checks=checks, mock=W.is_mock(ws), sheets=rec.get('sheets', []), picture=rec.get('picture'))
    doc['pass'] = all(c['status'] != 'fail' for c in checks); doc.pop('pass_')
    if board: doc['storyboard'] = board
    return W.jwrite(W.P(ws, 'out', 'qc', f'{kind}-{key}.json'), doc)


def seams(ws, audio, at, P=None, deliberate=()):
    y = B.mono(A.load(audio)); hop = 240; nfft = 1024
    import scipy.signal as ss
    f, t, Z = ss.stft(y, SR, nperseg=nfft, noverlap=nfft - hop); S = np.log1p(np.abs(Z))
    flux = np.r_[0, np.maximum(0, np.diff(S, axis=1)).sum(0)]; fr = lambda tt: int(np.clip(tt * SR / hop, 3, len(flux) - 4))
    k = 960; rms = np.sqrt(np.convolve(y ** 2, np.ones(k) / k, 'same')); rdb = A.todb(rms)
    step = lambda tt: abs(rdb[int(tt * SR) + 240:int(tt * SR) + 720].mean() - rdb[max(0, int(tt * SR) - 720):int(tt * SR) - 240].mean())
    tot = len(y) / SR; rng = np.random.default_rng(1); refs = rng.uniform(1, max(1.5, tot - 1), 40)
    rf = np.array([flux[fr(r) - 2:fr(r) + 3].max() for r in refs]); rs = np.array([step(r) for r in refs])
    ot, of = B.onset_env(y); thr = np.percentile(of, 92); on = ot[1:-1][(of[1:-1] > thr) & (of[1:-1] >= of[:-2]) & (of[1:-1] >= of[2:])]
    rows = []
    for tt in at:
        if not (0.2 < tt < tot - 0.2): continue
        fz = (flux[fr(tt) - 2:fr(tt) + 3].max() - rf.mean()) / (rf.std() + 1e-9); o = on[(on > tt - 1.6) & (on < tt + 1.6)]; ioi = np.diff(o)
        grid_dev = None
        if P and len(ioi): q = P / 4; grid_dev = round(float(np.median(np.abs(ioi / q - np.round(ioi / q)) * q * 1000)), 1)   # vs the 16th grid
        rec = dict(t=round(tt, 3), flux_z=round(float(fz), 2), rms_step_db=round(float(step(tt)), 2), ref_step_db_p90=round(float(np.percentile(rs, 90)), 2),
                   ioi=[round(float(x), 3) for x in ioi], grid_dev_ms=grid_dev)
        rec['deliberate'] = any(abs(tt - d) < 0.05 for d in deliberate)          # an arranged stop / drop / fill: a level change is the point
        rec['flag'] = bool(rec['flux_z'] > 3.0 or (not rec['deliberate'] and (rec['rms_step_db'] > max(3.0, 1.5 * rec['ref_step_db_p90']) or (grid_dev is not None and grid_dev > 20))))
        rows.append(rec)
        print(f"{'!!' if rec['flag'] else 'ok'} seam {tt:7.3f}  flux z {rec['flux_z']:+.2f}  rms step {rec['rms_step_db']:.2f} dB (p90 {rec['ref_step_db_p90']:.2f})  grid dev {grid_dev} ms")
    return rows


def frames_at(video, times, width):
    out = []
    for tt in times:
        r = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{max(0, tt):.3f}', '-i', video, '-frames:v', '1', '-vf', f'scale={width}:-2', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                           capture_output=True)
        out.append(r.stdout)
    h = None
    for b in out:
        if b: h = len(b) // (width * 3); break
    h = h or int(width * 9 / 16)
    return [np.frombuffer(b, np.uint8).reshape(h, width, 3).copy() if len(b) == h * width * 3 else np.zeros((h, width, 3), np.uint8) for b in out], h


def sheet(video, times, labels, out, cols=6, width=320, title=''):
    imgs, h = frames_at(video, times, width); rows = (len(imgs) + cols - 1) // cols; lab = 20; pad = 2; th = 22
    canvas = np.zeros((th + rows * (h + lab + pad), cols * (width + pad), 3), np.uint8)
    F.draw(canvas, 4, 3, title[:int(cols * (width + pad) / 12)], 2)
    for i, (im, lb) in enumerate(zip(imgs, labels)):
        r, c = divmod(i, cols); y0 = th + r * (h + lab + pad); x0 = c * (width + pad)
        F.draw(canvas, x0 + 2, y0 + 1, lb[:width // 12], 2); canvas[y0 + lab:y0 + lab + h, x0:x0 + width] = im
    H, Wd = canvas.shape[:2]; os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{Wd}x{H}', '-i', '-', '-q:v', '3', out], input=canvas.tobytes(), check=True)
    return out


def sheets(ws, video, step=1.0, cols=6, boundaries='auto', win=0.5):
    d = W.duration(video); name = os.path.basename(video)[:-4]; outs = []
    kind_dir = os.path.basename(os.path.dirname(os.path.abspath(video)))
    if kind_dir in ('picture', 'roughcut', 'final'): name = f'{kind_dir}-{name}'      # picture / rough-cut / final sheets never overwrite each other
    _, tl = _tl_for(ws, video); scs = tl['scenes'] if tl else []
    scene_at = lambda t: next((f"{s['id']} +{max(0.0, t - s['start']):.1f}" for s in scs if s['start'] - 1e-6 <= t < s['end'] - 1e-6), '')
    ts = list(np.arange(0, d - 0.05, step)); fps = 30.0
    p1 = W.P(ws, 'out', 'qc', f'{name}-sheet-{step:g}s.jpg')
    sheet(video, ts, [f'{t:.1f}S F{int(round(t * fps))} {scene_at(t)}' for t in ts], p1, cols, 320, f'{name} · every {step:g} s'); outs.append(W.rel(ws, p1))
    bs = [s['start'] for s in scs[1:]] if boundaries == 'auto' else [float(x) for x in boundaries.split(',') if x]
    for b in bs:
        tb = list(np.arange(max(0, b - win), min(d - 0.03, b + win), 0.1))
        p = W.P(ws, 'out', 'qc', f'{name}-boundary-{b:07.3f}.jpg')
        sheet(video, tb, [f'{t:.2f}S F{int(round(t * fps))} {scene_at(t)}' for t in tb], p, 5, 256, f'{name} · 10 fps around {b:.2f} s'); outs.append(W.rel(ws, p))
    return outs


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('cmd', choices=['check', 'seams', 'sheets', 'footage', 'all', 'lint']); ap.add_argument('--script', action='store_true'); ap.add_argument('--ws'); ap.add_argument('--kind', default='roughcut')
    ap.add_argument('--files'); ap.add_argument('--audio'); ap.add_argument('--at'); ap.add_argument('--from', dest='frm'); ap.add_argument('--beat', type=float)
    ap.add_argument('--video'); ap.add_argument('--step', type=float, default=1.0); ap.add_argument('--cols', type=int, default=6); ap.add_argument('--boundaries', default='auto')
    ap.add_argument('--fps10-window', type=float, default=0.5); ap.add_argument('--clip')
    a = ap.parse_args(); ws = W.ws_root(a.ws); rp = lambda p: p if os.path.isabs(p) else os.path.join(ws, p); W.disk_guard(ws, 'QC sheets')
    if a.cmd in ('check', 'all'):
        files = [rp(f) for f in a.files.split(',')] if a.files else sorted(glob.glob(W.P(ws, 'out', a.kind, '*.mp4')))
        if not files: raise SystemExit(f'no MP4s in out/{a.kind}/')
        res = check(ws, files); rep = dict(kind=a.kind, files=res, ok=all(r['ok'] for r in res))
        rv = W.P(ws, 'out', 'qc', f'{a.kind}-review.json'); review = (W.jread(rv, {}) or {}).get('rows', []) if os.path.exists(rv) else []
        recs = []; lint_rows = LN.run(ws)['rows']
        for r in res:
            board = None
            if a.cmd == 'all':
                r['sheets'] = sheets(ws, rp(r['file']), a.step, a.cols, a.boundaries, a.fps10_window)
                if r['version']: board = storyboard(ws, rp(r['file']), r['version'], _tl_for(ws, r['file'])[1])
            if r['version']: recs.append(W.rel(ws, version_record(ws, a.kind, r, review, board, lint_rows + [clock_row(ws, _tl_for(ws, r['file'])[1]), readcheck_row(ws, r.get('lang'))])))
        rep['records'] = recs; rep['review'] = W.rel(ws, rv) if review else None; rep['lint'] = lint_rows
        # `ok` = the measured checks; `pass` = every per-version record (review rows included) has no fail — what the canvas shows
        rep['pass'] = all(W.jread(W.P(ws, r)).get('pass') for r in recs) if recs else rep['ok']
        p = W.jwrite(W.P(ws, 'out', 'qc', f'{a.kind}-check.json'), rep); print(json.dumps(dict(report=W.rel(ws, p), records=recs, ok=rep['ok'], records_pass=rep['pass'])))
        if not rep['ok']: sys.exit(1)
    elif a.cmd == 'lint':
        rep = LN.run(ws, script=a.script)
        for r in rep['rows']: print(f"{'ok ' if r['status'] == 'pass' else 'BAD'} {r['id']:18s} {r['note']}")
        print(json.dumps(dict(report='out/qc/lint.json', ok=rep['pass'])))
        if not rep['pass']: sys.exit(1)
    elif a.cmd == 'seams':
        if not a.audio: raise SystemExit('seams needs --audio')
        at = [float(x) for x in a.at.split(',')] if a.at else []; P = a.beat; j = {}
        if a.frm:
            j = W.jread(rp(a.frm))
            at += j.get('joins', []) + j.get('splice_t', []) + [x for s in j.get('seams', []) for x in s.get('junctions_new_s', [])] + [s['en'][1] for s in j.get('spans', [])[:-1]]
            P = P or j.get('beat_s') or (60 / j['bed_bpm'] if j.get('bed_bpm') else None)
        dl = [x['t0'] for x in (j.get('sections', []) if a.frm else []) if x.get('join_in') in ('drop', 'stop', 'fill')]
        rows = seams(ws, rp(a.audio), sorted(set(round(x, 3) for x in at)), P, dl)
        p = W.jwrite(W.P(ws, 'out', 'qc', os.path.basename(a.audio).rsplit('.', 1)[0] + '-seams.json'), dict(audio=a.audio, beat_s=P, seams=rows, flagged=sum(r['flag'] for r in rows)))
        print(json.dumps(dict(report=W.rel(ws, p), seams=len(rows), flagged=sum(r['flag'] for r in rows))))
    elif a.cmd == 'sheets':
        if not a.video: raise SystemExit('sheets needs --video')
        print(json.dumps(dict(sheets=sheets(ws, rp(a.video), a.step, a.cols, a.boundaries, a.fps10_window))))
    elif a.cmd == 'footage':
        if not a.clip: raise SystemExit('footage needs --clip')
        c = rp(a.clip); d = W.duration(c); ts = list(np.linspace(0, max(0, d - 0.05), 8)); name = os.path.basename(c)[:-4]
        p = W.P(ws, 'out', 'qc', f'footage-{name}.jpg'); sheet(c, ts, [f'{t:.1f}S' for t in ts], p, 4, 320, f'footage {name}')
        pr = W.ffprobe(c); v = [s for s in pr['streams'] if s['codec_type'] == 'video'][0]
        rep = dict(clip=W.rel(ws, c), sheet=W.rel(ws, p), durS=round(d, 3), width=v.get('width'), height=v.get('height'),
                   checklist=[dict(check=x, result='pending (look at the sheet)') for x in FOOTAGE_CHECKS], verdict='pending')
        j = W.jwrite(W.P(ws, 'out', 'qc', f'footage-{name}.json'), rep); print(json.dumps(dict(report=W.rel(ws, j), sheet=rep['sheet'])))


if __name__ == '__main__': main()
