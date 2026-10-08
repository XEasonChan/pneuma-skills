# launch-music: beds, arrangements, warps, extensions

**Load at:** `music` (3 options, before any voice), again at `vo`/`picture` when a window grows (bed extension), and at `finals` for the second language (EN warp). Reload on "BGM", "背景音乐", "video to music", "bpm".

**Reads:** `style-presets.md` blocks `music-palette`, `music-negatives`, `music-briefs` (**read them fresh every run**), the picked script, `stages/music/plan-map.json` (`launch-sound-map.md`), the seed music library. **Writes:** `stages/music/options/<id>.json` (contract §5), what the scripts write: `stages/music/beds/<id>-<bed>.flac` (+ `-arranged.flac`, `.ana.json` analysis, `.flac.json` arrangement), `stages/music/demos/<id>-music.mp3` + `<id>-guide-<lang>.mp3`, `stages/music/guide/<lang>/*.mp3`, `stages/music/options.json`; you write the briefs (`stages/music/<id>-brief.txt`) and `plan-map.json` by hand.

## Why music comes before voice

Pipeline order: script → music → voice → VO → picture fitted to both (Q3). The producer picks the audio first; the picture is then timed to its beats (`launch-timeline.md`). VO-locked picture with music fitted afterwards is the fallback.

## The three options

Offer **three options, each differing in one dimension**:

| Option | What | When it is recommended |
|---|---|---|
| **Per-scene BPM** (tempo map) | One bed re-arranged so each scene has its own tempo along an arc: slow suspense → build → climax → slow release | **When the producer's brief asks for tempo changes** (e.g. "a climax should have a higher BPM") |
| **One-grid density** | The same bed on one tempo; lifts come from density (+1 to +4 hats per bar), half-/double-time feel, filter moves, 1-bar stops | Otherwise. Most launch-film references hold one grid |
| **Contrast bed** | A different bed (another source or a palette variant), arranged the way the recommended one is | Never by default; it exists so the producer hears an alternative. Prefer a licence-safe source here (procedural or library) |

Each option's JSON: `bed.source` (`v2m|compose|library`), `bed.bpmMap` (`[{from,to,bpm,feel,role,join?}]`), `bed.key`, `bed.licenceSafe`, `sfxSet` (`A` paper & key / `E` soft synth, `launch-sfx.md`), `demo.music`, `demo.guideVo`, plus its scene windows on its own grid: `windows` `[{scene,from,to,len,frames,bars,beats,bpm}]` and `clock` `{fps,total,frames}`.

`music/library.py options` builds this set from the seed library in one run: A one-grid density and B per-scene BPM on the same bed, C a contrast bed (licence-safe first: the shipped placeholder beds are procedural, so they are; otherwise it takes the most different family and says so), C arranged the way the recommended option is; each arranged (`music/arrange.py`) and demoed (`music/demo.py`). Recommended: B when the brief asks for tempo changes (`run.brief.music.tempoMap`, else a keyword scan), otherwise A; `--recommend grid|bpm` overrides.

**One clock.** Each option turns the script's `durationS` into windows of whole bars on its grid (never shorter than the estimated VO: the kit's placeholder rate + 0.3 s lead + 0.35 s tail), every boundary on the frame grid; the bpmMap's from/to are those windows, so the arrangement lands each section on its cut and its length equals the windows to the frame. B's windows are whole bars at each scene's own tempo, so every tempo holds exactly. After the pick, `music/lock.py apply` makes the picked windows THE scene windows (`stages/music/clock.json`, `remotion/scenes.json` lens); `music/demo.py`, `vo/pick.py` and QC read the same windows.

**bpm and feel.** `bpm` is the section's grid tempo (the beat the picture cuts on); `feel` is the drums on that grid: `half` = kick on 1 + "and of 3", clap on 3, the bed's drums out (reads at bpm / 2); `double` = 16th shaker and hats (reads at 2 × bpm). A target > 15 % from the bed is played at 2 × bpm with a half-time feel (or bpm / 2 with double time) instead of more stretch. When a fixed window can't hold its tempo on whole beats (a short window), `arrange.py` keeps the tempo for the body and ramps across the last bar (or the whole section) into the next section; if no ramp fits, it holds the nearest whole-beat tempo and carries the difference by feel or density (half-time ≥ 8 % slower, a thinner kit slower, +1..+4 hats per bar faster). It never collapses a distinct target to the bed's tempo silently: every case is in the arrangement's `warnings` and `sections[].tempo_mode`.

## Procedure

