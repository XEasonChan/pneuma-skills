# launch-qc: verify every render before anyone sees it

**Load at:** `picture` (VO-only masters), `sound`/`roughcut` (the rough cut), `finals` (every deliverable). Reload on "QC", "check the render", "穿帮".

**Reads:** the render, its comp's expected frame count, `timeline.json`, the audio source files, the previous draft (for identity checks). **Writes:** `qc/qc.py check --kind roughcut|final` → `out/qc/<kind>-check.json` (frames, audio length, LUFS/TP after AAC, audio md5 for every MP4 in `out/<kind>/`); `qc.py sheets` → `out/qc/<name>-sheet-1s.jpg` + `<name>-boundary-<t>.jpg`; `qc.py seams` → `<audio>-seams.json`; `qc.py footage` → `footage-<clip>.{jpg,json}`. You write the rows the script can't measure (captions, brand, continuity, z-order, rules, read check) into `out/qc/<kind>-review.json` = `{ rows:[{check, version, result, numbers, note}] }` with result `pass|fail|unverified`. The rough-cut and finals approvals hash files whose path starts with `out/qc/roughcut` / `out/qc/final`, so both files count; write them before registering those stages.

**No deliverable is shown, sent or delivered without its QC files.** A row you didn't check is `unverified`, never `pass`.

## Checks

| Check | How | Threshold |
|---|---|---|
| Frame count | `ffprobe -count_frames` vs the comp | equal |
| Audio length | `round(dur × 30)` | equals the frames |
| Loudness | `ebur128=peak=true` after AAC | VO master −14.3 LUFS; TP ≤ −1.6 dBTP (`qc.py`'s threshold) |
| Picture is the latest | picture md5 vs the verified render | equal (stale remux is the most common silent regression) |
| Identity, audio-only change | audio md5 vs source m4a; video stream copied | identical |
| Identity, region-only change | PSNR per frame outside the region | ≥ 45 dB |
| Shared-file edits | md5 of stills of other comps before/after | identical (render twice to prove noise) |
| Freeze / near-still | identical consecutive frames; < 20 px moving | 0 identical; near-still ≤ 0.6 s unless planned |
| Boundaries | 10 fps sheets ±0.6 s around every scene start | no seam, layer edge, double exposure, next-scene UI |
| Overview | 1 s contact sheet | text, glyphs, brand caps correct |
| Full vs short parity | same-moment stills, mean pixel diff | identical through shared scenes |
| 16:9 vs 9:16 | same-moment stills per scene | same content, re-laid out, nothing cropped off |
| Music joins | kick IOIs across a junction ≈ period; spectral flux z; 20 ms RMS step | within the bed's own spread |
| Sync | cue onsets vs picture events | ≤ ±1 frame |
| VO read on the final mix | local whisper CER/WER | JA ≤ 5 %, EN ≤ 1 % |
| Typing margin | music vs typing, 1.5–6 kHz | ≥ 6 dB |
| Captions | text vs VO words; plate vs UI regions | diff 0; never covers UI |
| Brand | lint-brand-caps + DOM text scan | 0 spellings of the brand other than its display form |
| Continuity | footage checklist (`launch-footage.md`) | pass |
| Z-order / overlap | overlay stills at every pop | foreground never covered |
| Rules | `launch-rules.md` lint on the render | 0 violations |
| Text lint (automated) | `qc/lint.py` on `remotion/scenes.json` + `stages/vo/lines.json`: personal names (R8; allowed only with `run.brief.allowNames` true or a list), the brand display form (R1), non-integrated services (R11), kit-default / earlier-film leftovers (R12). Rows `lint-*` in every QC record | 0 hits |
| Music clock | the version's scene frames vs `stages/music/clock.json` (row `music-clock`, once music is picked) | equal, every scene |

## Procedure

1. Run the QC script on each render as soon as it exists; open the contact sheet and the boundary sheets yourself (a frame you haven't opened you can't describe).
2. Fix fails before announcing; if a fail can't be fixed now, the stage page shows it as a red row with the plan.
3. Send each version as soon as its QC passes (`launch-review-deliver.md`).

## Gotchas

- Browser-pane screenshots can lag one step behind; when a picture contradicts the DOM, capture again or use a headless capture.
- Render stills one process at a time; reuse one bundle; the lean bundle (`--public-dir` symlinked) saves ~400 MB per bundle. Never write into that `public/`.
- Rendering: concurrency 4–6, `--gl=angle`, `--muted` for raw pictures. There is no WebGL here: shader backgrounds render their CSS fallbacks.
- A render can stall for hours; watch progress and report a stall instead of waiting (see `guardrails.md`).

## Acceptance

`<kind>-check.json` and `<kind>-review.json` cover every deliverable and every row above; all `pass`, or each `fail`/`unverified` named in the report to the producer.

## Scripts

Run Python scripts as `"<SKILL_DIR>/scripts/py" <area>/<script>.py`; each `--help` is authoritative. Present in `<SKILL_DIR>/scripts/` now:

- `qc/qc.py` — QC for renders and mixes -> out/qc/*.json + *.jpg
- `qc/lint.py` — QC lint · the text rules of launch-rules.md (names, brand display form, integrations, leftovers) -> out/qc/lint.json; `qc.py check|all` adds its rows

