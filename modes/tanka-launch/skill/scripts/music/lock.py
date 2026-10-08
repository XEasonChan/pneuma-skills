#!/usr/bin/env python3
"""Stage 3 -> 7 · the music-locked clock: the picked music option's scene windows become THE scene windows.

  scripts/py music/lock.py show  [--ws DIR] [--option A]          print the resolved windows (s + frames)
  scripts/py music/lock.py apply [--ws DIR] [--option A]          write stages/music/clock.json + remotion/scenes.json len per scene
  scripts/py music/lock.py check [--ws DIR] [--option A]          compare scenes.json / timeline.json / lines.json with the clock

Which option: --option, else film.json stages.music.pick (tl.mjs writes it when the producer confirms), else stages/music/clock.json,
else the script's durationS (the VO-locked fallback: no music yet). Windows = the option's `windows` (library.py options /
arrange.py), else its arranged sections, else its bpmMap from/to; every boundary is on the frame grid, so the picture, the bed, the
demo and the VO placement agree to the frame.
apply: remotion/scenes.json gets `"units": "seconds"` (a frames file is converted) and every known scene's `len` = its window
(seconds, frame-exact; `from` dropped: scenes run back to back), plus a `clock` note; the kit (layout.ts) rounds len x fps back to
the same frames. Scenes the clock doesn't know are left as they are and reported. Run it after the music pick and again after
writing scenes.json at the picture stage (vo/pick.py and music/demo.py read the same windows). Never writes film.json.
check: exit 1 when a scene's frames differ (scenes.json, timelines/*.json) or a picked line overruns its window."""
import argparse, glob, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import ws as W, clock as CK, timeline as TL


def check(ws, clk):
    rows = []; fps = clk['fps']
    sj = os.path.join(ws, 'remotion', 'scenes.json')
    if os.path.exists(sj):
        d = TL.scenes(ws) or {'scenes': []}
        diff = CK.compare_frames(clk, [(s['id'], int(round(s['len'] * fps))) for s in d['scenes']])
        rows.append(dict(what='remotion/scenes.json', ok=not diff, diff=diff))
    for p in sorted(glob.glob(os.path.join(ws, 'timelines', '*.json'))) + ([os.path.join(ws, 'timeline.json')] if os.path.exists(os.path.join(ws, 'timeline.json')) else []):
        try: t = TL.load(ws, path=p)
        except SystemExit: continue
        diff = CK.compare_frames(clk, [(s['id'], int(round(s['len'] * fps))) for s in t['scenes']])
        rows.append(dict(what=W.rel(ws, p), ok=not diff, diff=diff))
    lj = os.path.join(ws, 'stages', 'vo', 'lines.json')
    if os.path.exists(lj):
        win = {s['id']: s for s in clk['scenes']}; over = []
        for l in W.jread(lj, []):
            w = win.get(l.get('sceneId'))
            if not w: continue
            end = float(l.get('at', CK.LEAD)) + float(l.get('durS', 0)) + CK.TAIL
            if end > w['len'] + 1e-3: over.append((l['id'], l['lang'], round(end - w['len'], 3)))
        rows.append(dict(what='stages/vo/lines.json', ok=not over, overruns=over))
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('cmd', choices=['show', 'apply', 'check']); ap.add_argument('--ws'); ap.add_argument('--option')
    a = ap.parse_args(); ws = W.ws_root(a.ws); clk = CK.resolve(ws, a.option)
    if a.cmd == 'show':
        print(json.dumps(clk, indent=1)); return
    if a.cmd == 'apply':
        if clk['source'] == 'script': W.log('no music option picked (film.json stages.music.pick) and no --option: applying the SCRIPT clock (VO-locked fallback)')
        cp = CK.write(ws, clk); p, changes, unknown = CK.apply_scenes(ws, clk)
        if p is None: W.log('remotion/scenes.json does not exist yet: run `music/lock.py apply` again once the picture stage has written it')
        for u in unknown: W.log(f'WARNING scenes.json scene {u} is not in the music clock: its length is unchanged')
        print(json.dumps(dict(clock=W.rel(ws, cp), source=clk['source'], total=clk['total'], frames=clk['frames'],
                              scenes=W.rel(ws, p) if p else None, changed=changes, unknown=unknown), ensure_ascii=False))
        return
    rows = check(ws, clk)
    print(json.dumps(dict(source=clk['source'], frames=clk['frames'], checks=rows), ensure_ascii=False, indent=1))
    if not all(r['ok'] for r in rows): sys.exit(1)


if __name__ == '__main__': main()
