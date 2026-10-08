"""The film's ONE clock (music-locked, the default since 09-28): script -> music -> voice -> VO -> picture fitted to both.

At `music`, every option turns the script's durationS into scene WINDOWS on its own grid (whole bars, frame-exact boundaries):
  option.windows = [{scene, from, to, len, frames, bars, beats, bpm}]      (seconds; from/to are multiples of 1/fps)
and its bed.bpmMap uses the same from/to, so music/arrange.py lands every section on its cut. Once the producer picks an option, its
windows ARE the scene windows: music/demo.py plays the guide VO in them, vo/pick.py places and fits the lines in them,
`music/lock.py apply` writes them into remotion/scenes.json (`"units": "seconds"`, `len` per scene) where the picture reads them,
and stages/music/clock.json records what was applied. Nothing here writes film.json (only tl.mjs does).

resolve(ws) order: an explicit option id -> film.json stages.music.pick -> stages/music/clock.json -> the script's durationS
(the VO-locked fallback: no music yet)."""
import json, os, re
import numpy as np
import ws as W

MAXR = 0.15          # the stretch limit per section (launch-music.md: <= +-15 %; bigger contrasts use half / double-time feel)
LEAD, GAP, TAIL = 0.3, 0.35, 0.35   # the kit's VO defaults (layout.ts: vo.at 0.3, gap 0.35, tail 0.35): a line + TAIL past its window stretches the scene


def fps_of(ws):
    p = os.path.join(ws, 'remotion', 'scenes.json')
    try: return float(W.jread(p).get('fps', 30)) if os.path.exists(p) else 30.0
    except (SystemExit, ValueError): return 30.0


def q(t, fps):
    """a time on the frame grid"""
    return round(round(float(t) * fps) / fps, 6)


# ── VO estimate (music comes before voice: the windows must already leave room for the lines) ─────────────────────────────
_JA_SKIP = re.compile(r'[\s、。「」『』！？!?,.・…]')


def estimate_vo(text, lang):
    """seconds a line will take: the kit's placeholder estimate (layout.ts estimateVo: EN ~2.7 words/s, JA ~7.5 chars/s + 0.2 s per
    clause), so the windows the music stage makes are the ones the picture's placeholder VO would need"""
    if not text: return 0.0
    if lang == 'ja': return len(_JA_SKIP.sub('', text)) / 7.5 + len(re.split(r'[、。]', text)) * 0.2
    return len(text.split()) / 2.7


def need_s(scene, langs=('ja', 'en')):
    """the shortest window a script scene can have: lead + the longest estimated line + tail"""
    vo = scene.get('vo') or {}
    d = max([estimate_vo(vo.get(l), l) for l in langs if vo.get(l)] or [0.0])
    return LEAD + d + TAIL if d else 0.0


# ── feel / grid tempo ──────────────────────────────────────────────────────────────────────────────────────────────────────
def grid_tempo(bpm, feel, bed_bpm, maxr=MAXR):
    """(grid_bpm, feel, note). bpm = the GRID tempo the section is played at (the beat the picture cuts on); feel = the drums on
    that grid (straight | half: kick 1 + 'and of 3', clap on 3, perceived bpm/2 | double: 16th shaker/hats, perceived 2 x bpm).
    A target further than +-15 % from the bed is re-expressed instead of stretched further: 2 x bpm with a half-time feel
    (perceived = the target) or bpm / 2 with a double-time feel; clamped (with a note) only when neither fits."""
    bpm = float(bpm); feel = feel or 'straight'
    if abs(bpm / bed_bpm - 1) <= maxr + 1e-9: return bpm, feel, None
    for g, f in ((2 * bpm, 'half'), (bpm / 2, 'double')):
        if abs(g / bed_bpm - 1) <= maxr + 1e-9:
            return g, f, f'{bpm:.1f} BPM is {bpm / bed_bpm - 1:+.0%} from the bed: played at {g:.1f} with a {f}-time feel (perceived {bpm:.1f})'
    lim = bed_bpm * (1 + maxr * np.sign(bpm / bed_bpm - 1))
    return lim, feel, f'{bpm:.1f} BPM needs {bpm / bed_bpm - 1:+.0%}: clamped to {lim:.1f}'


