---
name: pneuma-tanka-launch
description: >
  Launch Studio mode (tanka-launch): a launch-video studio that turns an idea or
  selling point the producer types into finished launch films (short 16:9 and
  9:16 by default, in JA, EN and EN with JA subtitles). Use for ANY task in this
  workspace: the brief, script options, music and rhythm, voice auditions, VO
  takes, assets (product UI, generated stills, Seedance footage), the Remotion
  picture, the sound map, SFX and mix, the rough-cut gate, finals, QC and
  delivery. Defines the eleven stages, the one-writer rule (every pick,
  approval and tick goes through tl.mjs), the 30-minute countdown and
  auto-run, the $60 budget ledger, mock mode, the pre-flight checklist and which
  reference to load per stage. Consult before your first action in a session.
---

# Launch Studio

In commands, `<SKILL_DIR>` is the directory containing this loaded `SKILL.md` (installed under `.claude/skills` for Claude Code, `.agents/skills` for Codex; use the path your instructions give). Keep shell paths quoted. Run the stage machine as `bun "<SKILL_DIR>/scripts/tl.mjs" <cmd>` (`node` works too) from the run workspace root.

## Scene

One run = one workspace = one launch's films. The producer types an idea; you take it through **idea → script → music → voice → vo → assets → picture → sound → ★ roughcut → finals → deliver**. Every stage leaves files the next is built from, never from your memory, and shows options on the canvas. The producer reviews asynchronously: their waiting time is the bottleneck, so each stage's options arrive fast, and each render is shown the moment it passes QC.

**Roles.** You direct everything: script, music arrangement, the Remotion picture, the audio pipeline, QC, assembly. **Codex** is called only by `scripts/images/` to make GPT Image 2 stills. **fal** is used only for Seedance footage (`scripts/footage/`). **ElevenLabs** provides TTS, Video-to-Music, music composition and optional SFX. Never call a provider except through the stage scripts.

## Viewer

The canvas is a node graph (idea → script options → music options → voice → VO → assets → one version node per format × language) with a stage page per node, a budget meter and a countdown chip. The exact payloads are in `references/_viewer-contract.md` (owned by the mode core; read it if present).

- **Read context first.** Every message carries a `<viewer-context>` block (the stage, node, option or version, playhead time, selection) and, after a click, `<user-actions>`. Go and look at what the producer points at before answering.
- **Their buttons don't reach you as commands.** Confirm, pick, approve and "Auto-run to rough cut" write `requests/*.json`, which `tl.mjs` applies on its next command. So **start every turn with `tl.mjs tick`** and read what it applied, then `tl.mjs status --json`.
- **Commands the producer can send** arrive as messages: `confirm-stage` (their pick is already queued in `requests/`: tick, then build the next stage), `auto-run` (queued the same way; confirm it with one line), `more-options` (build 1–3 more siblings for that stage and re-register with `--keep-pick` if they already picked), `countdown-expired` (tick applies it; carry on from the recommended option).
- **Show them what you mean:** the `navigate-to` action with `{ "nodeId": "<stage>" }`, `{ "nodeId": "<stage>:<optionId>" }`, `{ "nodeId": "version:<format>:<lang>", "time": 12.4 }` or `{ "nodeId": "overview" }`. Open a stage after registering its options, and a version at the second before describing a defect.
- A comment ("line 4 is too long", "the swoosh at 1:20 is too bright") is a revision request: fix, re-register the options, report.
- The viewer writes nothing else. You never write `film.json` or `ledger.jsonl`.

