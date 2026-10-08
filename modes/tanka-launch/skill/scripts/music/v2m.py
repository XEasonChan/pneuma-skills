#!/usr/bin/env python3
"""Stage 3 · ElevenLabs Video-to-Music beds from the picture: picture-only 720p in, 1-3 briefs, <= 2 requests at a time.

  scripts/py music/v2m.py --video out/roughcut/short-16x9-ja.mp4 [--ws DIR] [--briefs E1,B,tags] [--brief "custom text"] [--model music_v2_5]
                          [--ids A,B,C] [--dry-run] [--register]

The input is the picture only (audio stripped), scaled to 720p (limits: <= 200 MB, <= 600 s). Briefs (<= 1000 chars) are built
from references/style-presets.md (common/style.py) every time — the palette AND the negatives are re-stated (carried-over briefs leaked piano) — plus the
film's timing: its exact length, when the product appears (the first scene whose type is a product scene, or --product-at), and the
button at the lockup. Presets: E1 (the ElevenLabs-launch-film electronic pop), B (airy build), tags (no description, style tags
only). Always sends model_id (the API default music_v1 is deprecated and ran 20 s long on a 61 s picture).
Paid: ~$0.60 per minute of picture per request (ledger reserve before each; request id recorded). ElevenLabs allows 2 concurrent
music requests per account (a 3rd returns 429): a cross-process lock in <ws>/.tl-locks keeps it at 2.
Mock: the matching seed-library placeholder bed (E1 -> placeholder-pulse, B -> placeholder-air, tags -> placeholder-drive) fitted to
the picture length.
Style: references/style-presets.md wins (common/style.py reads it fresh; style.json is only the machine fallback).
Writes stages/music/beds/<id>-v2m.flac + stages/music/options/<id>.json (bed, BPM, key, per-scene BPM map, SFX set) + options.json.
Gotcha: V2M follows mood, not cuts; the SFX layer carries the cuts."""
import argparse, json, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ws as W, paid, audio as A, timeline as TL, style as STY
import library as LIB

PRODUCT_TYPES = ('assistant-entrance', 'desk-chat', 'memory-graph', 'proposal-page', 'email-card', 'team-assistants', 'morning-summary')
MOCK_BED = {'E1': 'placeholder-pulse', 'B': 'placeholder-air', 'tags': 'placeholder-drive', 'custom': 'placeholder-pulse'}


def product_at(sc, override=None):
    if override is not None: return override
    scenes, _ = TL.from_script(sc)
    for s in scenes:
        if s.get('type') in PRODUCT_TYPES: return s['start']
    return scenes[1]['start'] if len(scenes) > 1 else 0.0


def brief(kind, total, t_prod, custom=None):
    """<= 1000 chars: the preset brief QUOTED VERBATIM (references/style-presets.md music-briefs), the film's timing, then as many
    of the negatives block's sentences as fit (piano first)."""
    ST = STY.load(); btn = max(0.0, total - 4.0)
    if kind == 'tags': return None, ST['tags'][:10]
    timing = {'E1': [f'Exactly {total:.1f} seconds long; music starts at 0 s with no silence.', f'0 to {t_prod:.1f} s: filtered and restrained, a little echo.',
                     f'At {t_prod:.1f} s the product appears: the groove opens and stays one continuous groove.', f'Clean button (a stop plus one chord) at {btn:.1f} s, then rings out.',
                     'Sits under a voiceover.'],
              'B': [f'Exactly {total:.1f} seconds long; music starts at 0 s with no silence.', f'Ethereal with a little echo until {t_prod:.1f} s, then the build as the product appears.',
                    f'Resolves at {btn:.1f} s.'],
              'custom': [f'Exactly {total:.1f} seconds long; music starts at 0 s.']}[kind]
    head = custom if kind == 'custom' else ST['briefs_that_worked'][kind]
    txt = ' '.join([head] + timing)
    for sent in re.split(r'(?<=\.)\s+', ' '.join(ST['negatives_text'].split())):
        if len(txt) + 1 + len(sent) <= 1000: txt += ' ' + sent
    return txt[:1000], []


