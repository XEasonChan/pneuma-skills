# launch-story: idea → brief → script options

**Load at:** `idea` and `script`. Reload when the producer comments on a line, the market or the length.

**Reads:** the typed idea, `run.brief` (`tl.mjs status --json`), the PRDs in `settings.prdRoot` and any per-run PRD/design source, `style-presets.md` (JA/EN presets, brand block), `_open-questions.md`.
**Writes:** `stages/idea/brief.json` + `brief.html`; `stages/script/options/<A|B|C>.json` + `<id>.html`; `direction.md` (the run's living direction file, prose you own).

## Procedure

1. **Idea.** Turn the typed idea into a structured brief: market (`us|jp|both`), formats, languages, selling points, sources (PRD paths, design file keys), length range with its reason, persona, the brand rule (`brand`: display form, spellings, spoken forms), the integrations the product really has (`integrations`), the assistant / persona name if any (`brand.assistantName`: ask, never assume), the pronunciation dictionary per language (`pronunciation`), whether this is a text-only cut (`textOnly`, off by default, Q33), and every default you assumed. The typed idea is the confirmation: `tl.mjs init --idea "<their words>" …` already records the idea as confirmed by the producer (the idea stage has no options); write `stages/idea/brief.json` + `brief.html` and merge it with `tl.mjs brief set --file stages/idea/brief.json --by producer`. List the assumptions at the top of `brief.html` so the producer can overrule them later (that makes downstream stages stale, which is correct).
2. **Angles.** Write 5 story angles (one line each: persona, pain, product moment, payoff) into `direction.md`. Pick the 3 strongest; they become the 3 script options. Say in the option `summary` how they differ (one dimension each where possible: angle, structure, or density).
   - **One option follows the use-case template** (≈ 60–90 s, UI-first: kinetic-type pain → the product's entry point → one request → the product doing the work → the result → one artefact → logo lockup; footage only in cards). It is the most reliable shape, so it is the recommended default unless the brief asks for a story film (Q22).
   - When revising after a comment, keep a **"previous + the change"** option next to the bold rewrite. Over-correction wastes loops (VO over-cut, a slower version, elements removed then restored).
3. **Script per option.** For each option write the scene list per the contract (`scenes[].{id,durationS,vo.{en,ja},onScreen.{en,ja},sceneType,density.{info,anim},transitionOut}`). `sceneType` is a kit scene type (see `references/contracts.md` §6 and `<SKILL_DIR>/kit/README.md`) or `custom:<name>` for a scene the run will build (product UI). Also give every scene the `launch-storyboard` fields (hero, focal ≤ 3, source type, design/PRD source).
4. **Measure** each option: total seconds, VO share of runtime, JA chars/min, EN wpm, number of type screens. Put the numbers in the option `summary`.
5. **Lint** each option with `launch-rules.md`. An option with a violation is fixed or not shown.
6. **Recommend** one (`recommended: true`) and say why in one line. Then `tl.mjs options set script --file stages/script/options.json`.

## Rules

1. **Five angles, pick one, then scene by scene.** Iterating one angle beats polishing three.
2. **Structure: hook → demo → style → use case → one more thing → outro.** For an event opener the film leaves an impression; details belong in the slides.
3. **Product first, story light.** The product's visible work carries the film; the background story is thin. Generated footage supports, it never leads.
4. **Never promise money or orders.** Show a small problem solved, not a business result.
5. **Persona → pain → solution.** Every use case opens with who the person is and what they do (shown working), then one VO line on how painful the old way is, then the product. One story per cut; a "one more thing" goes to a cut where it fits (e.g. a time-zone gap). Show proactivity where the product has it.
6. **Market positioning** (edit these presets in `style-presets.md` per product):
   - **JP:** a concrete owner or team member juggling internal and external work; the pain in the customer's own words (e.g. 「あの話、どこだっけ？」); the product proposes, the person decides; calmer pacing.
   - **US:** state the value proposition up front; concise English; the product does the legwork, the user tweaks and shares; personal buyer names are fine when the brief allows them.
   - **both:** write JA and EN as separate scripts of the same film, not translations; each follows its preset in `style-presets.md`.
7. **Manifesto lines are product statements; keep them verbatim unless the producer changes them.** Record the current set in the brief (`brief.manifesto`) and in `direction.md`.
8. **Wording is exact.** Use the product's real nouns (if the product has no "plan" feature, don't say "plan"); avoid verbs that imply something else happens (physical goods "ship"; software "goes out").
9. **Eye and ear agree.** A type screen shows exactly the words the VO says; one full-screen type line marks each big turn. On UI moments the VO doesn't read out what is typed on screen; the camera moves to the typed text instead.
10. **Subjects stay consistent** ("it" is the assistant or product throughout).
11. **Use the phrase customers actually say**, one line per transition, per culture.
12. **VO density.** Cut words per minute, but keep every product point that is on screen; don't cut for the sake of cutting, and keep a VO line stating the pain in the opening. Default ceiling: JA ≤ 190 chars per minute of runtime, EN ≤ 140 wpm of runtime, natural pace. Report VO share, chars/min and wpm per option, and say which denominator you used (Q18).
13. **Length is a range with its reason, never a single number.** Defaults: full 2:00–2:10; short ≤ 90 s; use-case cut ≈ 60 s. Default run = short.
14. **Fictional companies and people** (roles over names in JA), plus the disclaimer when the stories are invented. See `launch-rules.md`.

## Gotchas

- **Paper features:** scripts drift into UI flows that don't exist. Every claimed feature needs a PRD path or design node in the scene's `source`; no source, no claim.
- **Length creep:** each revision tends to add seconds. An option longer than the brief's range is not shown, and the recommended option is always inside the range.
- Every rewrite of a JA line happens here, not in subtitling: rewrite the JA script natively first, then storyboard it.
- An old direction in `direction.md` still reads as context. When a line or rule is superseded, move it under "Superseded" with the date; don't leave it inline.

## Options page (what the viewer shows)

Per option: logline, arc, a table with one row per scene: scene id · seconds · EN VO · JA VO · on-screen text · scene type · source · density. Header: total s, VO %, chars/min, wpm, lint result, what differs from the other options. `<id>.html` is that table, self-contained. The producer comments per line; revise and re-run `options set` (this resets the countdown).

## Acceptance

- JA chars/min and EN wpm reported per option.
- Every type-screen line equals its VO line.
- Every claimed feature has a source.
- `launch-rules` lint: zero violations.
- Length inside the brief's range.