{{#mockEnabled}}**Mock providers are ON for this workspace:** no paid call will be made; every report says MOCK.{{/mockEnabled}}{{#elevenLabsMissing}} **No ElevenLabs key:** VO, music composition and V2M can't run for real; use library beds and say which stages wait for a key.{{/elevenLabsMissing}}{{#falMissing}} **No fal key:** no new Seedance footage; use the library and say so on the assets page.{{/falMissing}}

## One writer

`tl.mjs` is the only writer of `film.json` and `ledger.jsonl`. Every pick, approval, tick, brief change, auto-run switch and ledger row goes through it. Stage scripts write their own outputs; you write prose (`direction.md`, briefs, `stages/*/fixes.md`), option JSON before registering it, and the run's `remotion/` sources. Status is derived from file hashes: a stage whose files change after approval shows `changed`, and everything downstream `stale`.

- **`pick` records the approval hash in the same step.** So put everything an option needs in place *before* `options set`. If a pick forces you to write the stage's own output afterwards (e.g. a file only the picked option produces), write it right after the pick and run `tl.mjs approve <stage> --by auto --note "materialised pick <id>"` before any downstream work.
- `options set` clears the stage's pick and restarts its countdown (use `--keep-pick` only when the picked id is unchanged).
- A `changed` stage is not approved. Show the producer what changed, then re-register and re-pick.

## The stage loop

For each stage: **tick → build → register options → report in two lines → go on only when the stage is confirmed.**

| # | Stage | You produce | Options | Recommended | Load |
|---|---|---|---|---|---|
| 1 | idea | `stages/idea/brief.json` + `brief.html` | none: `init --idea`, then `brief set --file … --by producer` (their typed idea is the confirmation; list every assumed default on the page) | – | `launch-story` |
| 2 | script | 3 script options from 5 angles, JA + EN, storyboard fields | 3 | your pick (the use-case template unless the brief asks for a story film) | `launch-story`, `launch-storyboard`, `launch-rules` |
| 3 | music | 3 beds/arrangements with scene windows + guide-VO demo + SFX set | 3 | per-scene BPM if the brief asks for tempo changes, else one-grid density | `launch-music`, `launch-timeline`, `launch-sound-map` (planned), `style-presets` |
| 4 | voice | auditions on one sample line | 3–4 per language | the last approved voice per language | `launch-vo` |
| 5 | vo | 2 takes per line, read-checked, post-processed, fitted to the windows | 1 ("measured picks"); per-line overrides re-pick with `--prefer` | the measured picks | `launch-vo`, `launch-timeline` |
| 6 | assets | UI map, library matches, gaps (images, footage) | library-only vs library + generated | library first | `launch-product-ui`, `launch-footage`, `launch-rules` |
| 7 | picture | Remotion build, VO-only master per version | 1 (plus HTML prototypes only for a new special piece) | the build | `launch-motion`, `launch-storyboard`, `launch-timeline`, `launch-captions-l10n`, `launch-qc` |
| 8 | sound | measured sound map, SFX layer, mix = the rough cut | 1 | the mix | `launch-sound-map`, `launch-sfx`, `launch-mix-master`, `launch-qc` |
| ★ | roughcut | the lead format in each voiced language + its QC files | 1 | **hard gate: the producer only** | `launch-qc`, `launch-rules`, `launch-review-deliver` |
| 9 | finals | every format × language, final mix, QC | 1 | the producer's OK | `launch-captions-l10n`, `launch-mix-master`, `launch-music` (EN warp), `launch-qc` |
| 10 | deliver | verified copies in the delivery folder, reminder note, fallback kept | – | – | `launch-review-deliver` |

Load `references/guardrails.md` and `references/_open-questions.md` once per session. The review protocol per stage (what the producer decides, what defaults on timeout) is in `launch-review-deliver.md`.

## Options

- Each option is `{ id, title, summary, recommended, files, preview }` (`references/contracts.md` §1). **Exactly one is recommended**, and its `summary` says why in one line.
- Options differ in **one dimension** where possible, and the summary says what differs from its siblings and from the last pick.
- After a comment, keep a **"previous + the change"** option next to a bold rewrite (over-correction wasted four loops).
- Every option has a preview the viewer can play or render: an HTML table, an MP3, an MP4, a contact sheet. Build previews from stream copies so only the variable changes.
- Lint every option with `launch-rules.md` before registering. An option longer than the brief's length range isn't shown.
- Register: `tl.mjs options set <stage> --file stages/<stage>/options.json`. Then report: what exists, what it cost, the recommended one, and the countdown.

## Countdown and auto-run

- `options set` starts a **30-minute countdown** (`settings.countdownMin`) on stages 2–8. On expiry, the next `tl.mjs` command picks the recommended option (`pickedBy: auto-timeout`). A pick the producer made before the deadline wins, even if it was applied later.
- **Auto-run** (`autorun on`, or their button): every stage takes its recommended option as soon as its options are registered, up to the rough cut and never past it. A stage auto-run picked whose files you then revise (`options set --keep-pick` after an edit) is re-confirmed on the same pick at the next tl.mjs command; one the producer picked stays `changed` until they confirm. Keep building; report each stage as you pass it, because their judgement on the script beats four stages built on a wrong one.
- Don't wait idle on a countdown: while one runs, prepare the next stage's free work (analysis, prototypes, the animatic), but spend nothing and write nothing into a stage that depends on the pending pick.
- Nothing is lost when the viewer is closed: tick applies expired deadlines and queued clicks in time order.

## The rough-cut hard gate

The rough cut is the lead format (first in `brief.formats`) in each voiced language, lead language first, with VO + music + SFX and passing QC (`out/qc/roughcut-check.json` + `roughcut-review.json`). Register it as one option. **Only the producer approves it**: via their button (a request), or when they say so in chat, `tl.mjs approve roughcut --by producer --note "<their words>"`. Countdowns and auto-run never pass it. Finals, the other formats and languages, and delivery start only after it. Finals need their OK too before `deliver`.

## Budget and paid calls

- **Cap: `settings.budgetUsd`, default $60 per run.** Soft split (an editable default): footage ≤ $25, music ≤ $10, voice + VO ≤ $10, images ≤ $5, reserve $10.
- **Every paid call is reserved before and committed after**: `tl.mjs ledger reserve --stage <s> --provider <p> --what "<desc>" --usd <estimate>` → the request → `tl.mjs ledger commit <id> --usd <actual> --request-id <rid> [--status failed]`. The stage scripts do this themselves (`scripts/common/paid.*`); if you make any other paid call (e.g. a 21st.dev `get_component`), you reserve and commit it yourself.
- **Exit 3 = over the cap.** Stop, `tl.mjs mark <stage> blocked --note "budget: …"`, and ask the producer to raise the cap (`budget set`) or skip the call. This holds during auto-run.
- A failed call is committed as `failed` with what it cost; it is never retried silently. A second take needs a named fix; a third needs the producer's yes.
- **If the permission system denies a paid call** (it can deny a TTS call even after the producer's chat approval), stop. Never route around it. Hand the producer the exact one-line command to run themselves, and continue with free work.
- Quote costs in dollars from the ledger (`ledger summary`), and say which are estimates.

## Mock mode

`settings.mock` in film.json, or env `TL_MOCK`: every paid script writes a local stand-in (a local TTS for VO: macOS `say` or espeak-ng; the procedural placeholder beds of the seed library for music; gradient stills and test clips for images and footage) and records `provider: "mock"`, $0. Say "MOCK" in every report and on every option summary; a mock render is never called a rough cut of the real film. `TL_NO_NETWORK=1` turns any real provider call into an error (the selftest uses it).

- **Where the label comes from.** `tl.mjs init` copies the *Mock providers* init param (the skill `.env`'s `TL_MOCK`) into `film.json settings.mock`; after that film.json is the truth. An explicit `TL_MOCK` in the process environment (a shell, the selftest) overrides it; `TL_MOCK=off|0|false` means off.
- **A real run turns it off from settings**, not by editing files: `tl.mjs mock off` (or `mock on` for a rehearsal). `tl.mjs status` shows `MOCK providers` while it is on. Changing the Pneuma init param later does not change a running film; `mock off` does.
- Keys: scripts read `ELEVENLABS_API_KEY` / `FAL_KEY` / `OPENROUTER_API_KEY` / `FIGMA_TOKEN` from the environment, else from the installed skill's `.env` (Pneuma writes it from the init params). Never print, echo or `cat` that file.

## Pre-flight (start of every run; re-check before the first paid call and the first render)

- [ ] `tl.mjs status`: keys present for what this run needs (never print them); mock on/off as intended; budget and countdown set.
- [ ] Disk: `df` ≥ 5 GB free to start (stop below 1.5 GB); one lean bundle per round; nothing writes into a bundle's `public/`.
- [ ] Tools: ffmpeg/ffprobe, rubberband, whisper.cpp + a model (large-v3 by default; `$WHISPER_MODEL` / `$TL_WHISPER_MODEL` name another: if it is missing, the read check says "unavailable" and you listen instead), Python venv (`scripts/setup-python.sh`), Remotion deps in `remotion/` (`npm install` there once), fonts (SF Pro / Hiragino on macOS; Inter / Noto Sans JP / Noto Serif JP on Linux). Mock VO uses `say` on macOS, espeak-ng on Linux.
- [ ] Market rules loaded (`launch-rules.md`); the brand rule (`run.brief.brand`, else the style preset); the per-language pronunciation dictionary (`run.brief.pronunciation`); the assistant / persona name if the film shows one (`brand.assistantName`: ask the producer, never assume); text-only cut on or off (`textOnly`, off by default); length range per edition; SHORT = FULL ending earlier.
- [ ] `style-presets.md` read fresh (music palette + negatives, JA/EN presets, brand); `_open-questions.md` defaults noted; no rejected brief reused.
- [ ] Sources: design access (`figmaToken` or PNG exports), PRD paths, asset roots, the product's logo and any character reference, the voice pool (`common/voices.json`: real voice ids before a non-mock run), the seed music/SFX library.
- [ ] Delivery dir exists (`settings.deliveryDir`, else `~/LaunchStudio/deliveries`); the previous final for this film, if any, is known and kept as the fallback.
- [ ] Licences flagged in the brief: the music provider's terms for the intended use, a performing-rights society for a venue that needs one, the Remotion licence for your organisation, font licences.

## Rules that span stages

1. **The latest dated direction wins, and you say which version you apply.** Contested rules are written as "Current rule (date) / Superseded" in the references; defaults for open questions are in `_open-questions.md`. When the producer reverses a rule, record it in the run's `direction.md` with their words and date.
2. **Real product UI only**; every claimed feature has a PRD or Figma source.
3. **Pipeline order:** script → music → voice → VO → picture fitted to both (music-locked); VO-locked is the fallback. **One clock:** the picked music option's windows (`common/clock.py`) are what the demo plays, what `vo/pick.py` fits the lines into and what `music/lock.py apply` writes into `scenes.json`; no script re-derives scene lengths from the script's `durationS` once music is picked.
4. **Exemplar first:** the lead version goes through QC and to the producer first; the rest follow its approved rhythm.
5. **Send each render the moment it passes QC**; never batch. Navigate the viewer to it and say one line.
6. **Fork, never edit what is approved**; never overwrite a delivered file or the fallback.
7. **Look before you claim.** Open the contact sheets and boundary sheets yourself; a check you didn't run is `unverified`. You can't listen: audio verdicts are measurements plus the producer's ears, never an LLM's opinion.
8. **Report** per stage: what exists (paths), what it cost, what's mock, what's unverified, what's running.

## Stage commands (the short path; each script's `--help` has the rest)

`PY="<SKILL_DIR>/scripts/py"`, `TL="bun <SKILL_DIR>/scripts/tl.mjs"`, run from the workspace root. `LEAD` = the brief's first format (e.g. `short-16x9`); `LANGS` = its voiced languages.

| Stage | Build → register |
|---|---|
| idea | `$TL init --idea "<their words>" --market … --formats … --languages …`, then `stages/idea/brief.json` + `brief set --file … --by producer` |
| script | write `stages/script/options/{A,B,C}.json` (contracts §5: `scenes[{id, durationS, vo{en,ja}, onScreen{en,ja}, sceneType, density{info,anim}, transitionOut}]`, `sceneType` = a kit scene type) + `stages/script/options.json` (`files: ["stages/script/options/A.json"]`) → `$TL options set script --file stages/script/options.json` |
| music | `$PY music/library.py options --lang <lead lang> --register` (the standard three: A one-grid density, B per-scene BPM, C contrast bed; each on its own clock = scene windows of whole bars, arranged, with music-only + guide-VO demos; recommended per the brief). After the producer's pick: `$PY music/lock.py apply` (the picked windows become the scene windows: `stages/music/clock.json`, and `remotion/scenes.json` lens once it exists) |
| voice | `$PY voice/audition.py --n 3 --register` (the pool = `launch-vo.md`'s current voices; superseded ones only with `--include-retired`) — one option per voice with its `lang`: the stage takes **one pick per language**, comma-joined (`tl.mjs pick voice ja-narrator,en-calm`); auto-run / timeout take each language's recommended voice |
| vo | `$PY vo/generate.py` → `$PY vo/readcheck.py` → `$PY vo/post.py` → `$PY vo/pick.py --register` (`stages/vo/lines.json` = the picked take per line, placed in its music window (`at`, `fit`), what the picture plays; `takes-board.json` = every take for the page; overruns, JA > EN + 25 % and density flags land in the option's `flags` + summary — fix them before confirming) |
| assets | write `stages/assets/options/{A,B}.json` (`{items:[{sceneId, kind, label, source, status, file, note}]}`: library matches from the asset roots (`settings` / init param `assetRoots`; the item's `file` must be a workspace path the canvas can show: copy a still or thumbnail under `assets/library/`, name the source path in `note`); gaps via `images/generate.mjs` / `footage/seedance.mjs`) + options.json → `options set assets` |
| picture | write `remotion/scenes.json` from the picked script (start from the seed example, `"units": "seconds"`), then `$PY music/lock.py apply` (every scene's `len` = its music window, frame-exact; never hand-edit those lens) and `$PY music/lock.py check` (scene frames, lines vs windows) (scene types and props: `<SKILL_DIR>/kit/README.md`; `node remotion/scripts/link.mjs` copies the kit into `remotion/kit/` — render.mjs runs it too; the product's own UI is a custom scene in `remotion/src/custom/`) (every boundary a named hand-off, launch-motion R1: set a scene's `transitionOut` — `carry` · `slide` · `handoff` — where the kit type's default is not the one the script names) → `cd remotion && node render.mjs <LEAD>-<lang>,… --scale 0.5` (the rough-cut versions, ONE bundle for all) → look at `$PY qc/qc.py sheets --video out/picture/<key>.mp4` → register one option `{id:"A", files:["out/picture/<key>.json",…], preview:"out/picture/<LEAD>-<lead lang>.mp4"}` |
| sound | `$PY sfx/soundmap.py` → `$PY sfx/render.py` (the music option's SFX set) → `$PY mix/mix.py --kind roughcut --format <LEAD>` (every language; writes the music + SFX lanes into `timelines/`) → register one option, preview `out/roughcut/<LEAD>-<lead lang>.mp4` |
| ★ roughcut | write `out/qc/roughcut-review.json` rows (what you checked by eye) → `$PY qc/qc.py all --kind roughcut` (per-version records `out/qc/roughcut-<key>.json` + sheets + storyboard + the text-lint rows (names, brand display form, integrations, kit leftovers) + the music-clock row) → open the sheets → register `v1` with `files: ["timelines/<key>.json", "out/qc/roughcut-<key>.json", …]` for every rough-cut version, preview the lead → **stop; only the producer approves** |

**Naming rule** (every script, `render.mjs` and the canvas): a version is `<format>-<lang>` (`short-16x9-en`, `short-9x16-ja`, `short-16x9-en-jasub`); its files are `out/picture/<key>.mp4` (+ `.json` sidecar with the render scale), `out/roughcut/<key>.mp4`, `out/final/<key>.mp4`, `out/qc/<roughcut|final>-<key>.json`, `timelines/<key>.json`. The scale is never in a name. Clocks (`timeline.json`, `timelines/*`) are in **frames** (`"units": "frames"`, `fps`); `remotion/scenes.json` is in seconds (`"units": "seconds"`).

## Scripts

Each script's `--help` is authoritative. Paths are under `<SKILL_DIR>/scripts/`. Run `.mjs` scripts with `bun` (or `node`) and Python stage scripts through the wrapper, which finds a Python with numpy + scipy: `"<SKILL_DIR>/scripts/py" <area>/<script>.py [args]` (first time: `setup-python.sh`). Every stage script takes `--ws <workspace>` or finds `film.json` from the working directory.

| Path | Use |
|---|---|
| `tl.mjs` | the stage machine: `init`, `status [--json]`, `tick`, `options set`, `pick`, `approve`, `autorun on\|off`, `mark <stage> working\|blocked\|clear`, `brief set`, `budget set`, `mock on\|off`, `hash <stage>`, `ledger reserve\|commit\|summary` |
| `lib/stage-state.mjs` | the derived-status algorithm shared with the viewer |
| `common/paid.mjs`, `common/paid.py` | the budget gate every paid script uses; `common/prices.json` the estimate table; `common/voices.json` the audition pool |
| `voice/audition.py` | 3–4 voices per language on one sample line |
| `vo/generate.py`, `vo/readcheck.py`, `vo/post.py`, `vo/pick.py` | takes → local whisper read check → JA/EN post → measured picks + `lines.json` |
| `music/library.py`, `compose.py`, `v2m.py` | beds: seed library (list/fit/options), ElevenLabs composition plans, Video-to-Music |
| `music/analyse.py`, `arrange.py`, `demo.py` | grid/key/sections; the arrangement (per-scene BPM or one grid; `feel` half/double; tempo ramps / feel instead of collapsing short windows); guide-VO demos in the option's windows |
| `music/lock.py`, `common/clock.py` | the ONE clock: `show` / `apply` (clock.json + scenes.json lens) / `check`; the window builder every music, VO and QC script uses |
| `music/warp.py`, `extend.py` | EN-from-JA warp; locked-bed extension by beat loops |
| `sfx/soundmap.py`, `sfx/render.py` | the sound map; the SFX layer (Set A / E, pitch-snap, quantise, word guard) |
| `mix/mix.py`, `mix/remux.py` | mix + true-peak master; remux onto the picture |
| `images/generate.mjs`, `footage/seedance.mjs` | Codex GPT Image stills (OpenRouter fallback); one Seedance clip via fal |
| `qc/qc.py`, `qc/lint.py` | `check`, `seams`, `sheets`, `footage`, `all`, `lint`; the text lint (roles-only names unless `run.brief.allowNames`, the brand display form, non-integrated services, kit-default leftovers) |
| `deliver/deliver.py`, `deliver/reminder.py` | copy finals + fallback + note; reminder hook (stub: records it only) |
| `setup-python.sh`, `py/` | the Python environment for the audio scripts |

## References

| Stage / topic | File |
|---|---|
| Viewer payloads and actions | `references/_viewer-contract.md` |
| Files, disk, jobs, direction, keys | `references/guardrails.md` |
| Defaults for open questions | `references/_open-questions.md` |
| Music palette and negatives, JA/EN presets, brand, subtitle and motion blocks | `references/style-presets.md` |
| Brief, angles, scripts, positioning, manifesto lines, VO density | `references/launch-story.md` |
| Brand and market lint (every gate) | `references/launch-rules.md` |
| Shots, sources, focal elements, gaze | `references/launch-storyboard.md` |
| Voice auditions, takes, read check, JA/EN post | `references/launch-vo.md` |
| Music-locked and VO-locked clocks, holds, editions | `references/launch-timeline.md` |
| Codex stills, Seedance, continuity | `references/launch-footage.md` |
| The product's real UI: sources, custom scenes, porting a frame | `references/launch-product-ui.md` |
| Hand-offs, seams, type screens, grounds, 21st.dev | `references/launch-motion.md` |
| The animation / rhythm / density map | `references/launch-sound-map.md` |
| Beds: V2M, composition plans, per-scene BPM, one-grid, EN warp, extension, licence | `references/launch-music.md` |
| SFX sets, signature moments, word guard | `references/launch-sfx.md` |
| Levels, duck, typing margin, master, remux | `references/launch-mix-master.md` |
| Captions, brand caps, JA/EN variants | `references/launch-captions-l10n.md` |
| QC checks and sheets | `references/launch-qc.md` |
| Option pages, review protocol, delivery | `references/launch-review-deliver.md` |
