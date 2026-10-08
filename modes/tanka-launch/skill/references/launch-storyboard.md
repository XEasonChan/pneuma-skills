# launch-storyboard: shots, sources, gaze

**Load at:** `script` (every scene in each option carries these fields) and `picture` (before building `remotion/scenes.json`). Reload when the producer says "storyboard", "分镜" or "shotboard", or comments on a scene's composition.

**Reads:** the picked script option, the kit's scene types (`<SKILL_DIR>/kit/README.md`), the run's UI map (`launch-product-ui.md`). **Writes:** the storyboard fields inside the script option JSON (`scenes[].board`), and at `picture` `remotion/scenes.json` (scene grammar, contract §6).

## Fields per scene (`scenes[].board`)

```jsonc
{ "hero": "query box", "focal": ["query box", "result card"],      // ≤ 3 focal elements incl. hero
  "source": { "type": "motion|product-ui|seedance|hybrid",
              "figma": "fileKey:nodeId", "prd": "path#section" },
  "transitionIn": "element-morph:send-reveal", "transitionOut": "depth-push",
  "voLine": "L03", "gaze": "sees the query → hears the pain line → expects the answer",
  "sounds": ["typing", "send press"], "curves": "EL.morph" }
```

## Rules

0. **Optional: push the storyboard to Figma.** Only when the producer wants it: ask for the Figma file link (a run setting; there is no default link), then export one frame per scene with its board fields. Without a link, the storyboard lives on the canvas only.

1. **Four source types per shot:** Motion · Product UI (rebuilt from the design source, or a recording) · Seedance slot · Hybrid. Product UI moments name their design node.
2. **One central hero per frame, large.** Circular avatars appear only inside real UI; no web chrome as video design.
3. **At most 3 focal elements per frame; simulate the viewer's gaze:** what they see, what they hear, what they expect next, the sound of each action. Everything else dims (context at 35 % + 2.5 px blur).
4. **Parallel ideas each get their own beat.** Don't finish the narrative in one frame.
5. **Name every transition on the board** (element morph / depth push / horizontal slide / floating-card hand-off). Plain cross-fades are banned; see `launch-motion.md`.
6. **Fancy moments pay off in product UI.** A flashy effect ends in the product's real result, or it reads as a different product.
7. **Short = the full film ending earlier.** Shared scenes are defined once and used by both editions.
8. **Vertical 9:16 uses the same scene list**, re-laid out per scene (hero centred, UI column full width, subtitle band per `launch-captions-l10n.md`). Never crop the 16:9 render.
9. **Mock the curves before building** when a scene has a new motion: list the curve and values in `board.curves` (the kit's EL / EASE set).
10. **Full-frame footage only in the hook and in transitions;** everywhere else footage goes inside motion-graphic cards or UI components. The first scene is type animation by default.

## Gotchas

- Hook concepts that read as cheap posters, or dark / eerie intros, get rejected; don't propose them unless the brief asks.
- A reference film is a motion reference only (its logic of material change), not a story reference.
- A rejected board still leaks if its layouts are quoted. Don't cite rejected boards as examples.

## Options page

Part of the script option page: a storyboard strip, one card per scene with hero, focal list, source badge (Motion / UI / Seedance / Hybrid), design link, in/out transition names and the VO line. At `picture`, the version node's storyboard strip shows one rendered frame per scene.

## Acceptance

Every scene lists its hero and ≤ 3 focal elements, its source type and design/PRD source, named in/out transitions, and its VO line id.
