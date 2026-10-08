# launch-sfx: set design on the sound map

**Load at:** `music` (each option names its SFX set) and `sound` (build the SFX layer). Reload on "音效", "SFX", "entrance sound", or any "too harsh / inaudible" comment.

**Reads:** `stages/sound/soundmap-<lang>.json` (`sfx/soundmap.py`; the "chart" of `launch-sound-map.md`), the picked music bed and its grid/chroma, `stages/vo/lines.json`, `style-presets.md` block `sfx-palette`. **Writes** (`sfx/render.py`): `stages/sound/sfx-<set>-<lang>.flac` (the SFX layer) + `stages/sound/sfx-<set>-<lang>.json` (every cue: `t, role, group, gain_db, note`, guard), and, for a new signature moment, `stages/sound/timbre/<moment>/<A..F>.wav` + an in-context clip.

## Default

**SFX are sound-map-driven** (Q1). Every event, continuous animation and micro moment in the map gets a considered cue (or an explicit "no sound"), in one coherent timbre set voiced to the bed. The minimal alternative (clicks + typing only) is a valid producer choice; clicks and typing stay mandatory under both.

## Procedure

1. Take the set named by the picked music option: **Set A "paper & key"** (washi card turns, dry wooden ticks, key clicks) for airy/V2M beds; **Set E "soft synth"** (tight soft synthetic clicks, muted FM/sine plucks, sub thumps) for E1-style groove beds.
   Every role has a procedural voice (`common/kit.py`); no samples ship. A run may drop its own licensed samples into `seed-library/sfx/set-a/` (flip / dock / tap / tuck / lowhit) or `seed-library/sfx/` (ui-click, ui-typing) to replace those voices; the air roles stay procedural.
2. Map every chart item to a cue by timbre group: rain (only where the picture has drops) · paper · key · air · tone · low.
3. **Pitch-snap** tonal cues to the bed's local harmony (chroma over a 3 s window, snap within ±2 st, transpose multi-note cues as a whole). On groove beds, **quantise** rhythmic cues to the beat grid within ±40 ms.
4. **Word guard:** every cue under a word sits ≤ the local VO level − 10 dB, using the ceiling of the quietest overlapping word.
5. **Typing layer:** add an audible typing layer on each type-on window (the render's own typing sits far too low).
6. Measure every cue (centroid, 2–6 kHz and 3–8 kHz energy share, attack) into `report.json`.
7. A **new signature moment** gets 3–6 timbre options (**TODO:** no script yet; `sfx/render.py --set A|E` covers whole-set comparisons, a single moment's timbres are made by hand) (standalone WAV, a 10 s in-context clip, a no-sound reference, and a table of centroid/level/start/bloom); default = the previous pick where one exists.

## Rules

1. **Low-mid, soft, slightly quiet; nothing piercing.** SFX −2.5 dB and whooshes −4 dB vs the base set; paper group centroid ≈ 1.1 kHz with ≈ 4 % of energy at 3–8 kHz. A bright swoosh or a small high "whoo" is the most common complaint.
2. **No chirps.** A "bird-like" click is usually a high glass ping gliding up in pitch; check the centroid and the glide.
3. **Confirm sounds only on real confirmations.** No strong click on a page switch; no sound on a card merely appearing.
4. **Typing and clicks are always audible.** Typing peaks ≈ 12 dB under the VO; margin ≥ 6 dB over the music in 1.5–6 kHz.
5. **Set levels relative to the VO, never by copying gain numbers between films.** Gains relative to one film's chain make clicks inaudible in another. (Q14)
6. **Water only where the picture has drops** (`rain`, low and soft). No water drops in the UI or the lockup.
7. **Regional timbres** (e.g. a koto-like pluck) belong to the quiet opening only; no continuous bells or bowls anywhere. Default, Q5.
8. **Design from the picture, don't pull from the pile.** Redesign as a music and sound designer; don't pick leftovers from a folder.

## Signature moments (examples to adapt)

- Drops (`rain`): low-mid, rounded.
- A ring or card spin: soft continuous turns.
- **A character or product entrance:** a swell (e.g. a detuned sine triad, filter 500 Hz → 4.5 kHz) blooming on the landing, peak −12 dB re VO, dry 0.4 s fade, no reverb tail.
- An orb or idle breath (airy, low) and a "waiting for input" breath.
- Card turns and selection; a confirm; a found + lock-in.
- A vernier / timeline ratchet: one soft dark detent per notch (60–90 ms/notch, decelerating) + a low felt lock. Generate detents from the component's notch list, not by count.
- Send press + breath; panel slides (low, never bright); the lockup chord.

## Gotchas

- An echo on a tone reads as an extra detent or tail: strip echoes from UI moments.
- A render's audio can be a few tens of ms late against its timeline; measure it and place cues on the same time base.
- Optional generated SFX (ElevenLabs Sound Effects, 3 variants each) are paid: ledger them, measure them, and never trust an LLM listening verdict.

## Options page

At `sound` the rough-cut page carries the SFX layer on its own track. A signature-moment page shows the timbre options with their table. A full-set comparison (A vs E) is shown only when the producer asks or the bed changed.

## Acceptance

- SFX overall ≈ −19.5 LU re VO; worst cue under a word ≤ −10 dB.
- Per-group centroid and 3–8 kHz share reported (paper ≤ 5 %).
- Every tonal cue in the local key; every click on its visual frame (Δ 0 frames).
- Typing ≥ 6 dB over the music in 1.5–6 kHz.
- ≤ 3 cues per second.

## Scripts

Run Python scripts as `"<SKILL_DIR>/scripts/py" <area>/<script>.py`; each `--help` is authoritative. Present in `<SKILL_DIR>/scripts/` now:

- `sfx/render.py` — Stage 8 · render the SFX layer from the sound map: Set A "paper & key" or Set E "electronic", one event map for both.
- `sfx/soundmap.py` — Stage 8 · the sound map: the animation / rhythm / info-density model of the film -> stages/sound/soundmap-<lang>.json

Still expected (**TODO**: not in the scripts directory at the time of writing; use the matching script once it exists, else do the step by hand with ffmpeg and report it):

- `scripts/sfx/` — timbre options for a signature moment
