# Launch run

This folder is one launch-video run. Open it in Pneuma with the Launch Studio
mode and type the idea or selling point in the chat.

## How a run moves

1. **Idea** — what you typed, plus a structured brief (market, formats, languages, selling points, sources).
2. **Script** — three options: scenes, VO per scene (JA/EN), on-screen text.
3. **Music & rhythm** — three beds with a per-scene BPM map, each with a guide-VO pacing demo.
4. **Voice** — three or four auditions per language.
5. **VO** — two takes per line, read-checked, best take picked.
6. **Assets** — UI screens, footage and images per scene; gaps filled by an image model or Seedance.
7. **Picture** — the Remotion build, locked to the music clock.
8. **Sound** — sound map, SFX and the mix.
9. **★ Rough cut** — the one hard gate. Nothing past it runs until you approve it.
10. **Finals** — every format × language, mastered and checked.
11. **Deliver** — copied to the delivery folder (`<deliveryDir>/<run>/`), with a reminder note.

Stages 2–8 each wait 30 minutes (configurable) for you to confirm an option on
the canvas. When the countdown runs out, the recommended option is taken.
**Auto-run to rough cut** takes every recommended option straight away. Paid
calls stop at the budget cap ($60 by default), even during auto-run.

## What lives here

| Path | What it is | Who writes it |
|---|---|---|
| `film.json` | the stage machine: options, picks, countdowns, approvals | `tl.mjs` only |
| `ledger.jsonl` | every paid call, priced before and after | `tl.mjs ledger` only |
| `stages/<stage>/` | each stage's options, previews and reports | the director |
| `requests/` | your button presses from the canvas, waiting for `tl.mjs tick` | the canvas |
| `assets/` | links and copies from the asset library, generated images and footage | the director |
| `remotion/` | this run's Remotion project (imports `launch-kit`, copied from the skill into `remotion/kit/`) | the director |
| `timeline.json` | the assembled clock the canvas draws its timeline from | the director |
| `out/` | rough cuts, finals, QC sheets | the director |

Status is never stored: the canvas and `tl.mjs status` derive it from the
files. If a file changes after you confirmed its stage, that stage shows
**changed** and everything after it **stale**.
