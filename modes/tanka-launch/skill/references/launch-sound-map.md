# launch-sound-map: the animation / rhythm / density model

**Load at:** `music` (a planned map from the script, to shape the bed's arc and BGM windows) and `sound` (the measured map from the picture, which drives SFX and the mix). Reload on "sound map", "动效图", "音效地图", or after any retime.

**Why it exists:** Model a map of what animation, rhythm and info density the whole video has, then add SFX to enrich it. The sound agent reads the motion code with the motion agent so the sound is continuous. (09-27, C/D)

**Reads:** `remotion/scenes.json`, the scene components' event exports, the VO-only render, `stages/vo/lines.json`, the picked music option. **Writes:** `stages/music/plan-map.json` (planned, prose-owned by you) and, through `sfx/soundmap.py`, `stages/sound/soundmap-<lang>.json` (measured; called `chart.json` below).

## Schema (`chart.json`)

```jsonc
{ "hash": { "timeline": "sha256", "render": "sha256" },
  "shots": [{ "id", "start", "end", "transitionIn" }],
  "sections": [{ "from", "to", "story", "emotion", "soundRole": "bgm|sfx-led|quiet" }],
  "vo": [{ "id", "from", "to", "words": [...] }],
  "events": [{ "t", "what", "kind": "click|type|land|pop|turn|lock|send|reveal" }],
  "continuous": [{ "from", "to", "what", "intensity": [[t, 0..1], ...] }],   // ring spin, orb breath, orbit cards, graph rotation, streaming, vernier scrub
  "micro": [{ "t", "what" }],                                                  // dimension confirm, timestamp found + lock-in, drops, scroll ticks
  "textReveals": [...], "camera": [...],
  "density": [[t, info, nElements, motionEnergy, cutScore], ...],             // every 0.25 s
  "plan": { "sfx": [{ "t", "what", "timbreGroup", "gain" }], "bgmWindows": [...], "sfxOnlyStretches": [...] } }
```

## Procedure

1. **Planned map (music stage):** from the script's `density` and scene types, draft `sections` (story, emotion, sound role) and `bgmWindows`. Each music option's arc follows it.
2. **Measured map (sound stage):** run `sfx/soundmap.py`. It reads `timeline.json`, `remotion/scenes.json` (each scene type has a template of signature moments) and `stages/vo/lines.json`. A custom scene, or any moment the template misses, gets `props.events: [{ at, kind, label, n?, end? }]` in `scenes.json` — that is how you put code-accurate event times into the map, never by eye. Then add density from the VO-only render every 0.25 s.
3. **Plan the cues:** SFX on events, continuous and micro moments per `launch-sfx.md`; BGM windows per the section roles.
4. Record the hash of the timeline and the render the map was built on.

## Rules

1. **Code, not eyes, for event times.** Match a section to an older reference render by DTW over thumbnails only when no code clock exists.
2. **Mark continuous animations and selections too**, not only clicks: a ring rotation, a card rotation, a breathing orb all need sound.
3. **BGM lifts the mood at key transitions and waits,** not wall-to-wall. The bed still runs under typing (dipped, `launch-mix-master.md`).
4. **≤ 3 planned SFX per second** (≤ 2/s on minimal cuts).

## Gotchas

- **The render's audio sits 42.7 ms (2048 samples) late** against its own timeline. Every added layer rides the same time base.
- The map goes stale after any retime. Re-key old → new, re-dump, and snap to the old values plus the shift.

## Options page

The sound-map page (`chart.html`, also drawn in the version node's timeline): lanes for shots, VO, events, continuous, micro, density heat and planned cues. The producer marks missing moments on it; each mark arrives as viewer context with a time.

## Acceptance

- Every UI event in the code is in `events`.
- `density` covers the whole film at 0.25 s.
- Planned SFX ≤ 3/s.
- The map's hash matches the current timeline and render.

## Scripts

Run Python scripts as `"<SKILL_DIR>/scripts/py" <area>/<script>.py`; each `--help` is authoritative. Present in `<SKILL_DIR>/scripts/` now:

- `sfx/render.py` — Stage 8 · render the SFX layer from the sound map: Set A "paper & key" or Set E "electronic", one event map for both.
- `sfx/soundmap.py` — Stage 8 · the sound map: the animation / rhythm / info-density model of the film -> stages/sound/soundmap-<lang>.json

