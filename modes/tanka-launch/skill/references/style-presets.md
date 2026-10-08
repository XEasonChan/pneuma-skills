# Style presets (editable; read fresh every run)

The producer edits this file between runs. Every block is an **example to adapt** to your product and brand, not a rule about any particular company. Each block is delimited by `<!-- preset:<id> -->` … `<!-- /preset -->`. Scripts and briefs quote blocks verbatim; never paraphrase a block from memory, and never reuse an old run's brief instead of these blocks. When a block changes, add a dated line under its "History".

**Machine copy:** the music scripts read `<SKILL_DIR>/scripts/common/style.json` (palette, arc, opening, negatives, tags, briefs, plus the structured `brand` and `integrations` presets). This file is the source of truth for the text blocks; when a music block here changes, make the same change there in the same turn, and say so in your report.

---

<!-- preset:music-palette -->
## Music palette (example)

```text
Launch-film electronic pop.
Minor-mode pop loop at about 100–104 BPM.
Punchy short electronic kick; claps on 2 and 4; syncopated 16th hats and shaker;
a bouncy plucked synth-bass ostinato; synth chords and short synth stabs.
One continuous groove with two states: filtered and restrained until the product appears,
then the groove. A 1-bar stop before each turn; a low hit and a 1-bar lift into the drop on
the product's first act; hold after the drop; end on a button (a stop plus one chord or chime)
landing on the logo lockup.
Opening (until the product is introduced): ethereal with a little echo, not silent, not a drone;
a dark, soft koto-like pluck, breath or air, a soft wood knock are allowed here only.
One kit, one key, one continuous bar sequence for the whole film.
```

History: shipped as the example palette.
<!-- /preset -->

<!-- preset:music-negatives -->
## Music negatives (append to every brief and composition plan)

```text
No piano of any kind (felt, electric, grand; no piano motif, no piano opening or outro).
No marimba, glockenspiel, candy-like bright bouncy plucks, repeating "candy" upbeats.
No drones or pads that hum; no continuous bells; no rin bowl.
No risers, no unmotivated sudden upbeats, no hard switches between sections in different keys or kits.
No koto, shamisen or other Japanese instruments after the opening.
No vocals. Music starts at 0 s, no silence.
```
<!-- /preset -->

<!-- preset:music-briefs -->
## Briefs that worked (quote, then add the film's own arc)

```text
base B (V2M): Airy, ethereal, minimal opening; gentle modern electronic build as
the product appears; calm, confident tech brand film; no vocals.
```

```text
E1 (V2M music_v2_5): Launch-film electronic pop, minor key, ~102 BPM,
punchy short kick, claps on 2 and 4, syncopated 16th hats and shaker, bouncy plucked synth-bass
ostinato, synth chords and short stabs; filtered and restrained until the product appears, then
one continuous groove; resolves on a clean button at the logo; no piano, marimba, glockenspiel,
drones, risers or sudden upbeats.
```
<!-- /preset -->

<!-- preset:sfx-palette -->
## SFX palette

```text
Low-mid, soft, slightly quiet, rounded transients; nothing piercing, no bright whooshes.
Levels: SFX -2.5 dB and whooshes -4 dB vs the base set; typing peaks ~12 dB under the VO.
Sets: A "paper & key" (card turns, dry wooden ticks, key clicks) for airy/V2M beds;
      E "soft synth" (tight soft synthetic clicks, muted FM/sine plucks, sub thumps) for groove beds.
Timbre groups: rain (only where the picture has drops) · paper · key · air · tone · low.
No water drops in the UI or the lockup.
No chirps, no glass pings, no echo tails on UI moments, no rin bowl, no continuous bells.
Confirm sounds only on real confirmations. Typing and clicks always audible.
```
<!-- /preset -->

<!-- preset:ja-style -->
## JA style preset (example)

```text
Market: Japan. Persona: a concrete owner or team member juggling internal and external work.
Pain in the customer's own words (e.g. 「あの話、どこだっけ？」).
The product proposes; the person decides and sends.
Pacing: calmer; the voice at its natural pace (no speed-up, no deliberate slow-down);
natural pauses (、 0.25–0.35 s; 。？ 0.45–0.60 s); holds of 0.3–0.5 s once content is readable.
Density: JA ≤ ~190 characters per minute of runtime; keep every product point on screen.
Roles over names; fictional companies; disclaimer ≥ 1.5 s when stories are invented.
Market preset M1–M7 in launch-rules.md (nothing outbound before the owner's tap, no after-hours
human work, no recording cues, no "say less", office-appropriate wardrobe).
Type: phrase (bunsetsu) reveals, palt, no printed phrase spaces, Hiragino / Noto Sans JP.
Subtitles: one style, JA 32 px, ≤ 2 lines.
Length: short 70–90 s; full 2:00–2:10.
```
<!-- /preset -->

<!-- preset:en-style -->
## EN style preset (example)

```text
Market: US. State the value proposition up front.
Story: the product does the legwork, the user tweaks, shares with the team, the result goes out.
Concise English; faster cuts; smoother typography transitions.
Pacing: atempo x1.11; commas as spoken (<= 0.35 s); sentence marks 0.40–0.55 s.
Density: EN <= ~140 wpm of runtime.
Personal buyer names are allowed (fictional). No money or order outcomes.
Type: SF Pro Display / Inter, masked line reveals, words keyed to the VO.
Subtitles: one style, EN 34 px, <= 2 lines.
Length: short <= 90 s (often 60–75 s); full 2:00–2:10.
```
<!-- /preset -->

<!-- preset:brand -->
## Brand rules (example: a fictional product, ACME)

```text
The product's display form on screen: set run.brief.brand (or the style.json `brand` preset), e.g.
{"display": "ACME", "match": ["Acme"], "spoken": {"en": "Acme", "ja": "アクメ"}, "heard": {"en": ["akme"]}}.
Every on-screen text (subtitles, type, marketing copy, product UI) shows the display form, via a
display transform; TTS text uses the spoken form.
Pronunciation: a per-language dictionary, run.brief.pronunciation (or the style.json `pronunciation`
preset), e.g. {"en": {"ACME": "Akme"}, "ja": {"ACME": "アクメ"}}; one word may read differently per language.
Assistant / persona label: brand.assistantName, the producer's choice, one name everywhere
(neutral default "your assistant"; never hard-coded).
Logo files: the product's official logo from the asset roots (light on dark, dark on light).
Integration allowlist: run.brief.integrations.allow / deny (or the style.json `integrations` preset);
show only services the product really integrates with (Q21).
Manifesto lines: record the current set in the brief (brief.manifesto) and keep them verbatim.
```
<!-- /preset -->

<!-- preset:subtitle -->
## Subtitle style

```text
One subtitle style only: verbatim VO chunks, bottom-centre, soft dark plate, EN 34 px / JA 32 px at 1080p,
<= 2 lines, short fades, no highlights or motion.
16:9 band 80 px above the bottom; 24 px over app UI (a scene's band: 'ui').
9:16 band above the bottom 20 % of the frame.
No captions on the logo line, type screens or lockup.
```
<!-- /preset -->

<!-- preset:motion -->
## Motion style

```text
Premium and calm: the kit's EL / EASE curves, expo-out, no overshoot or spring on type or cards.
Every boundary a continuous element hand-off (morph, depth push, horizontal slide, floating card).
No plain cross-fades, no generic circle wipes/iris/clock wipes; a circle reveal only from a real element.
One continuous ground + foreground plates; no seams, no double exposure.
No dither/noise frame; no dark or eerie intros; no web-chrome overlays.
```
<!-- /preset -->
