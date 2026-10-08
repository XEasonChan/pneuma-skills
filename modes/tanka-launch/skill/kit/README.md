# launch-kit

Remotion 4.0.459 · React 19 · TypeScript (ESM, consumed as source). The scene grammar and renderer of the Launch Studio mode
(`tanka-launch`). It ships inside the skill so every run workspace has it; `remotion/scripts/link.mjs` copies it into the run's
Remotion project as `remotion/kit/` and resolves `import … from 'launch-kit'` to that copy.

```
src/
  grammar.ts      SceneSpec / ScenesDoc / VoLine types, defineScene(), the scene registry
  layout.ts       scenes.json + lines.json → resolved film (frames, VO placement, captions) + timeline.json (contracts §5)
  SceneRenderer   the picture: one ground → plates (scenes) → hand-offs → captions → VO audio
  compositions    filmCompositions(): <edition>-<aspect>-<lang> compositions with calculateMetadata
  Preview.tsx     <KitPreviewCompositions/>: Kit-<type>-<aspect>-<lang> for every scene + Kit-Gallery-16x9 / -9x16
  scenes/         the generic scene types (below) + shared helpers (Stage16, Recentre, FilmCard, voWin)
  handoff/        CardToChip · sendReveal + RevealMask · SharedMorph · FloatingVideoCard · DepthCarry
  captions/       Captions (one subtitle style + the brand display rule + band rules), splitCaption, lineToCues
  ground/         FilmGround: the ONE continuous ground under a film (soft · night · dawn · deep · indigo · paper)
  brand/          theme tokens (colours, type, radii, CAPTION_BAND, UI_SAFE) and the run's brand settings
  core/           text (Bi, tx, brandCaps), motion (easings, living holds), film context (FilmProvider, FORMATS)
  lint/           lintNames(): personal-name warnings for a run's on-screen text
assets/           neutral placeholders only (plain SVG shapes; see assets/PLACEHOLDERS.md). Served as public/kit/.
```

## Fonts

System fonts only (web-font loading can time out in headless renders). Every stack names the macOS face first (SF Pro, Hiragino) and
a common Linux stand-in right after it (Inter, Noto Sans / Serif JP), so a render works on either. Metrics differ slightly between the
two, so EN line breaks can move a little between a macOS render and a Linux render; don't mix the two in one approval.

## Rules the kit enforces

- **The brand display rule**: a run sets `scenes.json` → `brand: {display, match}` (e.g. `{"display": "ACME", "match": ["Acme"]}`);
  every on-screen string that goes through `tx()` and every caption shows the brand in its display form. VO text is never touched.
  With no `brand` block, text renders exactly as written.
- **One ground, no seams**: scenes are foreground plates; the SceneRenderer draws one film-clock ground. Scene changes are `carry`
  (the outgoing plate blurs back, the incoming settles from depth), `slide` (lateral pane), `cut`, or `handoff` (the next scene starts
  `xf` s early UNDER the outgoing plate, which draws its own exit; the scene sees it as `c.leadIn`). No cross-dissolve of two sharp
  pictures.
- **Captions**: one subtitle style for the whole film; the plate's bottom 80 px above the frame edge, 24 px over app UI (a scene's
  `band: 'ui'`); 9:16 = 240 / 220 px. Type screens are muted (their words are the picture) except in `en-jasub`. Captions are the VO
  text verbatim.
- **Frame-deterministic**: every value is a function of the frame (no Math.random / Date.now / timers).
- **Living holds**: nothing is static for more than ~2 s, a new reveal lands every ~3 s. When a scene's `len` grows, the spare time
  becomes idle life (`slowPush`, `idleBeats`, `pulseAt`, `zoomAbout` in core/motion), never a stretched easing.
- **No leftover story**: every default is neutral placeholder copy; `qc/lint.py` flags kit defaults left in a film.

## Brand settings

```json
{"brand": {"display": "ACME", "match": ["Acme"], "assistantName": {"en": "Ava", "ja": "Ava"}}}
```

