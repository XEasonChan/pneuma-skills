# Guardrails: files, disk, jobs, direction

**Load at:** the start of every session (with the pre-flight checklist), and before any render, bundle, library change or file operation outside `stages/`.

## Files

1. **One writer per file.** `tl.mjs` writes `film.json` and `ledger.jsonl`; never hand-edit either. Stage scripts write their own outputs (see each reference). You write prose (`direction.md`, `stages/*/fixes.md`, briefs), option JSON before `options set`, and the run's `remotion/` sources. The viewer writes nothing to the workspace except through `tl.mjs` (see `_viewer-contract.md`).
2. **Fork, never edit what is approved.** A change to an approved component or scene goes into a new file or an optional prop whose default is today's behaviour; prove other films unchanged with md5-identical stills.
3. **Never write into a bundle's `public/`.** It may be a symlink into the source; a "copy" can overwrite the originals.
4. **Never overwrite a delivered file or the fallback.** New outputs get new names.
5. **Back up before editing anything outside the run workspace** (the mode's kit, asset roots).
6. **Announce every write outside your own stage files** in your report ("edited X at HH:MM, why"). An unannounced overwrite of another agent's file costs a round.
7. **Stay in the workspace.** Scripts never write outside it, except `deliver` into `deliveryDir`.

## Disk

- Check `df` before every bundle or render. **Stop below 1.5 GB free; warn below 5 GB** (a 90 s short at 1080p ≈ 80 MB; keep renders lean) (a 2-min 1080p render ≈ 150 MB, a bundle ≈ 30 MB lean or ≈ 440 MB full, WAV intermediates add up).
- One bundle per round; use the lean bundle (`--public-dir` symlinked). Delete your own bundles after the round.
- Only the producer deletes Remotion temp bundles outside the workspace; hand them the command.

## Jobs

- Every long job (render, V2M, Seedance, whisper) runs with a watchdog: report progress, and report a stall after 2× its expected time instead of waiting.
- Keep ElevenLabs at ≤ 2 concurrent requests.
- List your running jobs in the report with their expected finish.

## Direction

- Keep one living `direction.md` in the run root: the brief's intent, picks with dates, the producer's rules for this run, and a **Superseded** section. When a direction is reversed, move it under Superseded with the date and reason; don't leave it inline.
- **Archive rejected directions** (e.g. `stages/music/archive/README.md`, one line each on why) so they stop acting as context.
- **Say which rule version you apply** when a rule has a Superseded entry. A skill quoting an old rule brings rejected directions back.
- Learning: when the producer states a new rule or reverses one, note it in `direction.md` with their words and date. Skill changes go through the Evolution proposal flow for the producer's approval; never edit the skill mid-run.

## Keys

Never print, echo, log or write a key. Scripts read keys from env (`ELEVENLABS_API_KEY`, `FAL_KEY`, `OPENROUTER_API_KEY`, `FIGMA_TOKEN`) set by the mode's settings. If a key appears in chat or a file, don't repeat it; tell the producer it should be rotated.
