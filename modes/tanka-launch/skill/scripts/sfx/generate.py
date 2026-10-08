#!/usr/bin/env python3
"""Stage 8 (optional) · generate a few SFX samples with ElevenLabs sound generation, as alternatives to the procedural kit.

  scripts/py sfx/generate.py --role flip --n 2 [--prompt "…"] [--duration 0.6] [--ws DIR] [--dry-run]

Default prompts follow the SFX palette (references/style-presets.md sfx-palette: low-mid, soft, rounded, no bright whooshes, no
chirps / glass pings / echo tails, water only on `rain` cues). Output: assets/sfx/<role>-<k>.mp3 + .json (prompt, request id);
sfx/render.py still uses the procedural kit unless the director swaps a sample in. The default is procedural; generated samples can
come back "bubbly" with long echoes, so audition them before use.
Paid: ~$0.03 per sample (ledger reserve per call; request id recorded). Mock: the procedural voice for that role, rendered to file."""
import argparse, json, os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import ws as W, paid, audio as A, kit as KT, beats as B

PROMPTS = {
    'flip': 'a single soft paper card turning over on a desk, premium UI, close, dry, low-mid, no reverb',
    'dock': 'a soft paper card placed down on a desk, a muted dry felt tap with a tiny puff of air, close, dry',
    'tap': 'a very light felt tap on wood, soft and rounded, close, dry, no click',
    'tuck': 'a soft card folding away, gentle low paper swish, dry',
    'swipe': 'a low soft panel slide, dark filtered air, gentle, no bright whoosh, dry',
    'tick': 'a tiny dry wooden tick, soft, rounded, no ring',
    'lock': 'a soft low felt latch thump, rounded, no click, no ring',
    'notify': 'a soft rounded two-note chime, low-mid, warm, very short, dry, no glass, no echo',
    'lowhit': 'a soft deep low hit, rounded sub thump, short, no boom tail',
}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ws'); ap.add_argument('--role', required=True); ap.add_argument('--n', type=int, default=2); ap.add_argument('--prompt')
    ap.add_argument('--duration', type=float); ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args(); ws = W.ws_root(a.ws); W.disk_guard(ws, 'SFX samples')
    prompt = a.prompt or PROMPTS.get(a.role) or f'a soft, low-mid, rounded {a.role} sound for a premium product film, dry, no echo'
    est = paid.est_sfx(1)
    if a.dry_run: print(json.dumps(dict(dryRun=True, role=a.role, n=a.n, prompt=prompt, duration=a.duration, est_usd_each=est, est_usd=round(est * a.n, 3)))); return
    pd = paid.Paid(ws, 'sound'); outs = []
    for k in range(1, a.n + 1):
        out = W.P(ws, 'assets', 'sfx', f'{a.role}-{k}.mp3'); W.mkdirs(out)
        if pd.mock:
            x, _ = KT.voice(a.role, dict(t=float(k), lvl=-20), 'A', np.ones(12) / 12, 0.55); A.write(out, A.gain_to(A.st(x), -24.0)); rid = 'mock'
            pd.mock_record(f'sfx sample {a.role}-{k} (procedural stand-in)')
        else:
            with pd.call('elevenlabs', f'sound generation {a.role}-{k}', est) as c:
                import el
                r = el.sound(prompt, out, a.duration); c['request_id'] = r['request_id']
            rid = c['request_id']
        d = W.duration(out)
        if d < 0.05: raise SystemExit(f'{out}: empty sample')
        W.jwrite(out[:-4] + '.json', dict(role=a.role, prompt=prompt, requestId=rid, durS=round(d, 3), mock=pd.mock)); outs.append(W.rel(ws, out))
    print(json.dumps(dict(role=a.role, samples=outs, mock=pd.mock)))


if __name__ == '__main__': main()
