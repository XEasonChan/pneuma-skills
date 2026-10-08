# launch-mix-master: levels, duck, typing margin, true-peak master, remux

**Load at:** `sound` (the rough-cut mix), `finals` (every format × language), and any "mix", "master", "音量", "BGM too loud" comment.

**Reads:** the VO-only master audio per version, the bed (arranged/extended/warped), the SFX stem, `timeline.json`. **Writes:** `out/audio/<format>-<lang>-{vo,full}.m4a` (+ `.wav`), `out/roughcut/<format>-<lang>.mp4` or `out/final/<format>-<lang>.mp4` (remuxed), the mix rows of `out/qc/<kind>-check.json` (via `qc/qc.py check`).

## Numbers (the default convention)

| Item | Value |
|---|---|
| VO master (VO + the render's own clicks/typing) | **−14.3 LUFS**, never touched after |
| Music, pre-duck | **−26.8 LUFS** |
| Duck under every VO span | **−9 dB**, attack 0.25 s, release 0.5 s |
| Music under typing / clicks | **stays**, dipped (≈ 3 dB, more if needed) so typing keeps **≥ 6 dB margin over the music in 1.5–6 kHz** |
| E1-style groove beds | −4 dB high shelf at 5 kHz |
| SFX | not ducked; ≈ −19.5 LU re VO; ≤ 3 events/s |
| Master | **true-peak limiter only**, ceiling −1.6 dBTP (lower the WAV ceiling, e.g. −1.9, when AAC overshoots) |
| Integrated loudness | reads ≈ −15.4 to −15.9 LUFS; that is correct |

## Procedure

1. Start from the VO-only master of the **frame-verified** picture (identify it by md5, not by name).
2. Lay the bed with the duck and the typing dips; add the SFX stem on the render's time base (measure the render's audio offset; `mix.py --delay-samples`).
3. Limit true peak; encode AAC; measure after encoding.
4. Remux onto the picture: `ffmpeg -i picture.mp4 -i audio.m4a -map 0:v -map 1:a -c copy out.mp4`. Verify the output's audio md5 equals the source `.m4a` stream.
5. Keep **two masters per version:** full (sound design) and VO-only. The VO-only master is the picture review copy and the base for every later music/SFX round. Keep the muted raw pictures for later remuxes.

## Rules

1. **BGM must not disturb the VO.** A bed that is too loud breaks the VO rhythm; keep the levels below between films.
2. **Never re-normalise the whole mix.** Loudness gating counts the music-filled gaps, so normalising to −14.3 raises the music by several dB.
3. **BGM under typing:** the bed stays under typing and dips just enough that typing keeps ≥ 6 dB margin in 1.5–6 kHz. This satisfies both "no BGM under typing" and "keep the BGM, just add keyboard sound". (Q6)
4. **Audio changes never re-render the picture.** Remux only.
5. **Mix levels:** −26.8 LUFS / 9 dB duck by default. A lighter duck (VO ≈ 3.4 LU over the music, 2 dB duck) is an alternative some references use.

## Gotchas

- **Stale-picture remux:** a mix built on the first render of a draft silently carries picture regressions. Mux only onto the latest verified picture, checked by md5.
- Never write into a bundle's `public/`: it may be a symlink into the source.
- AAC can overshoot the WAV ceiling by several tenths of a dB; measure after AAC, per language.

## Acceptance

- VO master −14.3 ± 0.1 LUFS; TP ≤ −1.6 dBTP measured after AAC (lower the WAV ceiling if AAC overshoots).
- Music −26.8 LUFS pre-duck; worst VO-line clearance ≥ 17 dB.
- Typing margin ≥ 6 dB in 1.5–6 kHz at every typing window.
- Audio frame count equals the picture's (`round(dur × 30) == N`); audio md5 matches the source.
- Outside an edited window, audio is sample-identical to the previous master after the shift.

## Scripts

Run Python scripts as `"<SKILL_DIR>/scripts/py" <area>/<script>.py`; each `--help` is authoritative. Present in `<SKILL_DIR>/scripts/` now:

- `mix/mix.py` — Stage 8/9 · mix + master and remux onto the picture.
- `mix/remux.py` — Swap a film's audio without re-rendering the picture: the video stream is copied, the audio replaced (AAC 192k).