def perceived(bpm, feel):
    return bpm / 2 if feel == 'half' else (bpm * 2 if feel == 'double' else bpm)


# ── windows ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
def windows_ideal(scenes, tempos, fps=30.0, langs=('ja', 'en'), beats_per_bar=4):
    """windows on an IDEAL grid that starts at 0 (what music/arrange.py realises): scene i gets a whole number of bars at
    tempos[i] (nearest to its durationS, never shorter than its estimated VO needs; half a bar for a scene shorter than 0.75 bar),
    every boundary on the frame grid. -> [{scene, from, to, len, frames, bars, beats, bpm}]"""
    out = []; t0 = 0.0
    for s, bpm in zip(scenes, tempos):
        d = float(s.get('durationS', 4)); beat = 60 / float(bpm); bar = beats_per_bar * beat
        unit = 2 if d < 0.75 * bar else beats_per_bar                   # beats per step: half bars only for very short scenes
        k = max(1, int(round(d / (unit * beat))))
        nd = need_s(s, langs)
        while k * unit * beat < nd - 1e-6: k += 1
        t1 = q(t0 + k * unit * beat, fps)
        out.append(dict(scene=s['id'], **{'from': t0}, to=t1, len=round(t1 - t0, 6), frames=int(round((t1 - t0) * fps)),
                        bars=round(k * unit / beats_per_bar, 2), beats=k * unit, bpm=round(float(bpm), 3), needS=round(nd, 2)))
        t0 = t1
    return out


def windows_on_grid(scenes, beats, downbeat_phase, fps=30.0, total=None, langs=('ja', 'en'), beats_per_bar=4):
    """windows on a REAL bed's beat grid (a library fit / V2M / composed bed that is not re-arranged): every boundary on the
    downbeat nearest the running script length (never shorter than the VO estimate), the last one at the bed's end (total)."""
    g = np.asarray(beats, float); P = float(np.median(np.diff(g))) if len(g) > 1 else 0.5
    ext = np.arange(g[-1] + P, g[-1] + P * 64, P) if len(g) else np.array([])
    g = np.concatenate([g, ext]); db = g[int(downbeat_phase) % beats_per_bar::beats_per_bar]
    out = []; t0 = 0.0; cum = 0.0
    for i, s in enumerate(scenes):
        cum += float(s.get('durationS', 4)); nd = need_s(s, langs)
        if i == len(scenes) - 1 and total: t1 = q(total, fps)
        else:
            c = db[db >= t0 + max(nd, P * 2) - 1e-6]
            t1 = q(c[int(np.argmin(abs(c - cum)))] if len(c) else cum, fps)
        n = int(((g > t0 + 1e-3) & (g <= t1 + 1e-3)).sum())
        out.append(dict(scene=s['id'], **{'from': t0}, to=t1, len=round(t1 - t0, 6), frames=int(round((t1 - t0) * fps)),
                        bars=round(n / beats_per_bar, 2), beats=n, bpm=round(60 / P, 3), needS=round(nd, 2), grid='bed'))
        t0 = t1
    return out


def windows_from_map(bm, fps=30.0):
    return [dict(scene=b.get('scene'), **{'from': q(b['from'], fps)}, to=q(b['to'], fps), len=round(q(b['to'], fps) - q(b['from'], fps), 6),
                 frames=int(round((q(b['to'], fps) - q(b['from'], fps)) * fps)), bpm=b.get('bpm')) for b in bm]


def option_windows(ws, o, fps=None):
    """an option's windows: its `windows`, else the arranged sections (bed.arrangement), else its bpmMap from/to"""
    fps = fps or fps_of(ws)
    if o.get('windows'): return o['windows']
    arr = (o.get('bed') or {}).get('arrangement')
    if arr and os.path.exists(os.path.join(ws, arr)):
        secs = W.jread(os.path.join(ws, arr)).get('sections', [])
        if secs: return windows_from_map([dict(scene=s['scene'], **{'from': s['t0']}, to=s['t1'], bpm=s['bpm_play']) for s in secs], fps)
    bm = (o.get('bed') or {}).get('bpmMap') or []
    if bm: return windows_from_map(bm, fps)
    return []


