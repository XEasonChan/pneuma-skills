# Shared contracts (all agents code against these)

Canonical copy (installed with the skill, so the director can read it in a run workspace). `docs/contracts.md` in the studio repo points here.

Paths are relative to a run workspace unless noted. `<SKILL>` = the installed skill dir (`mode/skill` in the repo).

## 1. film.json (owned by `tl.mjs`; others read it, and write only through `tl.mjs` commands)

```jsonc
{
  "schema": 1,
  "run": { "id": "2026-w40-launch", "title": "…", "createdAt": "ISO", "brief": {
      "idea": "text the producer typed",
      "market": "us|jp|both", "formats": ["short-16x9","short-9x16"], "languages": ["ja","en","en-jasub"],
      "sellingPoints": ["…"], "sources": { "figma": ["fileKey[:node]"], "prd": ["path"] } } },
  "settings": { "budgetUsd": 60, "countdownMin": 30, "mock": false },
  "stages": {
    "<stageId>": {
      "state": "empty|working|options|confirmed|auto|done|blocked",   // stored hint; derived status wins (see §2)
      "options": [ { "id": "A", "title": "…", "summary": "…", "recommended": true,
                     "files": ["stages/script/options/A.json"], "preview": "stages/script/options/A.html|mp3|mp4" } ],
      "pick": "A",                      // null until confirmed or auto-picked
      "pickedBy": "producer|auto-timeout|auto-run",
      "deadline": "ISO|null",           // set when options become ready; cleared on pick
      "approval": { "hash": "sha256 of the stage's files at approval", "at": "ISO", "by": "producer|auto" },
      "notes": "free text from the producer's comments"
    }
  },
  "autoRun": { "enabled": false, "until": "roughcut" }
}
```

Stage ids in order: `idea, script, music, voice, vo, assets, picture, sound, roughcut, finals, deliver`.

- `roughcut` is the hard gate. It can only be approved by the producer, never by auto-run.
- A countdown expiring, or `autoRun`, never passes `roughcut`.

## 2. Derived status (one algorithm, used by `tl.mjs` and the viewer: `<SKILL>/scripts/lib/stage-state.mjs`, pure ESM, no Node-only APIs in the pure part)

`status(stage) ∈ { locked, empty, working, awaiting, confirmed, changed, stale, done }`

- `locked`: an upstream stage isn't confirmed.
- `awaiting`: options are ready, there's no pick, and the deadline is running.
- `changed`: the current hash of the stage files ≠ `approval.hash`.
- `stale`: an upstream stage is `changed`, or was re-picked after this stage was approved.

## 3. tl.mjs CLI (`bun <SKILL>/scripts/tl.mjs <cmd>`; Node ≥ 18 must also work)

```
init --idea "<text>" [--market us] [--formats …] [--languages …]
status [--json]                         # derived status of every stage + budget + deadlines
options set <stage> --file options.json # register options (array per §1), sets deadline = now + countdownMin
pick <stage> <optionId> [--by producer|auto-timeout|auto-run]
approve <stage> [--by producer]           # records hash; roughcut requires --by producer
tick                                     # apply expired deadlines (pick recommended), print what changed
autorun on|off
ledger reserve --stage <s> --provider <p> --what "<desc>" --usd <estimate>   # exit 0 + prints {id} if within cap; exit 3 if it would exceed the cap
ledger commit <id> --usd <actual> [--request-id <rid>] [--status done|failed]
ledger summary [--json]
```

## 4. ledger.jsonl (append-only)

`{"id","ts","stage","provider":"elevenlabs|fal|openrouter|codex","what","estimateUsd","actualUsd","status":"reserved|done|failed","requestId"}`

- Every paid script calls `ledger reserve` BEFORE the request, and `commit` after it.
- In mock mode (`settings.mock` or env `TL_MOCK=1`) scripts skip the provider, write a stand-in and record `provider:"mock"` with 0 USD.

## 5. Stage artifacts

