#!/usr/bin/env bash
# End-to-end selftest of the Launch Studio (tanka-launch) stage scripts in MOCK mode on a tiny fixture (a ~20 s, two-scene film, JA + EN).
#   scripts/selftest.sh [WORKDIR]        (default: a fresh mktemp dir; the workspace is WORKDIR/tl-selftest)
# Never calls a paid API: TL_MOCK=1, TL_NO_NETWORK=1 and every provider key unset. Fails on the first error, then checks that the
# ledger holds mock records only, that ONE clock holds to the frame, and that every script answers --help.
# Music-locked order (script -> music -> voice -> VO -> picture): library options A/B/C (windows on each option's grid +
# arrangement + guide demos) -> lock option A's clock (clock.json + scenes.json lens) -> audition -> VO takes -> read check (local
# whisper) -> post -> pick (placed + fitted in the windows; JA/EN + density rules) -> picture stand-in on the clock -> demo with the
# picked VO -> clock check -> V2M + compose mocks -> the arrange CLI -> extend + seam QC -> EN warp -> sound map -> SFX sets A + E ->
# rough-cut mix -> QC (+ lint + music-clock rows) -> images / footage mocks -> final mix -> QC -> delivery (mock folder) + reminder.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="${1:-$(mktemp -d "${TMPDIR:-/tmp}/tl-selftest.XXXXXX")}"
WS="$BASE/tl-selftest"
export TL_MOCK=1 TL_NO_NETWORK=1 TL_WS="$WS"
export TL_CACHE_DIR="${TL_CACHE_DIR:-$BASE/cache}"     # the placeholder beds are synthesised here on first use
unset ELEVENLABS_API_KEY FAL_KEY OPENROUTER_API_KEY FIGMA_TOKEN || true
PY="$HERE/py"
T0=$(date +%s)
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
rm -rf "${WS:?}"; mkdir -p "$BASE"; cp -R "$HERE/selftest/fixture" "$WS"
echo "workspace: $WS"

step "1 music: library options A one-grid / B per-scene / C contrast (windows + arrangement + guide demos)"
"$PY" music/library.py options --lang en
step "2 lock the picked option's clock (stand-in for the producer's pick: --option A)"; "$PY" music/lock.py apply --option A
step "3 voice audition (2 voices x JA/EN, say)";         "$PY" voice/audition.py --n 2
step "4 VO takes (2 per line, say)";                     "$PY" vo/generate.py
step "5 read check (local whisper.cpp)";                 "$PY" vo/readcheck.py ${TL_WHISPER_MODEL:+--model "$TL_WHISPER_MODEL"}
step "6 VO post (EN atempo 1.11, pause rules, -16 LUFS)"; "$PY" vo/post.py
step "7 take pick -> lines.json, placed + fitted in the music windows"; "$PY" vo/pick.py --music A
step "8 picture stand-in on the music clock (timeline.json + VO-only MP4s)"; "$PY" selftest/make_picture.py --ws "$WS"
step "9 demo with the picked VO + clock check (scenes.json = timeline = lines = the music clock)"
"$PY" music/demo.py --option A --lang en
"$PY" music/lock.py check --option A > /dev/null
step "9b V2M / compose mocks + the arrange CLI (option B)"
"$PY" music/v2m.py --video out/picture/short-16x9-ja.mp4 --briefs E1,B --ids V1,V2 --dry-run > /dev/null
"$PY" music/v2m.py --video out/picture/short-16x9-ja.mp4 --briefs E1 --ids V1
"$PY" music/compose.py --id D
"$PY" music/arrange.py --option B
"$PY" music/analyse.py stages/music/beds/A-arranged.flac --script A --out stages/music/beds/A-arranged.check.json > /dev/null
step "10 bed extension (a 2-beat hold at 12 s) + seam QC"
P=$(python3 -c "import json;print(round(2*json.load(open('$WS/stages/music/beds/A-arranged.ana.json'))['beat_s'],4))")
"$PY" music/extend.py --bed stages/music/beds/A-arranged.flac --insert "12.0:$P" --out stages/music/beds/A-ext.flac
"$PY" qc/qc.py seams --audio stages/music/beds/A-ext.flac --from stages/music/beds/A-ext.flac.json
step "11 EN warp from the JA bed (JA = the music clock, EN windows 0.55 s shorter each)"
python3 - "$WS" <<'EOF'
import json, sys; ws = sys.argv[1]; c = json.load(open(f'{ws}/stages/music/clock.json'))['scenes']
ja = [dict(id=s['id'], start=s['start'], end=s['end']) for s in c]; en = []; t = 0.0
for s in c: en.append(dict(id=s['id'], start=round(t, 4), end=round(t + s['len'] - 0.55, 4))); t += s['len'] - 0.55
open(f'{ws}/stages/music/ja-scenes.json', 'w').write(json.dumps(ja)); open(f'{ws}/stages/music/en-scenes.json', 'w').write(json.dumps(en))
EOF
"$PY" music/warp.py --bed stages/music/beds/A-arranged.flac --ja stages/music/ja-scenes.json --en stages/music/en-scenes.json --out stages/music/beds/A-arranged-en.flac --option A
step "12 sound map";                                    "$PY" sfx/soundmap.py
step "13 SFX Set A + Set E (pitch-snapped, grid-quantised)"
"$PY" sfx/render.py --set A --bed stages/music/beds/A-arranged.flac
"$PY" sfx/render.py --set E --bed stages/music/beds/A-arranged.flac
"$PY" sfx/generate.py --role flip --n 1
"$PY" sfx/generate.py --role notify --dry-run > /dev/null
step "14 rough-cut mix (duck 9 dB, TP -1.6, no renormalise) + remux"
"$PY" mix/mix.py --kind roughcut --music stages/music/beds/A-arranged.flac --sfx stages/sound/sfx-E-ja.flac --lang ja --shelf on
"$PY" mix/mix.py --kind roughcut --music stages/music/beds/A-arranged.flac --sfx stages/sound/sfx-E-en.flac --lang en --shelf on
step "15 QC: frames, audio length, LUFS/TP after AAC, sheets, lint, music clock"; "$PY" qc/qc.py all --kind roughcut
step "16 images + footage (mock placeholders) + footage QC"
node "$HERE/images/generate.mjs" --prompt "A stylised 3D assistant character on white" --out assets/images/assistant.png --aspect 1:1
node "$HERE/images/generate.mjs" --prompt "x" --out assets/images/dry.png --provider openrouter --dry-run > /dev/null
node "$HERE/footage/seedance.mjs" --prompt "an office at dawn, slow push-in" --out assets/footage/F1.mp4 --duration 4 --seed 424242
node "$HERE/footage/seedance.mjs" --prompt "x" --out assets/footage/F2.mp4 --ref-image assets/images/assistant.png --dry-run > /dev/null
step "17 finals + QC + delivery (mock folder) + reminder stub"
"$PY" mix/mix.py --kind final --music stages/music/beds/A-arranged.flac --sfx stages/sound/sfx-E-ja.flac --lang ja --shelf on
"$PY" mix/mix.py --kind final --music stages/music/beds/A-arranged-en.flac --sfx stages/sound/sfx-E-en.flac --lang en --shelf on
"$PY" qc/qc.py check --kind final
"$PY" deliver/deliver.py --yes --remind "Selftest final" --due 2026-10-05T09:00
"$PY" deliver/deliver.py --yes > /dev/null      # second run: unchanged files are skipped