def music_option(ws, oid):
    p = os.path.join(ws, 'stages', 'music', 'options', f'{oid}.json')
    if not os.path.exists(p): raise SystemExit(f'no music option {oid} ({W.rel(ws, p)})')
    return W.jread(p)


def resolve(ws, option=None, fps=None):
    """-> {source: 'music:<id>' | 'clock.json' | 'script', option, fps, total, frames, scenes:[{id, start, end, len, frames}]}"""
    fps = fps or fps_of(ws)
    oid = option or W.film(ws).get('stages', {}).get('music', {}).get('pick')
    if oid:
        wins = option_windows(ws, music_option(ws, oid), fps); src = f'music:{oid}'
    else:
        cj = os.path.join(ws, 'stages', 'music', 'clock.json')
        if os.path.exists(cj):
            c = W.jread(cj); return dict(c, source='clock.json')
        import timeline as TL
        sc, _ = TL.from_script(W.script_option(ws))
        wins = [dict(scene=s['id'], **{'from': q(s['start'], fps)}, to=q(s['end'], fps)) for s in sc]; src = 'script'
    scenes = [dict(id=w['scene'], start=q(w['from'], fps), end=q(w['to'], fps), len=round(q(w['to'], fps) - q(w['from'], fps), 6),
                   frames=int(round((q(w['to'], fps) - q(w['from'], fps)) * fps))) for w in wins]
    total = scenes[-1]['end'] if scenes else 0.0
    return dict(source=src, option=oid, fps=fps, total=total, frames=int(round(total * fps)), scenes=scenes)


def write(ws, clk):
    """stages/music/clock.json. It is a music-stage file, so it is in the stage's approval hash: rewriting the same clock (the
    picture stage re-runs `lock.py apply`) must leave the file byte-identical, or every apply would show music `changed` and
    every stage after it `stale`. So an unchanged clock keeps its file (and its `at`)."""
    p = W.P(ws, 'stages', 'music', 'clock.json')
    if os.path.exists(p):
        try:
            old = W.jread(p)
            if {k: v for k, v in old.items() if k != 'at'} == json.loads(json.dumps(clk)): return p
        except Exception:
            pass
    return W.jwrite(p, dict(clk, at=W.now_iso()))


def apply_scenes(ws, clk, path=None):
    """remotion/scenes.json: every scene the clock knows gets len = its window (seconds, frame-exact), `from` dropped (scenes run
    back to back), `"units": "seconds"` (a frames file is converted). Scenes the clock doesn't know keep their length (reported).
    -> (path, changes[], unknown[]) or (None, [], []) when there is no scenes.json yet."""
    p = path or os.path.join(ws, 'remotion', 'scenes.json')
    if not os.path.exists(p): return None, [], []
    doc = W.jread(p); fps = float(doc.get('fps', clk.get('fps', 30)))
    k = (1 / fps) if doc.get('units') == 'frames' else 1.0
    byid = {s['id']: s for s in clk['scenes']}; changes = []; unknown = []
    for s in doc.get('scenes', []):
        old = s.get('len')
        if s['id'] not in byid:
            if k != 1.0:
                s['len'] = {kk: round(v * k, 6) for kk, v in old.items()} if isinstance(old, dict) else round(float(old or 0) * k, 6)
                if s.get('from') is not None: s['from'] = round(s['from'] * k, 6)
            unknown.append(s['id']); continue
        new = round(byid[s['id']]['frames'] / fps, 6)
        oldS = (old if not isinstance(old, dict) else max(old.values())) if old is not None else None
        oldS = None if oldS is None else float(oldS) * k
        if oldS is None or abs(oldS - new) > 0.5 / fps or isinstance(old, dict): changes.append(dict(id=s['id'], old=None if oldS is None else round(oldS, 3), new=new))
        s['len'] = new; s.pop('from', None)
    doc['units'] = 'seconds'
    doc['clock'] = dict(source=clk.get('source'), option=clk.get('option'), frames=clk.get('frames'), fps=fps)
    W.jwrite(p, doc)
    return p, changes, unknown


def compare_frames(clk, scenes_frames):
    """[(id, clock frames, other frames)] where a scene's frame count differs"""
    ref = {s['id']: s['frames'] for s in clk['scenes']}
    return [(i, ref.get(i), f) for i, f in scenes_frames if i in ref and ref[i] != f]