`display` / `match` drive the display rule above; `assistantName` (the producer's choice, never hard-coded; default "your assistant" / 「あなたのアシスタント」) is what custom
scenes read through `assistantName(lang)` when they show a product's assistant. FilmProvider applies the block once per render.

## Names lint (QC)

```ts
import {lintNames, formatNameWarnings} from 'launch-kit';
const warnings = lintNames(scenesJson /* object or JSON string */, {allow: ['Brightline']}); // NameWarning[]
```

or `node <kit>/src/lint/names-cli.ts remotion/scenes.json [--json] [--allow A,B]` (exit 1 = warnings). It scans every text prop of
every scene plus its `vo` / `onScreen` text for personal names: a word after a greeting / sign-off ("Hi Evan,"), a capitalised word
mid-sentence that is not a known app / month / role word, a one-word last sentence (the sign-off), a possessive, a JA name + honorific
(…さん / 様); a name found once is flagged wherever it appears. Words next to Co. / Inc / 社 are companies. Warnings, not errors.

## Scene types (`scenes.json` `type` → props; every prop has a default)

`Bi` = `"text"` or `{"en": "…", "ja": "…"}`. Times are seconds on the scene clock. Asset paths: `kit:…` (kit placeholder), `assets/…`
(the run's), URL.

| type | what | props (all optional unless marked) | default len · band · out |
|---|---|---|---|
| `text-screen` | typed type, key words ink to the accent + one light pass, words rise off to exit | **`lines[{text,keys[]}]`** (1–2; JA phrases space-separated), `size`, `typeFrom`, `typeS`, `caret`, `tone` light\|dark, `exit`, `accent` | 3.2 · free (muted) · carry |
| `logo-lockup` | the run's logo lands, its wordmark wipes in, the tagline rises | `logo` (image path; default a placeholder shape), `wordmark`, `tagline`, `line2`, `tone` dark\|light, `at{mark,word,tag}`, `note` | 3.9 · free · carry |
| `footage-card` | footage or a still in the rounded card (outside the hook and transitions footage lives in cards), optional label pill; optional PiP top-left over the next scene | **`src`**, `label`, `pip{at,hold}`, `playbackRate`, `startFrom` | 4.5 · free · carry |

Product UI is deliberately not in the kit: every product's screens differ. A run draws its own as custom scenes (below), from the
product's real screens.

## How the agent composes a film

1. Write `remotion/scenes.json` (contracts §6): `{fps, formats, languages, ground, brand, scenes:[{id, type, len, props, vo:{en, ja, at}, onScreen, editions, transitionOut}]}`. `len` may be `{en, ja}`; `from` is optional (scenes run back to back); `editions: ["full"]` keeps a scene out of the short (SHORT = FULL ending earlier).
2. **Timing: music-locked (default) or VO-locked (fallback).** See `references/launch-timeline.md`.
   - **Music-locked:** the music stage puts every scene on the picked bed's grid (whole bars ending on a downbeat). `music/lock.py
     apply` writes those windows into `scenes.json` as each scene's `len`, and the VO lines are placed *inside* them at `vo.at`
     (lead ≥ 0.3 s) with `vo.tail` ≥ 0.3 s. A take that does not fit is fixed upstream (the other take, shorter wording, or the window
     grows by whole beats and the bed is extended), so the kit's own growth rule below never fires.
   - **VO-locked (no music yet, a VO-only draft):** a scene *grows* to hold its lines: `len ≥ last line end + vo.tail` (default
     0.35 s); lines start at `vo.at` (default 0.3 s) and follow each other with `vo.gap` (default 0.35 s), or at their own `at`.
   - Either way the VO stage writes `stages/vo/lines.json` (`[{id, sceneId, lang, text, file, durS, words, at?}]`). Without it the
     scene's `vo` text gets placeholder timing (EN 2.7 words/s, JA 7.5 chars/s) and drives the captions.
3. `node render.mjs <edition>-<aspect>-<lang>[,…] [--scale 0.5]` → `out/picture/<comp>.mp4` (the VO-only master; `mix/mix.py` makes `out/roughcut/`) + its sidecar `out/picture/<comp>.json` + `timelines/<comp>.json` + the merged `timeline.json` (`"units": "frames"`), verified with ffprobe. Several comps share one bundle. `--stills 0,3s` for quick checks, `--list` for the compositions.
4. Need a scene the kit doesn't have (the product's UI, a chart, a character)? Add `remotion/src/custom/<name>.tsx` with `defineScene({type, title, description, defaults, defaultLen, band, component})`, import it in `custom/index.ts`, use its `type` in scenes.json, and declare its sound moments in `props.events` for the sound map.

Hand-offs that line up on the same frame: `text-screen(exit: 0)` → a custom scene that continues its words; `footage-card(pip.hold)`
floating over the next scene; any custom scene with `transitionOut: "handoff"` drawing its own exit over the next one.
