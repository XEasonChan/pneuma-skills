"""timeline.json / timelines/<key>.json / remotion/scenes.json readers (contracts §5, §6), normalised to SECONDS.

Units: an explicit "units": "frames" | "seconds" (or "s") wins — the kit's render.mjs always writes "frames"; scenes.json is
"seconds" unless it says "frames". Without the field (old files) scene from/len are frames when they are all integers and add up
to formats.<key>.frames (or to more than 3 x the fps), else seconds; the tracks follow the scenes unless their own "units" says.
Which file: `timelines/<format>-<lang>.json` (the version's own clock, written per render) wins over timeline.json; formats are
keyed by the version key `<format>-<lang>` (older files: by format)."""
import os, json, glob
import ws as W


def _unit_frames(u):
    if u in ('frames', 'f'): return True
    if u in ('seconds', 's', 'sec'): return False
    return None


def version_path(ws, fmt=None, lang=None):
    """the most specific timeline file for a version: timelines/<fmt>-<lang>.json, else (lang only) the brief's first format with
    that language, else timeline.json"""
    if fmt and lang:
        p = os.path.join(ws, 'timelines', f'{fmt}-{lang}.json')
        if os.path.exists(p): return p
    if lang and not fmt:
        order = [f for f, l in W.versions(ws) if l == lang]
        for f in order:
            p = os.path.join(ws, 'timelines', f'{f}-{lang}.json')
            if os.path.exists(p): return p
        hits = sorted(glob.glob(os.path.join(ws, 'timelines', f'*-{lang}.json')))
        hits = [h for h in hits if (W.parse_version(h) or {}).get('lang') == lang]
        if hits: return hits[0]
    return os.path.join(ws, 'timeline.json')


def _is_frames(items, fps, total_frames=None, key_from='from', key_len='len'):
    vals = [it.get(key_from, 0) for it in items] + [it.get(key_len, 0) for it in items]
    if not vals or not all(float(v).is_integer() for v in vals): return False
    span = max((it.get(key_from, 0) + it.get(key_len, 0)) for it in items)
    if total_frames and abs(span - total_frames) <= 3: return True
    return span > 3 * fps and span > 60


def load(ws, fmt=None, lang=None, path=None):
    p = path or version_path(ws, fmt, lang)
    t = W.jread(p)
    fps = float(t.get('fps', 30)); fmts = t.get('formats', {})
    key = None
    for k in ([f'{fmt}-{lang}'] if fmt and lang else []) + ([fmt] if fmt else []):
        if k in fmts: key = k; break
    if key is None and lang: key = next((k for k, v in fmts.items() if (v.get('lang') or (W.parse_version(k) or {}).get('lang')) == lang and (not fmt or (v.get('format') or k).startswith(fmt))), None)
    if key is None and fmt: key = next((k for k in fmts if k.startswith(fmt)), None)
    if key is None: key = t.get('lead') if t.get('lead') in fmts else (list(fmts.keys())[0] if fmts else None)
    fi = fmts.get(key, {}) if key else {}
    fmt = fi.get('format') or (W.parse_version(key) or {}).get('format') or key
    scenes = t.get('scenes', [])
    uf = _unit_frames(t.get('units'))
    frames = uf if uf is not None else _is_frames(scenes, fps, fi.get('frames'))
    k = (1 / fps) if frames else 1.0
    sc = [dict(id=s['id'], start=round(s['from'] * k, 4), len=round(s['len'] * k, 4), end=round((s['from'] + s['len']) * k, 4),
               **{kk: vv for kk, vv in s.items() if kk not in ('id', 'from', 'len')}) for s in scenes]
    total = fi.get('frames', 0) / fps if fi.get('frames') else (max((s['end'] for s in sc), default=0))
    tr = t.get('tracks', {}); tu = _unit_frames(tr.get('units')); tk = k if tu is None else ((1 / fps) if tu else 1.0)
    def span(items, lk='dur'):
        return [dict(it, start=round(it.get('from', it.get('t', 0)) * tk, 4), dur=round(it.get(lk, 0) * tk, 4)) for it in items]
    vo = span(tr.get('vo', []))
    if lang: vo = [v for v in vo if v.get('lang', lang) == lang or (lang.startswith('en') and str(v.get('lang', '')).startswith('en'))]
    return dict(fps=fps, format=fmt, key=key, scale=fi.get('scale'), width=fi.get('width'), height=fi.get('height'), frames=fi.get('frames') or int(round(total * fps)),
                total=round(total, 4), scenes=sc, vo=vo, bgm=span(tr.get('bgm', [])), captions=span(tr.get('captions', [])),
                sfx=[dict(s, t=round(s.get('t', 0) * tk, 4)) for s in tr.get('sfx', [])], frames_units=frames, path=p, raw=t)


def scenes(ws, path=None, lang='en', edition='short'):
    """remotion/scenes.json -> {fps, scenes:[{id,type,start,len,end,props}]} in seconds. The kit's grammar: `len` is a number or
    {en, ja}; `from` is optional (scenes run back to back; a given `from` never overlaps the previous scene); `editions` filters.
    This is the PLANNED clock: the rendered one (VO-stretched) is timelines/<key>.json — prefer load() once a render exists."""
    p = path or os.path.join(ws, 'remotion', 'scenes.json')
    if not os.path.exists(p): return None
    s = W.jread(p); fps = float(s.get('fps', 30)); items = [i for i in s.get('scenes', []) if not i.get('editions') or edition in i['editions']]
    lens = [i.get('len', 0) if not isinstance(i.get('len'), dict) else i['len'].get(W.voice_lang(lang), 0) for i in items]
    uf = _unit_frames(s.get('units'))
    frames = uf if uf is not None else _is_frames([dict(i, len=l) for i, l in zip(items, lens)], fps)
    k = (1 / fps) if frames else 1.0; out = []; cur = 0.0
    for i, l in zip(items, lens):
        a = i['from'] * k if i.get('from') is not None and i['from'] * k >= cur - 1e-6 else cur
        d = float(l or 4) * k; out.append(dict(id=i['id'], type=i.get('type'), start=round(a, 4), len=round(d, 4), end=round(a + d, 4), props=i.get('props', {}))); cur = a + d
    return dict(fps=fps, scenes=out)


def from_script(sc, gap=0.0):
    """a provisional timeline from a script option's scene list (durationS), before the picture exists"""
    t = 0.0; out = []
    for s in sc.get('scenes', []):
        d = float(s.get('durationS', 5)); out.append(dict(id=s['id'], start=round(t, 3), len=d, end=round(t + d, 3), type=s.get('sceneType'))); t += d + gap
    return out, round(t, 3)
