# Launch Studio (`tanka-launch`)

A Pneuma mode that turns an idea or a selling point into finished launch videos. The agent directs the whole run — script,
music and rhythm, voice, VO, assets, picture, sound, rough cut, finals, delivery — and every stage lands on a node canvas as
options the producer can play, compare and confirm. Short 16:9 and 9:16 films in JA, EN and EN with JA subtitles by default;
any format × language the brief asks for.

The mode id is `tanka-launch` (the display name is **Launch Studio**). It is a generic engine: it ships no brand, no product UI,
no characters and no music. A run brings its own brand rule, logo, product screens and voices.

## Stages

| # | Stage | What the agent produces | Options |
|---|---|---|---|
| 1 | idea | a structured brief from the typed idea (market, formats, languages, selling points, sources, brand rule) | – (the typed idea is the confirmation) |
| 2 | script | 3 script options from 5 angles, JA + EN, with storyboard fields | 3 |
| 3 | music | 3 beds / arrangements (one-grid density · per-scene BPM · contrast bed), each on its own clock of whole bars, with a guide-VO demo | 3 |
| 4 | voice | 3–4 auditions per language on one sample line | per language |
| 5 | vo | 2 takes per line, local read check (whisper.cpp), post-processing, fitted into the music windows | 1 (measured picks) |
| 6 | assets | a UI map, library matches, and gaps filled by generated stills (Codex) or Seedance footage (fal) | library-only vs library + generated |
| 7 | picture | the Remotion build from `scenes.json` (the kit's scene grammar + the run's custom scenes), a VO-only master per version | 1 |
| 8 | sound | a measured sound map, a procedural SFX layer voiced to the bed, the mix | 1 |
| ★ | roughcut | the lead format in each voiced language, QC'd | **hard gate** |
| 9 | finals | every format × language, final mix, QC | 1 |
| 10 | deliver | verified copies in the delivery folder, the previous final kept as a fallback, a reminder note | – |

The music comes before the voice: the picked bed's windows are the film's one clock, and the VO and the picture are fitted to it
(VO-locked timing is the fallback).

## The rules the stage machine enforces

- **One writer.** `skill/scripts/tl.mjs` is the only writer of `film.json` and `ledger.jsonl`. The canvas never writes them: a
  button drops a request into `requests/`, and the next `tl.mjs tick` applies it.
- **Derived status.** Only approvals (with a hash of the stage's files) are stored; every status is derived by
  `skill/scripts/lib/stage-state.mjs`, which the viewer imports too. A file edited after approval shows `changed`, everything
  downstream `stale`.
- **Countdown.** `options set` starts a countdown on stages 2–8 (30 min by default, `countdownMin`). When it runs out, the next
  `tl.mjs` command takes the recommended option. A pick made before the deadline wins.
- **Auto-run.** "Auto-run to rough cut" takes every recommended option as soon as it is registered — up to the rough cut, never past it.
- **The hard gate.** Only the producer approves the rough cut (`--by producer`); no countdown or auto-run passes it. Finals and
  delivery start after it.
- **Budget.** Every paid call is reserved before and committed after (`tl.mjs ledger reserve|commit`); `budgetUsd` ($60 by default)
  is a hard cap — a reservation past it exits 3 and the run stops and asks, even during auto-run.

## Providers

| Provider | Used for | Setting |
|---|---|---|
| ElevenLabs | TTS (auditions, VO), Video-to-Music, music composition plans, optional SFX | `ELEVENLABS_API_KEY` |
| fal | Seedance footage | `FAL_KEY` |
| Codex CLI | stills (GPT Image) | `codexPath` (uses the CLI's own login) |
| OpenRouter | optional image fallback | `OPENROUTER_API_KEY` |
| Figma REST | optional export of the product's design frames | `FIGMA_TOKEN` |

Keys are set in Pneuma's settings (init params mapped to the skill's `.env`); the scripts read them by name and never print them.
Local tools: ffmpeg/ffprobe, rubberband, whisper.cpp with a model, Python 3 with numpy + scipy (`skill/scripts/setup-python.sh`),
Node or Bun, and `npm install` once in a run's `remotion/`.

## Mock mode

Turn on the **Mock providers** init param (or `tl.mjs mock on`, or `TL_MOCK=1`) to rehearse a whole run for $0: VO comes from the
local TTS (macOS `say`, espeak-ng on Linux), music from the seed library's procedural placeholder beds, stills and footage from
ffmpeg gradients and test clips, SFX from the procedural kit. Every ledger row is `provider: "mock"` at $0 and every report says MOCK.
`TL_NO_NETWORK=1` turns any real provider call into an error.

## Selftest

The selftest drives every stage script end to end in mock mode on a tiny two-scene fixture (JA + EN): music options and the clock
lock, voice auditions, VO takes, the read check, post and pick, a picture stand-in, demos, V2M / compose mocks, arrangement, bed
extension with seam QC, the EN warp, the sound map, both SFX sets, the rough-cut mix, QC and the text lint, image / footage mocks,
finals, a mock delivery and the reminder stub — then checks that the ledger is mock-only, that one clock holds to the frame across
`clock.json`, the arrangement, `scenes.json`, `timeline.json` and `lines.json`, and that every script answers `--help`.

```sh
bash modes/tanka-launch/skill/scripts/selftest.sh            # a fresh temp workspace
bash modes/tanka-launch/skill/scripts/selftest.sh /tmp/tl    # or a folder of your choice
```

It needs ffmpeg, rubberband, a Python with numpy + scipy, a local TTS (`say` or espeak-ng) and, for the read check, whisper.cpp
(`whisper-cli` + a model; without one the read check reports "unavailable"). It sets `TL_MOCK=1` and `TL_NO_NETWORK=1` and unsets
every provider key. The stage machine's own tests run with `bun test modes/tanka-launch`.

## Layout

```
manifest.ts, pneuma-mode.ts   the mode (pure-data manifest; viewer binding + viewer context)
viewer/                       the node canvas, stage pages, version pages (player, storyboard, timeline), settings
  fixtures/build-fixture.mjs  builds a demo run through the real tl.mjs (fresh | midway | roughcut | changed | final)
skill/SKILL.md                the director skill: stages, gates, budget, countdown, mock mode, pre-flight, per-stage references
skill/references/             one reference per stage + style presets (editable examples) + open questions with defaults
skill/scripts/                tl.mjs + lib/ (stage machine), music/ voice/ vo/ sfx/ mix/ qc/ images/ footage/ deliver/, selftest
skill/kit/                    launch-kit: the Remotion scene grammar, renderer, captions, ground, hand-offs, generic scenes
skill/seed-library/           procedural placeholder music cards (synthesised on first use) and the optional SFX sample slots
seed/                         a fresh run: film.json, README, .gitignore, the run's Remotion project (render.mjs, scripts/link.mjs)
__tests__/                    stage machine, budget CLI, tick / auto-run, manifest ↔ watcher agreement
showcase/                     launcher gallery (screenshots of the viewer over the fixture run)
```

## Placeholders

Nothing in the mode is a real brand asset. The kit's assets are two plain SVG shapes (`skill/kit/assets/PLACEHOLDERS.md`); music
beds are synthesised by `skill/scripts/common/placeholder_beds.py`; SFX are procedural; mock stills, clips and voices are generated
at run time. The style presets (`skill/references/style-presets.md`, `skill/scripts/common/style.json`), the market rule presets
(`skill/references/launch-rules.md`) and the voice pool (`skill/scripts/common/voices.json`, whose voice ids are `REPLACE_…`
placeholders) are editable examples. The example brand used by the seed and the fixtures is a fictional product, **ACME**.
