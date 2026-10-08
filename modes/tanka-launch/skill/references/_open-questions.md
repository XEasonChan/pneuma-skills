# Open questions and the defaults in force

Decisions a team has to make for its own launches, each with the default the skills apply until the producer says otherwise. Overrule any of them by editing the **Default** line (or telling the agent), and the agent applies your version from the next stage on.

**General rule:** where rules conflict, the latest dated direction from the producer wins, and the agent says which version it applies. Run-specific decisions go into the run's `direction.md` with the producer's words and the date.

| # | Question | Default in force | Where applied |
|---|---|---|---|
| Q1 | SFX for a new film: minimal (clicks + typing only) or sound-map-driven? | **Sound-map-driven.** Clicks and typing are mandatory either way. | `launch-sfx.md` |
| Q2 | Per-scene BPM vs one grid? | **Offer both as music options.** Per-scene BPM is recommended when the brief asks for tempo changes; otherwise one-grid density. | `launch-music.md` |
| Q3 | Picture-to-audio order: VO-locked or music-locked? | **Script → music → voice → VO → picture fitted to both**, for every film. VO-locked stays as the fallback mode. | `launch-timeline.md`, SKILL.md |
| Q4 | Music licence for public / event use (generated-music terms differ by plan; a venue may need a performing-rights licence). | Generated beds are allowed; every music option carries a licence row, the contrast option prefers a licence-safe (procedural / owned) bed, and the deliver note flags any bed whose licence is not confirmed. **Delivery isn't blocked.** | `launch-music.md`, `launch-review-deliver.md` |
| Q5 | Regional instruments (e.g. Japanese instruments for a JP film). | Allowed only in the quiet opening, as a soft colour; never as the main motif; no continuous bells. Edit the music negatives in `style-presets.md` per product. | `style-presets.md`, `launch-music.md`, `launch-sfx.md` |
| Q6 | BGM under typing: drop out, dip, or constant? | **The bed stays under typing and dips** so typing keeps ≥ 6 dB margin in 1.5–6 kHz. | `launch-mix-master.md` |
| Q7 | JA voice: native TTS, or EN VO + JA subtitles? | Audition per run from `common/voices.json`; `en-jasub` is always produced. | `launch-vo.md` |
| Q8 | The assistant's (or any persona's) name on screen. | Always the producer's choice: one setting, `brand.assistantName`, used everywhere; never hard-coded; neutral default "your assistant". | `launch-rules.md` R2 |
| Q9 | Third-party logos on screen (authorisation). | Show only real integrations (R11) and flag third-party marks in every deliver note until authorisation is confirmed. | `launch-rules.md` R11 |
| Q10 | Bilingual type screens (EN on top + JA below) vs per-language type? | **Per-language type**; bilingual only on request. | `launch-captions-l10n.md` |
| Q11 | Where custom scenes live after a run. | In the run's `remotion/src/custom/`; one worth keeping is proposed for the kit as an Evolution proposal after the run. | SKILL.md |
| Q12 | Design access and who ports a new UI element. | `figmaToken` REST export first, then local PNG exports; the mode's agent ports the element and it needs a design node or the producer's sign-off. | `launch-product-ui.md` |
| Q13 | Circle reveals. | **Only when the circle grows from a real element** (a send button). No generic circle wipes, iris or clock wipes. | `launch-motion.md` |
| Q14 | Click / typing levels: raw gains or relative to the VO? | **Relative to the VO:** typing peaks ≈ 12 dB under the VO, ≥ 6 dB over the music; never copy gain numbers between films. | `launch-sfx.md` |
| Q15 | Length presets per channel (event, web hero, social). | short ≤ 90 s is the run default; full 2:00–2:10; use-case ≈ 60 s; 9:16 = the short. Event opener = full, web hero = short 16:9, social = short 9:16. | `launch-story.md` |
| Q16 | Who owns version names? | The mode: `deliver/deliver.py` names finals `<brand>-<run>-<format>-<LANG>.mp4` (file names aren't on-screen text); the delivery note maps any renamed copy. | `launch-review-deliver.md` |
| Q17 | Remotion licence (and the automation licence for scripted rendering). | **Check for your organisation; flagged in pre-flight.** | pre-flight |
| Q18 | VO density target: per minute of VO or per minute of runtime? | **Ceiling JA ≤ 190 chars/min of runtime, EN ≤ 140 wpm of runtime,** natural pace; every page states the denominator. | `launch-story.md` |
| Q19 | 9:16 subtitle band. | Band above the bottom 20 % of the frame; ≤ 2 lines; checked on the UI-region sheet. | `launch-captions-l10n.md` |
| Q20 | Fonts: system fonts (SF Pro / Hiragino on macOS) vs bundled open fonts (Inter / Noto)? | **System fonts with Linux stand-ins** in every stack; don't mix renders from the two in one approval. | `launch-captions-l10n.md` |
| Q21 | Integration allowlist (which integrations exist). | `run.brief.integrations` / the `integrations` preset in `style.json`; empty until the producer fills it in. | `launch-rules.md` R11 |
| Q22 | Default film shape: the use-case template (≈ 60–90 s, UI-first, footage in cards) or a story film (≈ 2 min)? | **Use-case template recommended** among the 3 script options unless the brief asks for a story film. | `launch-story.md` |
| Q23 | Footage policy and per-run footage budget. | Library first; full-frame footage only in the hook and in transitions, everywhere else inside cards or UI components; new Seedance only for uncovered scenes; plan 3 takes per clip (~1 in 3 usable). Footage share of the $60 cap: ≤ $25 (see Q28). | `launch-footage.md` |
| Q24 | Native-language VO check: who signs off a language's read? | **The director records the voice first; the producer listens and decides.** No separate reviewer step; the rough-cut approval is the gate. | `launch-review-deliver.md` |
| Q25 | Logo motion. | `logo-lockup` with the run's logo; a custom logo animation only on request. | `launch-motion.md` |
| Q26 | API keys. | Keys live in Pneuma's settings (`ELEVENLABS_API_KEY`, `FAL_KEY`, `OPENROUTER_API_KEY`, `FIGMA_TOKEN`); the skills never copy, print or log them. Rotate any key that was ever pasted into a chat. | `guardrails.md` |
| Q27 | Deliver use-case films too, and in every language? | The mode delivers every final of the run in every language the brief lists. | `launch-review-deliver.md` |
| Q28 | How to spend the $60 run cap. | Soft split: footage ≤ $25, music ≤ $10, voice + VO ≤ $10, images ≤ $5, reserve $10. The cap itself is hard (`ledger reserve` exit 3 stops the run). | SKILL.md |
| Q29 | Guide VO for the music demos (music comes before voice). | Free local TTS (macOS `say` / espeak-ng) at the target pace, labelled "guide". | `launch-music.md` |
| Q30 | What the rough cut contains. | The lead format (first in the brief) in each voiced language, lead language first; other formats and `en-jasub` come in finals. | SKILL.md |
| Q31 | Paid-call approval: per batch, or a run cap with auto-run? | **The cap replaces per-batch OK inside a run.** Past the cap, or if the permission system denies a call, the run stops and asks; the agent never routes around a denial and hands the producer the one-line command. | SKILL.md |
| Q32 | True-peak ceiling. | Ceiling **−1.6 dBTP measured after AAC** (what `qc/qc.py` enforces); lower the WAV ceiling (e.g. −1.9) when AAC overshoots. | `launch-mix-master.md` |
| Q33 | A text-only cut (no voice: type, music and SFX carry the film)? | **Optional, off by default** (`run.brief.textOnly`). When the producer turns it on, skip the voice and VO stages' paid work and let type screens carry every line; the stage machine does not yet skip those stages by itself (future work), so register a single "text-only" option on each. | `launch-story.md` |
| Q34 | Push the storyboard to Figma? | **Optional.** The director asks the producer for the Figma file link (a run setting, no default) and exports one frame per scene. | `launch-storyboard.md` |
| Q35 | Pronunciation. | A **per-language dictionary** (`run.brief.pronunciation` = `{en: {word: reading}, ja: {word: reading}}`, else the style preset): the same word can be read differently in each language. | `launch-vo.md` |
