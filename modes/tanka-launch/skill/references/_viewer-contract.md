# The canvas and the stage machine — what the director must know

Owned by the mode core (viewer + `tl.mjs`). This is how the producer's canvas and
the stage machine talk to you. The binding shapes are `references/contracts.md`;
this file adds what the viewer reads and sends.

## 1. How the producer's buttons reach you

The viewer never writes `film.json`. When the producer presses a button it does two
things:

1. writes a request to `requests/<id>.json`:
   `{ id, action: "pick"|"approve"|"autorun", stage, option, on, by: "producer", via: "canvas", requestedAt }`
2. sends you a message (a viewer notification). The first line is the verb:

| First line | Button | What you do |
|---|---|---|
| `confirm <stage> <option>` | Confirm on an option | `tl.mjs tick` (it applies the request as `pick <stage> <option> --by producer`), then build the next stage. **Do not also run the pick yourself.** |
| `approve <stage>` | Confirm on a stage without options, or on the rough cut | `tl.mjs tick`, then go on. For the rough cut: start the finals. |
| `autorun on` / `autorun off` | Auto-run to rough cut / Stop auto-run | `tl.mjs tick` (switches auto-run and picks every waiting stage's recommended option), then keep building stage after stage without waiting — up to the rough cut and the budget cap. |
| `more options: <stage>` | Try more options (with an optional note) | Make 1–3 sibling options with new ids; register the full list with `tl.mjs options set <stage> --file … [--keep-pick]`; open the stage (`navigate-to`) and say how each differs. |
| `changes: roughcut` | Ask for changes on the rough cut | Make the changes, re-render, QC, register the new cut as a new option (`v2`), show it. |
| `countdown: <stage>[, …]` or `pending requests` | the canvas saw a countdown run out (or clicks still waiting when it opened) | `tl.mjs tick`, read what it applied, carry on from the recommended option. |

`tl.mjs tick` applies requests and expired countdowns **in time order**: a
pick the producer made before a deadline wins even if the tick runs later. Every
mutating tl.mjs command (options set, pick, approve, autorun, mark, brief,
budget) applies what is due first and prints `applied: …` lines — read them.
Handled requests move to `requests/applied/` with their outcome.

**Start every turn with `tl.mjs tick`.** The viewer only asks when its tab is
open; a closed viewer's countdowns are applied by the next tl.mjs command.

## 2. What the viewer shows you (`<viewer-context>`)

Every ordinary message is prefixed with:

```
<viewer-context mode="tanka-launch" run="<run id>">
Run: "<title>" (<id>) · budget $x of $y · auto-run on|off · countdown N min
Stages: idea confirmed · script confirmed pick B · music awaiting 3 opt rec A 12:31 left · voice locked · …
Waiting on: music (awaiting)
Pending canvas requests: pick music A — run tl.mjs tick to record them.
On screen: stage 3 · Music & rhythm (awaiting)
Option in view: A "Ink pulse" (recommended); files: stages/music/options/A.json, …
Options: A*, B, C
Address: {"nodeId":"music:A"}
</viewer-context>
```

The statuses are computed by the same `lib/stage-state.mjs` tl.mjs uses, so
they agree with `tl.mjs status`. `CHANGED` is shouted: the producer confirmed a
different version of that stage.

## 3. Pointing the canvas (`navigate-to`)

`navigate-to` with `address.nodeId`:

| nodeId | Opens |
|---|---|
| `script`, `music`, … `deliver` | that stage's page |
| `<stage>:<optionId>` (`script:B`, `roughcut:v1`) | the page on that option |
| `version:<format>:<lang>` (+ `"time": 14.2`) | a version: storyboard, player at that second, timeline |
| `overview` | closes pages, frames the run |

Call it after `options set` (open the stage) and before you talk about a
scene or a cut problem (open the version at that second). The same address
works in a `<viewer-locator>` card. Deep link for the browser:
`…#tl=<nodeId>&t=<seconds>`.

## 4. What the viewer reads (so it can show it)

| Stage | Put here | Viewer shows |
|---|---|---|
| idea | `film.run.brief` (via `init` / `brief set`) | the idea, market, formats, languages, selling points, sources |
| script | `stages/script/options/<id>.json` (contracts §5) | the scene table: VO JA/EN, on-screen JA/EN, scene type, duration, info/anim density, transition; logline and `arc` (string or array) |
| music | `stages/music/options/<id>.json` with `bed.bpmMap[{from,to,bpm,feel}]` (seconds), `bed.key`, `bed.source`, `sfxSet`, `demo.music`, `demo.guideVo`, optional `notes` | two players (music only, with guide VO) and the BPM-over-time graph, with the picked script's scene boundaries |
| voice | one option **per voice**, with its `lang` (`voice/audition.py`); files `stages/voice/options/<lang>-<id>.json` (`{lang, voiceId, name, settings, sample}`) + the sample MP3. A stage whose options all carry `lang` takes **one pick per language**: the pick is the comma-joined ids (`ja-konoha,en-calm`), each language has its own recommended voice | audition players grouped by language, one radio per language; Confirm sends the set |
| vo | the option's file `stages/vo/takes-board.json`: one entry **per take** `{id, sceneId, lang, text, take, file, durS, picked, check}` (`vo/pick.py`). `stages/vo/lines.json` holds only the picked take per line: it is what the picture plays | take players per line, the picked take marked |
| assets | option JSON `{ items: [{ sceneId, kind, label, source: library\|figma\|codex\|fal, status: matched\|generated\|gap, file, note }] }` | a contact sheet; gaps are shown as gaps |
| picture, sound | option `preview` (an MP4: `out/picture/<key>.mp4`, `out/roughcut/<key>.mp4`) and files | the player |
| roughcut | options `v1`, `v2`… (preview = the lead version's MP4); files `timelines/<key>.json` + `out/qc/roughcut-<key>.json` of every rough-cut version | a version switcher, the player of `out/roughcut/<key>.mp4`, the QC record |
| finals | `out/final/<format>-<lang>.mp4` + `out/qc/final-<format>-<lang>.json` | the same, for finals |
| deliver | `stages/deliver/*.json` (copy report), stage notes | the report |

File paths inside a stage JSON may be workspace-relative (`stages/…`,
`assets/…`, `out/…`) or relative to that JSON's folder.

**QC record** (`out/qc/<roughcut|final>-<format>-<lang>.json`):
`{ format, lang, file, durationS, frames, lufs, truePeak, pass, checks: [{ id, status: pass|fail|unchecked, label, note? }], storyboard?: [{ sceneId, t, file }], notes? }`.
The version node shows "QC fail" when any check fails, whatever `pass` says.
Without `storyboard`, the viewer grabs one frame per scene from the MP4.

**Naming rule.** A version is `<key>` = `<format>-<lang>` (`short-16x9-en`,
`short-9x16-ja`, `short-16x9-en-jasub`): `out/picture/<key>.mp4` (the VO-only
master, `remotion/render.mjs`; its `.json` sidecar records the render scale —
the scale is never in a name), `out/roughcut/<key>.mp4`, `out/final/<key>.mp4`
(`mix/mix.py`), `out/qc/<roughcut|final>-<key>.json` (`qc/qc.py`),
`timelines/<key>.json`. A version node plays the final, else the rough cut,
else the picture.

**timeline.json / timelines/<key>.json** (contracts §5) — `render.mjs` writes
`"units": "frames"` and `fps`; units are frames unless the file says
`"units": "seconds"`. `timelines/<key>.json` is the version's own clock and
wins for that version; `timeline.json` merges every rendered version's
`formats` (keyed by `<key>`) and holds the lead version's scenes and tracks.
`mix/mix.py` fills the `bgm` and `sfx` lanes. VO and caption entries carry
`lang`; `en-jasub` shows EN VO and JA captions.

## 5. What makes a stage `changed`

A stage's approval hash covers: the picked option's record and its files
(text files by content, media by path only), plus the stage's own text files
under `stages/<stage>/` **outside** `options/`, plus what the stage produced:

- picture → `remotion/scenes.json`
- roughcut → `out/qc/roughcut*` (its versions' clocks enter as the option's
  files `timelines/<key>.json` — not the whole folder, which the finals'
  renders of other versions write into)
- finals → `out/qc/final*`

Sibling options (anything else in `options/`) are not hashed — "try more
options" never un-confirms a pick. Text means `.json .md .txt .srt .vtt`.
So: write everything an option needs **before** `options set`, and do not
rewrite `timeline.json` after the rough cut is approved unless the cut really
changed (that re-opens the gate, which is correct).

`tl.mjs hash <stage>` prints the hash and exactly which files went into it.

## 6. Settings the scripts can read

Pneuma writes the init params into the skill's `.env` (tl.mjs parses it, never
sources it): `ELEVENLABS_API_KEY`, `FAL_KEY`, `OPENROUTER_API_KEY`,
`FIGMA_TOKEN`, `TL_ASSET_ROOTS` (`;`-separated), `TL_PRD_ROOT`,
`TL_DELIVERY_DIR`, `TL_BUDGET_USD`, `TL_COUNTDOWN_MIN`, `TL_CODEX_PATH`,
`TL_MOCK` (`on`/`off`). `tl.mjs init` copies budget, countdown and mock into
`film.json.settings`; after that film.json is the truth (`budget set` changes
the cap, `mock on|off` the providers; a process-env `TL_MOCK` still wins). Template flags for `{{#flag}}…{{/flag}}` sections in skill text:
`mockEnabled`, `paidEnabled`, `elevenLabsConfigured` / `elevenLabsMissing`,
`falConfigured` / `falMissing`, `openrouterConfigured`, `figmaTokenConfigured`.
Never write a key value into skill text or the workspace.

## 7. tl.mjs extras beyond contracts §3

- `mark <stage> working|blocked|clear [--note]` — the canvas shows "working…"
  or the blocked note (and a red banner).
- `brief set --file brief.json [--by producer]` — merge into the brief; with
  `--by producer` the idea is re-confirmed (downstream goes stale).
- `budget set <usd>` — the producer's new cap.
- `hash <stage>` — the hash and its inputs.
- `approve <stage> --by producer` on a stage with options takes the only (or
  recommended) option — how "The producer said so in chat" is recorded.
- Exit codes: 0 ok · 1 usage/I-O · 2 refused by a stage rule · 3 over budget.
  Over budget also switches auto-run off and marks the stage blocked.
