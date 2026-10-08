# launch-motion: scenes, hand-offs, type screens, grounds

**Load at:** `picture`. Reload on "转场", "motion", "transition", "21st", or any seam/judder/overlap comment.

**Reads:** `remotion/scenes.json`, the picked music option's grid, `stages/vo/lines.json`, the kit's scene types and hand-off components (`<SKILL_DIR>/kit/README.md`). **Writes:** `remotion/scenes.json`, `remotion/src/custom/**`, `stages/picture/options/*.json`, `stages/picture/proto/*.html` (transition prototypes, when a new transition is needed).

## Procedure

1. Compose the film from the kit's scene types in `scenes.json`; write a custom scene for the product's UI and for anything no type fits.
2. For every boundary, pick a named hand-off (below). A boundary with no continuous element is a bug.
3. **A new transition** gets HTML prototypes first: 2–4 options on the real VO clock (and the music grid), both formats, both languages. Register them as `picture` options only when this is a real choice; otherwise register the single build.
4. Render the **VO-only master** per format × language (VO + the render's own clicks/typing, no music) as the picture review copy.
5. Run the QC picture rows (`launch-qc.md`: boundaries, freeze, z-order, captions) before showing.

## Rules

1. **Every boundary is a continuous element hand-off: element morph, 3D/depth switch, horizontal slide, or floating-card hand-off. No plain cross-fades.**
   Hand-offs in the kit: `carry` (the outgoing plate recedes into depth while the incoming settles), `slide` (lateral pane), `handoff` (the next scene starts early under the outgoing plate, which draws its own exit), and the primitives `CardToChip`, `sendReveal` + `RevealMask` (a send button breathes and its circle uncovers the next scene), `SharedMorph` (one element between two rects), `FloatingVideoCard` (footage that floats top-left while the next scene fills).
2. **Circle reveals:** allowed only when the circle grows from a real element (a send button). No generic circle wipes, iris or clock wipes (Q13).
3. **No seams, no double exposure, no visible layers.** Use **one continuous ground plus foreground-only plates** (hide each scene's own field, feather plate edges ≥ 120 px). The first and last frames of a transition are the live scenes exactly; no next-scene UI shows under type screens.
4. **Z-order is P1.** Foreground content never gets covered by secondary cards; draw persistent UI first and cards above it. Check every overlay.
5. **Judder is P1.** A common cause: a non-integer parent scale on SVG. If an animation isn't worth it, cut sooner.
6. **Curves:** the kit's EL / EASE set (core/motion). Premium and calm: expo-out, **no overshoot or spring on type or cards**.
7. **Type screens.** One system per film; words keyed to the VO words; JA uses phrase (bunsetsu) reveals, not per-glyph rise. Avoid: goo-morph text, scramble/glitch, word springs, generic page wipes.
8. **Grounds are components on the film clock, never swapped cold** (`FilmGround` cross-fades only the ground between kinds: soft · night · dawn · deep · indigo · paper). No dither/noise frame unless the brief asks for one.
9. **Acts and big turns:** each act may change its ground and gets a named transition; big turns get a full-screen type card; the music stays one continuous bed and changes by arrangement (`launch-music.md`).
10. **Look.** Full-frame footage only in the hook and in transitions; everywhere else footage sits in cards or UI components. A light, calm day ground; no cheap high-saturation colours; one muted card system; real app icons for real integrations only. Persistent UI (a composer, a dock) keeps its place.
11. **All editions' intros match** when they share an opening.
12. **Camera:** push in on content while it reads, then back to the unified frame; never zoom so far into streamed text that the frame loses its anchor; content centred.
13. **The first instance of a signature effect is the fancy one; repeats are lighter** (expand and fold, not the full show again).
14. **Subtitle band** is reserved in every scene layout: see `launch-captions-l10n.md`.
15. **Music-locked picture:** key events on beats (`launch-timeline.md`).
16. **Adapting 21st.dev (or any component gallery).** Search is free, `get_component` is paid (ledger it). Port the *pattern*, not the code: frame-driven, no framer-motion/rAF/CSS animation, credit the source in a header comment. Build HTML options on the real VO clock before porting.

## Gotchas

- WebGL video textures can render blank in Remotion; drive a three.js camera projected into DOM cards instead.
- Web CJK fonts can time out in headless renders; use local Hiragino / Noto Sans JP.
- Descenders peeking out of clip boxes read as specks; stop drawing a line once its exit is ≥ 0.98.
- A mux on a stale render can lose late fixes. Always mux the frame-verified final picture.
- Never write into a bundle's `public/`: it can be a symlink into the source (a "copy" can overwrite the originals).

## Options page

Usually one option (the build), shown as the version node: storyboard strip, VO-only MP4 per format × language, boundary sheets. When a transition is a choice: the HTML prototypes side by side on the same clock, then before/after reels with the same frame count.

## Acceptance

- 10 fps sheets ±0.6 s around every boundary: no layer edge, gradient pop, double exposure or next-scene UI.
- No identical consecutive frames; no near-still > 0.6 s unless planned.
- PSNR ≥ 45 dB on unchanged ranges vs the previous draft; changed scenes listed.
- ≤ 3 focal elements per frame.