step "18 checks: mock-only ledger, outputs, one clock to the frame, VO rules, voices, lint, --help everywhere"
python3 - "$WS" <<'EOF'
import json, os, subprocess, sys; ws = sys.argv[1]
recs = [json.loads(l) for l in open(f'{ws}/ledger.jsonl') if l.strip()]
bad = [r for r in recs if r.get('provider') != 'mock' or (r.get('actualUsd') or 0) > 0 or (r.get('estimateUsd') or 0) > 0]
assert recs and not bad, f'non-mock / non-zero ledger records: {bad[:3]}'
need = ['stages/voice/options.json', 'stages/vo/lines.json', 'stages/vo/readcheck.json', 'stages/music/options.json', 'stages/music/demos/A-guide-en.mp3',
        'stages/music/beds/A-arranged.flac', 'stages/music/beds/A-ext.flac', 'stages/music/beds/A-arranged-en.flac', 'stages/sound/soundmap-ja.json',
        'stages/sound/sfx-A-ja.flac', 'stages/sound/sfx-E-en.flac', 'out/roughcut/short-16x9-ja.mp4', 'out/roughcut/short-16x9-en.mp4', 'out/qc/roughcut-check.json',
        'out/qc/final-check.json', 'out/final/short-16x9-en.mp4', 'out/deliver/reminder.json', 'assets/images/assistant.png', 'assets/footage/F1.mp4', 'out/qc/footage-F1.jpg',
        'stages/music/clock.json', 'stages/music/demos/B-guide-en.mp3', 'stages/music/demos/C-guide-en.mp3', 'out/qc/lint.json', 'stages/vo/picks.json']
miss = [p for p in need if not os.path.exists(os.path.join(ws, p))]
assert not miss, f'missing outputs: {miss}'
for k in ('roughcut', 'final'):
    r = json.load(open(f'{ws}/out/qc/{k}-check.json')); assert r['ok'], f'{k} QC failed'
    for f in r['files']: assert f['tp'] <= -1.55 and f['frames_ok'] and f['audio_ok'], f
