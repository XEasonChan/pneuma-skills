# launch-timeline: the film's clock

**Load at:** `music` (scene windows on the bed's grid), `vo` (fitting lines), `picture` (frames per scene) and any retime ("too fast/slow", "节奏", "shorter cut").

**Reads:** the picked script, the picked music option (`bed.bpmMap`, beat grid), `stages/vo/lines.json`. **Writes:** scene `from/len` in `remotion/scenes.json`; `timeline.json` (contract §5) after picture and sound, plus `timelines/<format>-<lang>.json` when versions differ in length.

## Two modes

**Music-locked is the default** (Q3). Pipeline order: script → music → voice → VO → picture fitted to both: once the producer picks a bed, the animation is timed to its beats, otherwise the material looks flat.
**VO-locked** (music fitted afterwards) stays available as the fallback mode.

### Music-locked (default)

1. At `music`, each option turns the script's `durationS` into **scene windows on its grid**: each scene gets a whole number of bars (or beats, for short beats), ending on a downbeat, never shorter than its estimated VO; every boundary is on the frame grid (`common/clock.py`; `option.windows`, `option.clock`). The option's demo plays the bed with a free guide VO (see `launch-music.md`) placed in those windows; the demo, the arranged bed and the windows have the same length to the frame.
2. **After the pick, one clock.** `music/lock.py apply` writes the picked option's windows to `stages/music/clock.json` and, once `remotion/scenes.json` exists, sets every scene's `len` to its window (`"units": "seconds"`, frame-exact, `from` dropped). Run it again right after writing `scenes.json` at `picture`; `music/lock.py check` compares scenes.json, `timelines/*.json` and `lines.json` with the clock. Never re-time scenes from `durationS` after the music pick.
3. At `vo`, `vo/pick.py` places every picked take in its window (`at` = 0.3 s lead, lines of one scene 0.35 s apart; the kit reads `at`) and checks the fit with the kit's 0.35 s tail: a line past it would stretch the scene off the music. Overflow → the other take (the ranking already prefers a take that fits) → shorter wording → extend the window by whole beats (the bed is extended to match, `launch-music.md` "Extending"). Flags go to the VO option (`flags`, summary).
4. At `picture`, key events land on beats: sends, card lands, reveals and cuts on a downbeat or beat (±1 frame); continuous motion keeps its own curves. Holds are whole beats.
5. Scene boundaries follow the grid; a VO line may cross a cut only when it is anchored mid-pause.

### VO-locked (fallback: no music yet, VO-only draft, or the producer asks)

- A shot is `max(visual min × K + hold, lead + VO + tail)` on a 0.1–0.3 s grid; every line fits inside its shot.
- When a bed is later locked, round every inserted hold to whole beats so the bed can be extended by beat loops. (e.g. +1.033 s and +3.133 s = 2 and 6 beats at 115 BPM)

## Rules (both modes)

1. **Hold, don't slow down.** Query input and replies keep a 0.5–1 s breath; retrieval and intro animations keep their speed. Focal content gets 0.3–0.5 s once readable.
2. **No freeze frames.** Holds are living (slow push, drift). No near-still stretch > 0.6 s.
3. **Pace per scene type.** Intro, montage, wall, retrieval effects, pops and outro at a brisk pace; type screens at readable timing (≈ 5–6 s for a two-line screen); query, answer, follow-ups and send with breathing; VO gaps 0.6–1.0 s (1.2 s was too slow).
4. **Retime a section without moving anchor frames** the music or other editions are locked to (a typical note: "this stretch too fast, then the text wall too slow").
5. **Editions.** SHORT = FULL ending earlier: shared scenes are defined once and must be identical. Lengths per `launch-story.md` rule 13. Vertical 9:16 uses the same clock as 16:9.
6. **Two clocks when re-voicing:** the VO actually played, and the picture clock older beats key to. Swap VO without re-animating.
7. **Per language.** JA and EN windows differ (EN boundaries can run up to ~0.7 s earlier); keep one scene list with per-language `len`, and warp the EN bed from JA (`launch-music.md`).

## Gotchas

- JA-voice visuals re-key to the JA words. A warp keyed to old lines breaks silently (a clock can run backwards).
- Re-deriving event times after an insert moves them by up to ±7 ms; snap to the old values plus the shift.
- After any retime the sound map is stale; rebuild it (`launch-sound-map.md`).

## Options page

Inside the music options: a BPM/bar lane under the scene list, with each scene's window and its VO fit (green fits, amber < 0.3 s margin, red overflow). At `picture`, the version node's timeline (tracks: scenes, VO, BGM, SFX, captions) from `timeline.json`.

## Acceptance

- Frame count per comp reported per format × language.
- No VO overlaps a cut unless anchored mid-pause.
- Shared scenes identical in full and short.
- Music-locked: key events on beats ±1 frame; inserted holds whole beats ±10 ms.
- No near-still stretch > 0.6 s.

## Scripts

Run Python scripts as `"<SKILL_DIR>/scripts/py" <area>/<script>.py`; each `--help` is authoritative. Present in `<SKILL_DIR>/scripts/` now:

- `music/analyse.py` — Stage 3 · analyse a bed: BPM, beat grid, downbeat phase, groove start, key (+ scale / pentatonic / triad), per-section loudness,
- `music/arrange.py` — Stage 3 · per-scene BPM arrangement from ONE bed (the bpm3 engine): slow suspense -> build -> climax -> slow release, each section
- `music/compose.py` — Stage 3 · Eleven Music composition plan from the script's scene list: one chunk per section, each with its own BPM and styles.
- `music/demo.py` — Stage 3 · pacing demos per music option: a music-only listen (bed at the mix level + 8 dB, limited) and a guide-VO demo (the VO laid
- `music/extend.py` — Stage 3/8 · extend a LOCKED bed by beat loops where the picture gained hold time (the final4 method).
- `music/library.py` — Stage 3 · the music library: list the seed beds, fit one to a length, or turn the library into music options.
- `music/v2m.py` — Stage 3 · ElevenLabs Video-to-Music beds from the picture: picture-only 720p in, 1-3 briefs, <= 2 requests at a time.
- `music/warp.py` — Stage 9 · the EN bed from the JA bed: whole-beat edits + a small Rubber Band remainder, so the groove survives (warp_en.py method).
- `music/lock.py` — Stage 3 -> 7 · the music-locked clock: `show` / `apply` (stages/music/clock.json + remotion/scenes.json lens) / `check`

