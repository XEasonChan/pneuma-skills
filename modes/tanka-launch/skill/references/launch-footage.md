# launch-footage: images (GPT Image via Codex) and Seedance (via fal)

**Load at:** `assets`, for every scene whose source type is `seedance` or `hybrid`, or that needs a still (character bible, keyframe, poster). Reload on "Seedance", "character bible", "生成视频素材".

**Reads:** the picked script's storyboard fields, the asset library (settings `assetRoots`: existing clips, character references, earlier generated stills), `launch-rules.md` (house rules and the market preset). **Writes:** `assets/images/<id>.png` + `<id>.prompt.txt`, `assets/footage/<scene>/<take>.mp4` + `<take>.json` (`{ model, prompt, seed, refs, costUsd, requestId }`), `stages/assets/options/*.json`, `stages/assets/continuity/<take>.jpg`.

## Procedure

1. **Library first.** For each footage need, search the library. Reuse a clip when it matches the card shown over it and isn't used elsewhere in this film. List the gaps.
2. **Bible before footage.** A gap with a person needs a character bible first: one still per character (front, bust, turnaround) via `<SKILL_DIR>/scripts/images/generate.mjs` — the only place Codex is called (`--provider openrouter` is the optional paid fallback when Codex fails; it is ledgered). Never generate product UI there.
3. **Prompt.** Write one prompt per gap (English), run the prompt lint below, then estimate: `ledger reserve --stage assets --provider fal --what "seedance <scene> take A" --usd <est>`. Exit 3 = over the cap: stop and ask.
4. **Generate** via `<SKILL_DIR>/scripts/footage/` (fal, Seedance only). Commit the ledger with the actual cost and request id, even on failure.
5. **Check continuity** on a 4-frame sheet per take (checklist below). A failed take gets a named fix in its next prompt; a third take needs the producer's yes.
6. **Register options:** A = library-only (recommended when it covers every scene), B = library + generated gaps (recommended when A leaves a scene uncovered). Include the cost of B in its summary.

## Rules

1. **A recurring character is one character.** If the product has a mascot or an assistant character, its reference images live in the asset roots and every still or clip is made from them; its states (idle, thinking, working, notifying…) come from one start frame so poses match. Wardrobe follows the market preset (`launch-rules.md` M7).
2. **Stable humans.** One fixed text description + a fixed seed per person; stylised keyframes as `@Image1`. fal/Seedance rejects photoreal references of people (likeness policy).
3. **Images come from Codex (GPT Image)**, invoked only by `scripts/images/`, prompt on stdin, reference images attached. Real generated images, never a made-up placeholder in a delivered film.
4. **Full-frame footage only in the hook and in transitions.** Everywhere else footage lives inside the motion graphics — in cards (`footage-card`) or UI components with a line of text — and there is less of it. No real-people clips unless the brief asks.
5. **Footage matches the card over it; no clip repeats in a film.**
6. **Don't corner-pin UI onto device screens** for hero moments; the UI slides in as its own panel (pasted UI on a device reads as fake).
7. **Models and parameters:** Seedance 2.5 `reference-to-video` (the most used endpoint), or 2.5/2.0 `image-to-video` for character states (start frame = end frame for loops). 720p, 4 s, 16:9 (1:1 for avatars), `generate_audio: false`, 1–2 seeds per shot. fal is used for Seedance only.
8. **Budget for yield.** Expect roughly 1 usable clip in 3. Estimate 3 takes per needed clip, and prefer the UI-first film shape so one bad clip can't sink the film.
9. **Character registry, not ad-hoc refs.** Keep each character's references (front, turnaround, bust, the Seedance `@Image1` crop) and state clips under one folder in the asset roots and name them in `direction.md`; resolve them from `assetRoots`.

## A prompt formula that works

A `REAL` block ("documentary live-action… no 3D or clay look on any human") + the fixed person description + a `LOOK` block ("the only stylised element is @Image1…") + an `END` block ("screens and papers stay unreadable… no cuts"). When a UI panel will slide in on the right, add "exactly two figures, nobody else, both in the LEFT 60 %, right 40 % empty".

## Prompt lint (run before every take)

- **Never describe screen content visible to the camera while someone types on it** — that is how reversed screens happen. Write: camera behind or beside the person, screen facing the person, screen content not visible.
- One camera move, stated whole; no cut inside a take.
- Wardrobe and character description copied verbatim from the bible.
- No brand logos, no readable text, no subtitles, no music in the clip.
- No money, no recorders, no human working at night when the market preset says so (`launch-rules.md`).

## Continuity checklist (4-frame sheet per take)

Screen orientation (faces the person, not the camera) · wardrobe matches the bible · props and hands on the device are plausible · face matches the bible (side-by-side still) · no clip reused · the face isn't hidden while a device screen is exposed.

## Gotchas

- Endpoint: `queue.fal.run/bytedance/seedance-2.5/reference-to-video` (`text-to-video` when there is no ref); `@Image1` = the character ref, `@Image2` = a prop ref; a fixed seed per person.
- Size and scale: write "SIZE IS CRITICAL" plus the real size for a small character next to a person (otherwise it comes back adult-sized or figurine-sized).
- Season and place continuity: put season, the other person's position and what a gesture is directed at in the prompt.
- Screens: an over-the-shoulder shot with the phone's **back** to camera avoids a reversed screen; a laptop from behind reads as reversed.
- Common rejects, for the prompt's prohibitions: photoreal refs (likeness block), clay humans, extra people, split screen, reversed or camera-facing screens, style leaking onto a device screen, a floating speech bubble with fake text, face and hair drift, a character rendered at the wrong size, a two-clip cross-dissolve (reads as double exposure).
- **Codex (images):** one image per call, a 360–420 s watchdog, and ask Codex to copy the file into its working dir. The images script owns all of this; don't call Codex directly. Pin a model your Codex CLI supports (`--model`).
- Thumbnails can drift to older takes; re-extract thumbnails from the accepted clip, not from a cache.
- Seedance won't return less than 4 s; plan cards ≥ 4 s of source and trim.
- Scripts read `FAL_KEY` from the environment or the skill's `.env` only; never paste keys into chat.

## Options page

A take board per gap: prompt, seed, model, cost, takes A/B(/C) with the 4-frame sheet and the continuity checklist ticked; plus the library matches with thumbnails. Summary: cost of generated gaps vs library-only.

## Acceptance

- Each accepted clip has prompt, seed, model, cost and request id recorded, and a ledger row.
- No clip repeats; continuity checklist passes; the character matches the bible.

## Scripts

Each `--help` is authoritative:

- `footage/seedance.mjs` — one Seedance clip via fal's queue: estimate, submit once, poll, download, QC sheet.
- `images/generate.mjs` — one image via Codex (GPT Image) or the OpenRouter fallback; budget-gated, timed out, mockable.