# music-locked: ONE clock, to the frame: clock.json = option A's windows = its arrangement = scenes.json = timeline.json = the picture
clk = json.load(open(f'{ws}/stages/music/clock.json')); fps = clk['fps']; F = lambda t: int(round(t * fps))
oa = json.load(open(f'{ws}/stages/music/options/A.json')); arr = json.load(open(f"{ws}/{oa['bed']['arrangement']}"))
sj = json.load(open(f'{ws}/remotion/scenes.json')); tl = json.load(open(f'{ws}/timeline.json'))
assert sj['units'] == 'seconds', sj.get('units')
for s, w, a, p, t in zip(clk['scenes'], oa['windows'], arr['sections'], sj['scenes'], tl['scenes']):
    assert s['id'] == w['scene'] == a['scene'] == p['id'] == t['id']
    assert F(s['start']) == F(w['from']) == F(a['t0']) == F(t['from']), (s, w, a, t)
    assert s['frames'] == w['frames'] == F(a['t1']) - F(a['t0']) == F(p['len']) == F(t['len']), (s, w, a, p, t)
dur = lambda p: float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], capture_output=True, text=True).stdout)
assert abs(dur(f"{ws}/{oa['bed']['arranged']}") - clk['total']) <= 0.5 / fps, 'the arranged bed != the clock'
assert abs(dur(f"{ws}/{oa['demo']['guideVo']}") - clk['total']) <= 0.05 and oa['demo']['clock']['frames'] == clk['frames'], 'the demo != the clock'
lines = json.load(open(f'{ws}/stages/vo/lines.json')); starts = {s['id']: s['start'] for s in clk['scenes']}
for l in lines:
    assert l.get('at') is not None and (l.get('fit') or {}).get('status') in ('fits', 'overflow'), l
    tv = [v for v in tl['tracks']['vo'] if v['id'] == l['id'] and v['lang'] == l['lang']][0]
    assert F(tv['from']) == F(starts[l['sceneId']] + l['at']), (tv, l)
    if l['lang'] == 'en': assert abs(oa['demo']['vo_at'][l['id']] - (starts[l['sceneId']] + l['at'])) <= 0.5 / fps, 'demo VO placement != lines.json'
vo = json.load(open(f'{ws}/stages/vo/options.json'))[0]; pk = json.load(open(f'{ws}/stages/vo/picks.json'))
assert 'flags' in vo and 'ja_chars_per_min' in pk['stats'] and 'en_wpm' in pk['stats'], 'VO rules not reported'
mo = json.load(open(f'{ws}/stages/music/options.json')); assert [o['id'] for o in mo][:3] == ['A', 'B', 'C'] and sum(o['recommended'] for o in mo) == 1, mo
for k in 'ABC':
    o = json.load(open(f'{ws}/stages/music/options/{k}.json')); assert o['bed']['bpmMap'] and o['windows'] and o['demo']['guideVo'], k
assert len({b['bpm'] for b in json.load(open(f'{ws}/stages/music/options/B.json'))['bed']['bpmMap']}) > 1, 'the per-scene map collapsed'
vx = json.load(open(f'{ws}/stages/voice/options.json')); assert not any(x['id'].endswith(('-old-narrator', '-old-calm')) for x in vx), 'a retired voice was offered'
lint = json.load(open(f'{ws}/out/qc/lint.json')); assert lint['pass'], lint['rows']
rec = json.load(open(f'{ws}/out/qc/roughcut-short-16x9-ja.json')); st = {c['id']: c['status'] for c in rec['checks']}
assert st.get('music-clock') == 'pass' and st.get('lint-names') == 'pass', st
print(f"ledger: {len(recs)} records, all mock, $0 · outputs: {len(need)} present · QC ok · one clock: {clk['frames']} f, {len(clk['scenes'])} scenes, "
      f"{len(lines)} lines placed · VO flags: {len(vo['flags'])}")
EOF
step "18b lint catches leftovers, names, brand caps, integrations"
printf '%s\n' 'Ask Acme about the TODO list from the kickoff.' 'Hikari sends it on ExampleChat.' > "$WS/.tl-tmp/lint-bad.txt"
if "$PY" qc/lint.py --files .tl-tmp/lint-bad.txt > "$WS/.tl-tmp/lint-bad.out"; then echo "lint missed the planted violations"; exit 1; fi
for r in leftovers names brand-caps integrations; do grep -q "BAD lint-$r" "$WS/.tl-tmp/lint-bad.out" || { cat "$WS/.tl-tmp/lint-bad.out"; echo "lint missed: $r"; exit 1; }; done
"$PY" qc/lint.py > /dev/null     # out/qc/lint.json back to the real files
for s in voice/audition.py vo/generate.py vo/readcheck.py vo/post.py vo/pick.py music/v2m.py music/compose.py music/library.py music/analyse.py \
         music/arrange.py music/warp.py music/extend.py music/demo.py music/lock.py sfx/soundmap.py sfx/render.py sfx/generate.py mix/mix.py mix/remux.py \
         qc/qc.py qc/lint.py deliver/deliver.py deliver/reminder.py selftest/make_picture.py; do
  "$PY" "$s" --help > /dev/null || { echo "--help failed: $s"; exit 1; }
done
node "$HERE/images/generate.mjs" --help > /dev/null && node "$HERE/footage/seedance.mjs" --help > /dev/null
du -sh "$WS" | awk '{print "workspace size: " $1}'
echo "SELFTEST PASSED in $(( $(date +%s) - T0 )) s  ($WS)"
