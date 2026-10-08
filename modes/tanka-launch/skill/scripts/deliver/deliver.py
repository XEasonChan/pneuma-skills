#!/usr/bin/env python3
"""Stage 10 · deliver the finals: copy out/final/*.mp4 to <deliveryDir>/<run>/, keep the previous final as '…-fallback', write a
delivery note, and (optionally) ask the reminder hook to set a reminder.

  scripts/py deliver/deliver.py [--ws DIR] --yes [--to DIR] [--run ID] [--files a.mp4,b.mp4] [--remind "Launch film" --due 2026-10-05T09:00]
                                [--dry-run]

Gate: runs only after the producer approved the rough cut (film.json stages.roughcut.approval.by == "producer") and with --yes (their final
OK, given in chat). The delivery folder gets the MP4s ONLY; the note goes to out/deliver/<run>-delivery-note.md in
the workspace. An existing final with the same name is renamed to <name>-fallback.mp4 (an existing fallback is never overwritten:
the older one becomes <name>-fallback-<timestamp>.mp4). Copies are verified by sha256 and frame count.
deliveryDir: --to, else $TL_DELIVERY_DIR, else film.json settings.deliveryDir, else the platform default (common/host.py): /data/deliveries
in a container (TL_HOSTED=1), else ~/LaunchStudio/deliveries. Mock mode always delivers into <ws>/out/mock-delivery/. Names:
<prefix>-<run>-<format>-<LANG>.mp4 (prefix = the brand's display form, else "launch"; LANG = JA | EN | EN-JASUB; file names are not
on-screen text)."""
import argparse, glob, json, os, re, shutil, subprocess, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import ws as W, host as H


def delivery_dir(to):
    """the resolved delivery folder (an explicit one, else the platform default)"""
    to = os.path.expanduser(to) if to else H.delivery_default()
    if not to: raise SystemExit('no delivery folder: pass --to DIR or set TL_DELIVERY_DIR')
    return to


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ws'); ap.add_argument('--to'); ap.add_argument('--run'); ap.add_argument('--files'); ap.add_argument('--yes', action='store_true')
    ap.add_argument('--remind'); ap.add_argument('--due'); ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args(); ws = W.ws_root(a.ws); f = W.film(ws); mock = W.is_mock(ws)
    run = a.run or f.get('run', {}).get('id') or os.path.basename(ws)
    appr = (f.get('stages', {}).get('roughcut', {}) or {}).get('approval') or {}
    if appr.get('by') != 'producer':
        if not mock: raise SystemExit('refusing: the rough cut is not approved by the producer (tl.mjs approve roughcut --by producer)')
        W.log('mock: rough-cut approval missing (allowed in mock mode only)')
    if not (a.yes or a.dry_run): raise SystemExit("refusing: pass --yes once the producer has given the final OK in chat")
    to = W.P(ws, 'out', 'mock-delivery') if mock else delivery_dir(a.to or os.environ.get('TL_DELIVERY_DIR') or W.setting(ws, 'deliveryDir'))
    dest = os.path.join(to, run)
    W.disk_guard(to if os.path.exists(to) else os.path.dirname(to), 'the delivery copy')
    files = [p if os.path.isabs(p) else os.path.join(ws, p) for p in a.files.split(',')] if a.files else sorted(glob.glob(W.P(ws, 'out', 'final', '*.mp4')))
    if not files: raise SystemExit('nothing to deliver (out/final/*.mp4)')
    qc = {r['file']: r for r in W.jread(W.P(ws, 'out', 'qc', 'final-check.json'), {'files': []})['files']}
    plan = []
    for p in files:
        v = W.parse_version(p)
        if not v: raise SystemExit(f'{W.rel(ws, p)}: not named <format>-<lang>.mp4 (the naming rule, common/ws.py); rename or pass --files')
        prefix = re.sub(r'[^A-Za-z0-9_-]+', '-', (W.brand(ws) or {}).get('display') or 'launch').strip('-') or 'launch'
        name = f"{prefix}-{run}-{v['format']}-{v['lang'].upper()}.mp4"; plan.append((p, os.path.join(dest, name)))
    if a.dry_run:
        print(json.dumps(dict(dryRun=True, dest=dest, files=[(W.rel(ws, s), d) for s, d in plan]), ensure_ascii=False, indent=1)); return
    os.makedirs(dest, exist_ok=True); done = []
    for src, dst in plan:
        rec = dict(src=W.rel(ws, src), dst=dst, bytes=os.path.getsize(src), frames=W.count_frames(src), duration_s=round(W.duration(src), 3))
        if os.path.exists(dst):
            if W.sha256_file(dst) == W.sha256_file(src): rec['status'] = 'unchanged'; done.append(rec); continue
            fb = dst[:-4] + '-fallback.mp4'
            if os.path.exists(fb): fb = dst[:-4] + time.strftime('-fallback-%Y%m%d-%H%M.mp4')
            os.rename(dst, fb); rec['previous_final_kept_as'] = fb
        shutil.copy2(src, dst)
        if W.sha256_file(dst) != W.sha256_file(src) or W.count_frames(dst) != rec['frames']: raise SystemExit(f'copy verification failed: {dst}')
        q = qc.get(rec['src'], {}); rec.update(status='delivered', lufs=q.get('lufs'), tp=q.get('tp'), qc_ok=q.get('ok'))
        done.append(rec); print(json.dumps(dict(delivered=dst, fallback=rec.get('previous_final_kept_as'))))
    led = W.tl(ws, ['ledger', 'summary', '--json']); spend = None
    if led is not None and led.returncode == 0:
        try: spend = {k: v for k, v in json.loads(led.stdout).items() if k not in ('records',)}
        except ValueError: spend = led.stdout.strip()[:500]
    note = [f'# Delivery · {run}', '', f'- when: {W.now_iso()}', f'- to: {dest}', f'- mock: {mock}', '', '| file | frames | s | LUFS | TP | QC | previous final |', '|---|---|---|---|---|---|---|']
    for r in done:
        note.append(f"| {os.path.basename(r['dst'])} | {r['frames']} | {r['duration_s']} | {r.get('lufs')} | {r.get('tp')} | {r.get('qc_ok')} | {os.path.basename(r.get('previous_final_kept_as') or '') or '-'} |")
    note += ['', '## Spend', '', '```', json.dumps(spend, indent=1, ensure_ascii=False) if spend is not None else 'ledger summary unavailable', '```']
    np_ = W.P(ws, 'out', 'deliver', f'{run}-delivery-note.md'); W.mkdirs(np_); open(np_, 'w').write('\n'.join(note) + '\n')
    rem = None
    if a.remind:
        r = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reminder.py'), '--ws', ws, '--title', a.remind] + (['--due', a.due] if a.due else []) + ['--note', f'Delivered to {dest}'],
                           capture_output=True, text=True); rem = (r.stdout.strip().splitlines() or [r.stderr.strip()])[-1]
    W.jwrite(W.P(ws, 'out', 'deliver', f'{run}-delivery.json'), dict(run=run, dest=dest, files=done, note=W.rel(ws, np_), reminder=rem, mock=mock))
    print(json.dumps(dict(dest=dest, delivered=sum(1 for r in done if r['status'] == 'delivered'), unchanged=sum(1 for r in done if r['status'] == 'unchanged'), note=W.rel(ws, np_), reminder=rem)))


if __name__ == '__main__': main()
