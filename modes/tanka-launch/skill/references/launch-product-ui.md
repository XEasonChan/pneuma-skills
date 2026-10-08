# launch-product-ui: the product's real UI, as custom scenes

**Load at:** `assets` (match every UI moment to a design source) and `picture` (build). Reload on "Figma", "UI", "library", "component", or any comment that the UI looks wrong.

The kit ships no product UI: every product's screens differ, and a launch film must show the real ones. A run builds its UI as custom scenes in `remotion/src/custom/`, ported frame by frame from the product's design source.

**Reads:** the picked script's `board.source`, the brief's `sources` (`figma`: file keys or links the producer gives; `prd`: PRD paths), the asset roots (exported PNGs, the logo, icons the product really uses), and custom components earlier runs left in their `remotion/src/custom/` if the producer points at them. **Writes:** `assets/design/<source>-<node>.png` (+ `.json`), `remotion/src/custom/<Component>.tsx`, `stages/assets/ui-map.json` = `[{ sceneId, element, component, source, status:"reused|ported|missing" }]`.

## Procedure

1. **Map** every UI element in every scene to a component and its design source (`ui-map.json`).
2. **Missing element → find it in the design source**, never draw it from imagination. Access, in order: the `figmaToken` REST export (PNG @2x + node JSON) of a file key the brief names; local PNG exports in the asset roots; ask the producer for a frame export.
3. **Port a frame:**
   1. export the node PNG and JSON into `assets/design/`;
   2. build it frame-driven in `remotion/src/custom/` (no CSS animation, rAF, timers or framer-motion; everything from `useCurrentFrame`), registered with `defineScene` or used inside one;
   3. give it props for content, face and state colours, and language-aware chrome;
   4. render one still per language (`node render.mjs <comp> --stills …`) and put it side by side with the design PNG;
   5. record it in `ui-map.json` as `ported` with its source node.
   A component worth keeping for later runs is proposed after the run (an Evolution proposal), never mid-run.
4. **Desensitise content:** anonymised people and data, roles over names, the run's own cast list.
5. The `assets` options page shows the map; a `missing` element blocks nothing but is a red row until resolved.

## Rules

1. **Never invent UI.** Rebuild the real screens and interactions from the design source; keep the product's own visual style; don't substitute generic design-system components.
2. **Product truths are the producer's.** When the producer corrects how the product behaves (which card a message uses, what a trigger looks like, what appears while the assistant is thinking), write it into the run's `direction.md` and follow it in every later scene.
3. **Extend by optional props with backward-compatible defaults.** Other scenes must render identically, proven by identical stills. Never edit an approved component in place; fork it.
4. **The brand display rule applies to the UI too** (`launch-captions-l10n.md`).
5. **Gap rule:** a new UI element needs a design node or the producer's sign-off. A scene that uses an unregistered UI element is not rendered for review; it shows as a red row.

## Gotchas

- Hard-coded content leaks between films: check a reused component's content, face and state-colour props before reuse.
- A design tool's plugin API may expose only part of a file; exports by node id through the REST token avoid that.
- Retired UI slips back in through old inserts. Check every insert against the current design source.
- UI chrome must follow the film language, or JA films show EN chrome.
- Integrations shown must exist (`launch-rules.md` R11).

## Options page

The UI map: scene × element × component × EN/JA still × design link, with status badges (reused / ported / missing). Ported components show the design-vs-render pair.

## Acceptance

- Every on-screen UI element maps to a component with a design source.
- `npm run typecheck` clean in the run's `remotion/`.
- Custom components render in EN and JA.