def picture720(ws, video, lang):
    out = W.P(ws, 'stages', 'music', 'v2m', f'pic720-{lang}.mp4')
    if not os.path.exists(out) or os.path.getmtime(out) < os.path.getmtime(video):
        W.mkdirs(out)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', video, '-an', '-vf', 'scale=-2:720', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', out], check=True)
    d = W.duration(out); mb = os.path.getsize(out) / 1e6
    if d > 600 or mb > 200: raise SystemExit(f'picture too long / big for V2M ({d:.0f} s, {mb:.0f} MB; limits 600 s, 200 MB)')
    return out, d


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ws'); ap.add_argument('--video', required=True); ap.add_argument('--lang', default='ja'); ap.add_argument('--briefs', default='E1,B')
    ap.add_argument('--brief'); ap.add_argument('--model', default='music_v2_5', choices=['music_v1', 'music_v2', 'music_v2_5']); ap.add_argument('--ids')
    ap.add_argument('--product-at', type=float); ap.add_argument('--script'); ap.add_argument('--dry-run', action='store_true'); ap.add_argument('--register', action='store_true')
    a = ap.parse_args()
    ws = W.ws_root(a.ws); video = a.video if os.path.isabs(a.video) else os.path.join(ws, a.video); sc = W.script_option(ws, a.script)
    kinds = (['custom'] if a.brief else []) + [k for k in a.briefs.split(',') if k and not a.brief]
    ids = (a.ids.split(',') if a.ids else list('ABCDEFG'))[:len(kinds)]
    pic, total = picture720(ws, video, a.lang); tp = product_at(sc, a.product_at); W.disk_guard(ws, 'V2M beds')
    reqs = []
    for oid, k in zip(ids, kinds):
        desc, tags = brief(k, total, tp, a.brief)
        reqs.append(dict(id=oid, kind=k, description=desc, tags=tags, model=a.model, est_usd=round(paid.est_v2m(total), 3)))
    if a.dry_run:
        print(json.dumps(dict(picture=W.rel(ws, pic), seconds=round(total, 2), requests=reqs, total_est_usd=round(sum(r['est_usd'] for r in reqs), 2)), ensure_ascii=False, indent=1)); return
    pd = paid.Paid(ws, 'music')

    def one(r):
        flac = W.P(ws, 'stages', 'music', 'beds', f"{r['id']}-v2m.flac")
        if pd.mock:
            c = LIB.card(MOCK_BED[r['kind']], ws); y, _ = LIB.fit(c, total); A.write(flac, y)
            pd.mock_record(f"v2m {r['id']} ({r['kind']}) -> library {c['id']}"); r['requestId'] = 'mock'; r['mockBed'] = c['id']; return r
        pcm = W.P(ws, 'stages', 'music', 'v2m', f"{r['id']}.pcm")
        with paid.Slots(ws, 'elevenlabs-music', 2):
            with pd.call('elevenlabs', f"video-to-music {r['id']} {r['kind']} {total:.0f}s {r['model']}", r['est_usd']) as c:
                import el
                res = el.video_to_music(pic, pcm, r['description'], r['tags'], r['model']); c['request_id'] = res['request_id']
        x = A.load_pcm(pcm); A.write(flac, A.fit(x, int(round(total * A.SR)))); os.remove(pcm)
        r['requestId'] = c['request_id']; r['rawLenS'] = round(len(x) / A.SR, 2); return r

    with ThreadPoolExecutor(2) as ex: done = list(ex.map(one, reqs))
    rows = []
    for k, r in enumerate(done):
        flac = W.P(ws, 'stages', 'music', 'beds', f"{r['id']}-v2m.flac"); d = W.duration(flac)
        if abs(d - total) > 0.06: raise SystemExit(f'{flac}: {d:.2f} s != picture {total:.2f} s')
        if r.get('rawLenS') and abs(r['rawLenS'] - total) > 3: W.log(f"WARNING {r['id']}: V2M returned {r['rawLenS']} s for a {total:.1f} s picture (trimmed / padded)")
        meta = dict(title=f"V2M {r['kind']} ({r['model']})", model=r['model'], description=r['description'], tags=r['tags'], requestId=r['requestId'],
                    licence=STY.load()['licence_note'], style_source=STY.load()['source'], **({'mockBed': r['mockBed']} if r.get('mockBed') else {}))
        of, row = LIB.write_option(ws, r['id'], flac, 'v2m', meta, sc, total, recommended=(k == 0)); rows.append(row)
        print(json.dumps(dict(option=r['id'], kind=r['kind'], bed=W.rel(ws, flac), requestId=r['requestId'])))
    of = LIB.merge_options(ws, rows); W.register_options(ws, 'music', of, a.register)


if __name__ == '__main__': main()
