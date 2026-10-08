#!/usr/bin/env python3
"""Selftest stand-in for the Remotion picture stage: timeline.json (music-locked: the scene lengths of remotion/scenes.json, which
`music/lock.py apply` set from the picked music option's windows; each line at its scene start + its lines.json `at`, the kit's
0.3 s lead by default; a line past its window + 0.35 s tail is reported, the scene is NOT stretched) + placeholder VO-only picture MP4s
per format x language (small testsrc clips, exact frame counts).

  scripts/py selftest/make_picture.py --ws DIR [--width 640 --height 360]

The real picture comes from the mode's Remotion project; this only exists so the audio / QC scripts can be tested end to end."""
import argparse, json, os, subprocess, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import ws as W, timeline as TL


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ws', required=True); ap.add_argument('--width', type=int, default=640); ap.add_argument('--height', type=int, default=360)
    a = ap.parse_args(); ws = W.ws_root(a.ws)
    sj = TL.scenes(ws); fps = int(sj['fps']); lines = W.jread(os.path.join(ws, 'stages', 'vo', 'lines.json'), [])
    frames = int(round(max(s['end'] for s in sj['scenes']) * fps))
    vo = []
    for s in sj['scenes']:
        for l in lines:
            if l['sceneId'] == s['id']:
                at = float(l.get('at', 0.3)); vo.append(dict(id=l['id'], lang=l['lang'], **{'from': round(s['start'] + at, 3)}, dur=l['durS']))
                if at + l['durS'] + 0.35 > s['len'] + 1e-3: W.log(f"WARNING {s['id']} {l['lang']}: VO {l['durS']} s at {at} s overruns the {s['len']} s window")
    fmts = W.film(ws).get('run', {}).get('brief', {}).get('formats') or ['short-16x9']
    tl = dict(fps=fps, units='seconds', formats={f: dict(width=a.width if '16x9' in f else a.height, height=a.height if '16x9' in f else a.width, frames=frames) for f in fmts},
              scenes=[{'id': s['id'], 'from': s['start'], 'len': s['len']} for s in sj['scenes']],
              tracks=dict(vo=vo, bgm=[], sfx=[], captions=[dict(**{'from': v['from']}, dur=v['dur'], text=next(l['text'] for l in lines if l['id'] == v['id'] and l['lang'] == v['lang']), lang=v['lang']) for v in vo]))
    W.jwrite(os.path.join(ws, 'timeline.json'), tl)
    for f, fi in tl['formats'].items():
        for lang in W.languages(ws):
            out = W.P(ws, 'out', 'picture', f'{f}-{lang}.mp4'); W.mkdirs(out)
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f"testsrc2=s={fi['width']}x{fi['height']}:r={fps}", '-frames:v', str(frames),
                            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32', '-pix_fmt', 'yuv420p', '-an', out], check=True)
            print(json.dumps(dict(picture=W.rel(ws, out), frames=W.count_frames(out))))


if __name__ == '__main__': main()
