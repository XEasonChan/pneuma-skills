# launch-captions-l10n: subtitles, the brand display rule, JA/EN variants

**Load at:** `script` (JA and EN are written separately there), `picture` (caption track + the brand display rule in every comp), `finals` (all variants). Reload on "字幕", "subtitle", "JA version", "EN with JA subs".

**Reads:** `stages/vo/lines.json` (words), `timeline.json`, `style-presets.md` blocks `ja-style`, `en-style`, `subtitle`, `brand`. **Writes:** the captions track in `timeline.json`, per-variant props in `remotion/scenes.json`, the caption rows of `out/qc/<kind>-review.json`.

## Variants (default outputs per run)

| Variant id | Voice | Subtitles |
|---|---|---|
| `ja` | JA | JA |
| `en` | EN | EN |
| `en-jasub` | EN | JA |

Each is rendered for each format (default `short-16x9`, `short-9x16`). The picture outside the subtitle band is identical across variants.

## Rules

1. **One subtitle style: the kit's `FilmSubtitle`.** Verbatim VO chunks, bottom-centre, soft dark plate, EN 34 px / JA 32 px at 1080p, ≤ 2 lines, short fades, no highlights or motion. Extra animated captions over the video look cheap.
2. **Subtitle band.**
   - The band sits 80 px above the bottom; on UI shots where it would cover persistent UI (a scene's `band: 'ui'`), 24 px up.
   - **9:16:** band above the bottom 20 % of the frame so social UI doesn't cover it (240 / 220 px); ≤ 2 lines at the same px sizes; check on the UI-region sheet. (Q19)
3. **No caption where the words are the picture:** logo line, type screens, lockup. On `en-jasub`, type lines are subbed only when asked.
4. **The brand display rule.** `scenes.json` `brand: {display, match}` (from `run.brief.brand`): every whole-word spelling in `match` is shown as `display` in every prop that goes through `tx()` and in every caption (not inside a domain or a file name), the same value on every frame. TTS text is untouched. A custom scene applies it by rendering its strings through `tx()` / `brandCaps()`.
5. **JA type:** phrase (bunsetsu) reveal, `palt`, no printed phrase spaces; local Hiragino / Noto Sans JP.
6. **JA wording follows the customer's own script** where one exists; JA rewrites happen at the script stage, never in subtitling.
7. **Bilingual type screens:** per-language type by default (JA film shows JA, EN film shows EN); EN on top with the JA phrase below only on request. (Q10)
8. **Presets are editable:** the JA and EN style blocks in `style-presets.md` are read fresh each run; the producer's edits there win over this file.

## Gotchas

- JA subtitles on the EN film are spread over the EN line by length; check sync frame by frame.
- A logo tagline disagreed with the VO once; diff on-screen text vs VO per variant.
- Web CJK fonts can time out in Remotion; use local fonts. SF Pro and Hiragino are Apple fonts (macOS-only; licence question, Q20); the kit's stacks fall back to Inter / Noto on Linux.
- UI chrome must follow the film language.

## Acceptance

- Caption text equals the VO words (diff = 0).
- The plate never covers UI (UI-region sheet per format).
- 0 spellings of the brand other than its display form in the rendered text (`qc/lint.py` lint-brand-caps).
- All variants share the picture outside the band: PSNR on the rows above the band ≥ 45 dB.

## Scripts

Run Python scripts as `"<SKILL_DIR>/scripts/py" <area>/<script>.py`; each `--help` is authoritative. Present in `<SKILL_DIR>/scripts/` now:

- `qc/qc.py` — QC for renders and mixes -> out/qc/*.json + *.jpg