1. **Brief.** Build each brief from `style-presets.md` (palette + negatives + the opening rule), restated in full. Never copy an old brief; only timing and cue maps carry over. Save it as `brief.txt`.
2. **Get a bed** (one source per option):
   - **Library:** a bed from the seed library (the procedural placeholders, or the run's own licensed beds added as cards in `assets/library/music/`). Free.
   - **Compose:** ElevenLabs Music with a composition plan (below). Paid.
   - **Video-to-Music on an animatic:** render a free animatic of the script (launch-kit scenes with placeholder type at the script's `durationS`), strip its audio, 720p, then V2M (below). Paid.
3. **Analyse** the bed: tempo, beat grid, key, sections, loudness per section → `grid.json`, `analysis.json`.
4. **Arrange** per the option: tempo map or one-grid density (below). Put scene windows on whole bars.
5. **Guide VO.** Speak the script with free local TTS (macOS `say`, e.g. JA Kyoko, EN Samantha; espeak-ng on Linux) at the target chars/min or wpm, place each line in its window, and mix a demo (music ducked 9 dB under it). The guide shows pacing only; say so on the page.
6. **Measure** each demo (below), then `options set music`.

## Video-to-Music (ElevenLabs), in full

- Endpoint `POST /v1/music/video-to-music`, multipart: `videos` (≤ 10 files, ≤ 200 MB total, ≤ 600 s total), `description` (≤ 1000 chars), `tags` (≤ 10).
- **Always pass `model_id=music_v2_5`.** Unset, the default is the deprecated `music_v1`, which also ignored the length (61 s in → 79–81 s out).
- Input is **picture only** (strip the audio), 720p. It scores the whole video in one pass.
- There is **no duration or influence parameter**. Verify the returned length equals the video's; trim or re-request otherwise.
- ≈ 30–45 s per 2-min film; ≈ 900 credits per minute of video; **2 concurrent requests per account** (a 3rd returns 429); output 128 kbps.
- fal does not offer V2M; this is an ElevenLabs call (`ELEVENLABS_API_KEY`).
- **It follows mood, not cuts:** measured onsets at cuts no better than chance, no accent on the trigger, sends or lockup. Land the cuts with SFX and with stops/gates in the arrangement.
- Gotchas: a timecode-heavy description can leave the first seconds silent; add "music starts at 0 s, no silence". Run-to-run randomness is high (a liked short recipe may not reproduce at full length): generate ≥ 2 per option and keep the raw files.
- What worked: a short airy description (brief B) and the full palette brief (E1), both in `style-presets.md`.

## Composition plans (ElevenLabs Music)

- A plan is global positive/negative styles plus sections, each with its own positive/negative local styles and a duration in ms; sections map to scene windows. Check the script's `--help` for the exact body.
- **Music v2.5 normalises every generation to about −14 dB RMS and ignores section dynamics.** Put the dynamics in per-section cues (sparser/denser styles) and apply gain automation afterwards.
- Every plan carries the full negative list.

## Per-scene BPM (tempo map)

1. Split the bed into harmonic and percussive stems (HPSS); beat-grid it.
2. Re-sequence beat-synchronously per section; stretch each section toward its target tempo with **one** Rubber Band R3 pass driven by a key-frame time map, **≤ ±15 %** per section. Bigger contrasts use half-/double-time feel, not more stretch.
3. Re-drum per section with a kit resampled from the bed itself (one kit, one key).
4. Every tempo change happens at a join with a stop, fill, filter move, low hit or 1-bar lift. Arc: 1-bar stop before each turn; low hit + 1-bar lift into the drop on the product's first act; button ending on the lockup.

## One-grid density

One tempo for the film. Lift with hat density (+1 to +4 per bar), half-/double-time feel, filter opening, and 1-bar stops before turns; drop on the product's first act; button ending on the lockup.

**Tooling:** `music/library.py options` option A is this: `arrange.py` with a bpmMap that holds the bed's BPM on every scene and varies `feel` (suspense half-time, the peak climax double-time, the manifesto beat after the climax half-time) and `join` (`stop` before turns, `drop` into the first climax, button on the lockup). Hat-density lifts come from `arrange.py`'s `hats_plus` (set per section in the bpmMap, or chosen when a short window can't hold its tempo). A bed whose own arc already lifts by density (e.g. a V2M bed from the E1 brief) can instead be fitted with `library.py options --no-arrange` (windows on the bed's real downbeats). Say on the option page which you did.

## EN from the JA bed (warp)

When JA and EN windows differ, build the bed on the lead language and warp it for the other: per scene, even-count whole-beat edits (remove or repeat 2 beats) at the most self-similar beat pairs, spliced ≈ 12 ms before a transient with a 16–30 ms equal-power crossfade, then a small Rubber Band remainder. Pin the button ending to the lockup. **Why:** a pure per-scene stretch swings the tempo by up to 23 %.

## Extending a locked bed

When a window grows (VO overflow, a new hold): replay **2-beat loops** at in-groove points, 60 ms equal-power crossfade at the quietest point before a beat; loops × length = the insert exactly. Then run the seam QC.

## Rules

1. **Palette and negatives come from `style-presets.md`, restated in every brief.** The shipped preset is an electronic-pop launch palette with **no piano anywhere** (an example; edit it for your brand). Rejected directions go to the archive, not into the next brief.
2. **Opening:** ethereal with a little echo, not silent, not a drone. Regional colour (e.g. a soft koto-like pluck), breath/air and a wood knock are allowed **only in the quiet opening** (before the product is introduced). Default, see `_open-questions.md` Q5.
3. **Don't switch the music mid-film.** One kit, one key, one continuous bar sequence; acts differ by arrangement (density, stops, lifts). Hard switches between beds in different keys read as bugs. The ground and the transition may change per act; the music doesn't.
4. **Licence row on every option.** Generated music (compose and V2M) carries the provider's terms, which often exclude film / TV / radio or public use on self-serve plans; check your plan. A venue may also require a performing-rights licence: prefer non-PRO sources. Procedural and owned-library beds are licence-safe. (Q4)

## Wasted loops to avoid

- **Single-pass generation ignores section timing** and v2.5 normalises to ≈ −14 dB, so one flat loop runs under the whole film. Arrange sections yourself.
- **Measurement alone isn't a pass:** a bed can measure fine and still have abrupt genre switches the producer hears. Music grows from the intro with no abrupt genre switches.
- **Old auditions reused** read as junk: every option is made for this film.
- A spoken poem or read text in the opening needs a credited reader and a licence row.
- **Carried-over briefs:** an unwanted instrument comes back in every candidate when briefs inherit an old opening description. Rebuild each brief from `style-presets.md`.
- **Misreading a reference:** measure a reference (tempo, kit, density) before describing it.
- **Unpicked exploration** costs hours and dollars. Stay inside the three options; more only on request.

5. **Judge by DSP measurement plus the producer's ears, never by an LLM verdict.** You can't listen: say so. LLM listening judges are unreliable (they echo the brief and hear things that aren't there). Report measured tempo, key, loudness, sync and spectral numbers; a judge's opinion, if any, is labelled as such and never counts as a pass.
6. **Archive rejected directions** (`stages/music/archive/README.md`, one line each on why), so they stop acting as context.

## Options page

Side by side per option: the demo player (bed + guide VO), a BPM lane over the scene list with windows, key, section-loudness plot, cut-sync stats, licence row, source and cost, "what differs from the other options". Previews are stream-copied so only the music differs.

## Acceptance

- Worst VO-line clearance ≥ 17 dB in the demo.
- No piano: none in any brief; judge result reported if available.
- The ending lands on the lockup frame ±1 frame.
- Tempo map: every section within ±15 % stretch; joins masked.
- EN warp: ≤ 1 % stretch on grooved spans; join clicks below the surrounding material.
- No > 3 dB/1 s level move except at an edit point.
- Ledger rows for every compose/V2M call.

## Scripts

Run Python scripts as `"<SKILL_DIR>/scripts/py" <area>/<script>.py`; each `--help` is authoritative. Present in `<SKILL_DIR>/scripts/` now:

- `music/analyse.py` — Stage 3 · analyse a bed: BPM, beat grid, downbeat phase, groove start, key (+ scale / pentatonic / triad), per-section loudness,
- `music/arrange.py` — Stage 3 · per-scene BPM arrangement from ONE bed: slow suspense -> build -> climax -> slow release, each section
- `music/compose.py` — Stage 3 · Eleven Music composition plan from the script's scene list: one chunk per section, each with its own BPM and styles.
- `music/demo.py` — Stage 3 · pacing demos per music option: a music-only listen (bed at the mix level + 8 dB, limited) and a guide-VO demo (the VO laid
- `music/extend.py` — Stage 3/8 · extend a LOCKED bed by beat loops where the picture gained hold time.
- `music/library.py` — Stage 3 · the music library: list the seed beds, fit one to a length, or turn the library into music options.
- `music/v2m.py` — Stage 3 · ElevenLabs Video-to-Music beds from the picture: picture-only 720p in, 1-3 briefs, <= 2 requests at a time.
- `music/warp.py` — Stage 9 · the EN bed from the JA bed: whole-beat edits + a small Rubber Band remainder, so the groove survives .

- `music/lock.py` — Stage 3 -> 7 · the music-locked clock: `show` / `apply` (stages/music/clock.json + remotion/scenes.json lens) / `check`