- `stages/script/options/<id>.json`: `{ id, title, logline, arc, scenes:[{ id, durationS, vo:{en,ja}, onScreen:{en,ja}, sceneType, density:{info,anim}, transitionOut }] }`
- `stages/music/options/<id>.json`: `{ id, title, kind?, bed:{ source:"v2m|compose|library", file, bpmMap:[{scene,from,to,bpm,feel,role,join?}], key, licenceSafe?, arranged?, arrangement? }, windows:[{scene,from,to,len,frames,bars,beats,bpm}], clock:{fps,total,frames}, sfxSet:"A|E|…", demo:{ music:"…mp3", guideVo:"…mp3", byLang, clock, vo_at, overruns } }` — `windows` are seconds on the frame grid; `bpmMap` from/to = `windows`; `bpm` is the grid tempo, `feel` the drums on it (half ≈ bpm/2, double ≈ 2×bpm)
- `stages/music/clock.json` (`music/lock.py apply`): `{ source:"music:<id>", option, fps, total, frames, scenes:[{id,start,end,len,frames}] }` — the picked option's windows, the ONE scene clock; `remotion/scenes.json` `len` per scene is written from it
- `stages/voice/options/<lang>-<id>.json`: `{ lang, voiceId, name, settings, sample:"…mp3" }`; one option per voice, each with `lang`; the voice pick is one per language, comma-joined (`ja-konoha,en-calm`)
- `stages/vo/lines.json`: `[{ id, sceneId, lang, text, take, file, durS, words:[{text,start,end}], at, window:{from,to,len,frames}, fit:{status:"fits|overflow", margin_s}, jaOverEn? }]` — `at` = seconds from the scene start (the kit plays the line there)
- `stages/vo/picks.json`: `{ clock, lines:[…], flags:[{rule:"fit|ja-en|density", id?, lang, note}], stats:{runtime_s, ja_chars_per_min, en_wpm, …} }`; the same `flags` sit on the VO option row
- `timeline.json` + `timelines/<format>-<lang>.json` (written by the picture render; `mix.py` fills bgm/sfx). Units: frames at `fps`, declared:

  ```jsonc
  { units:"frames", fps:30, lead:"short-16x9-en", formats:{ "short-16x9-en":{ width:1920, height:1080, frames, format:"short-16x9", lang:"en", comp:"short-16x9-en" } },
    scenes:[{ id, from, len }],
    tracks:{ vo:[{ from, dur, id, lang }], bgm:[{ from, dur, file }], sfx:[{ t, id, group }], captions:[{ from, dur, text, lang }] } }
  ```
- Naming rule: `out/picture/<format>-<lang>.mp4` (+ `.json` sidecar with the render scale; never a scale suffix), `out/roughcut/<format>-<lang>.mp4`, `out/final/<format>-<lang>.mp4`, `out/qc/<roughcut|final>-<format>-<lang>.json` (the canvas QC record), `out/qc/<…>.json|jpg`

## 6. Scene grammar (launch-kit → run's remotion/)

`remotion/scenes.json`: `{ units:"seconds", fps, formats:[…], languages:[…], scenes:[{ id, type, from?, len, props }] }` (`units:"frames"` is accepted). Types are exported by `launch-kit` (`<SKILL_DIR>/kit`) with typed props:

- text-screen
- logo-lockup
- footage-card

The product's own UI and any other scene are custom scene components the agent adds in `remotion/src/custom/` (`defineScene`), used by their `type` like the kit's.

VO and captions come from `stages/vo/lines.json`.

## 7. Guardrails every script follows

- Never print or write keys. Read them from env vars set by Pneuma's init params: `ELEVENLABS_API_KEY`, `FAL_KEY`, `OPENROUTER_API_KEY`, `FIGMA_TOKEN`.
- Never write outside the workspace, except `deliver` into `deliveryDir`.
- Every render or mix script verifies its output: frames, duration, LUFS/TP.
