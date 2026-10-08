# launch-vo: voice audition, takes, read check, post-processing

**Load at:** `voice` (auditions) and `vo` (takes → picks). Reload on "VO", "配音", "regenerate line", "voice audition".

**Reads:** the picked script (VO per scene), the picked music option (scene windows), `style-presets.md` (JA/EN presets). **Writes (via the scripts):** `stages/voice/options/<lang>-<id>.json` + sample MP3s; `stages/vo/raw/<lang>/<lineId>.t<n>.mp3` + `takes.json`; `<take>.scribe.json` read checks; `stages/vo/proc/<lang>/…` post-processed takes; `stages/vo/final/<lang>/<id>.mp3`, `stages/vo/lines.json` (contract §5), `stages/vo/options.json`.

## Voice stage

1. Per language, pick 3–4 voices for a sample line (the film's hardest line: the brand name plus one key product word). The **recommended** voice is the current locked voice; the others are alternatives worth hearing, one dimension apart (warmer, younger, faster).
   - **The preset** (`scripts/common/voices.json`, example entries): EN "calm" — a calm, premium narrator, `eleven_v3`, stability 0.5, similarity 0.75, style 0.35, speaker boost. JA "narrator" — a calm mid-range narrator, `eleven_v3`, stability 0.5, similarity 0.75, style 0.30, speaker boost, prefix `[speaking slowly and gently] `. The `voiceId`s ship as `REPLACE_…` placeholders: put voices from your own ElevenLabs library there before a real run (`common/el.py` refuses a placeholder id).
   - Record a voice you stop using in the pool's `retired` list with the date, so an old run's pick still resolves.
2. Reserve the ledger, run the audition script, commit. Each sample is a real TTS call (short, cheap) unless mock.
   - The audition pool is `scripts/common/voices.json`: the current voice first, then alternatives. Superseded voices sit in its `retired` list and are auditioned only with `voice/audition.py --include-retired` (keep the two in step when a voice is locked or retired).
3. `options set voice` with one option per voice per language: `{ lang, voiceId, name, settings, sample }`. Mark one recommended per language. Pick per language (`pick voice ja-A`, `pick voice en-A`) — see `_viewer-contract.md` for how the viewer sends two picks.

## VO stage

1. **Takes.** For every line in the picked script × every voiced language, generate **2 takes into `stages/vo/raw/`**, never into `remotion/public/`. TTS text uses the brand's spoken form (`brand.spoken`, e.g. アクメ / Akme) and the run's **pronunciation dictionary, keyed by language** (`run.brief.pronunciation` = `{en: {word: reading}, ja: {word: reading}}`, else the `pronunciation` preset in `common/style.json`): the same word can be read differently in each language, so an entry only applies to its own language. The display rule is display-only. If a voice misreads a word, add it to that language's dictionary (or, for one take, `vo/generate.py --spell en=Akme`).
2. **Read check, locally.** Transcribe each take with local whisper.cpp large-v3 (free). Reject a take when the brand isn't heard (`brand.heard` lists the spellings speech-to-text may produce) or a key word is misheard (e.g. 返信 → 写真/心身/申請). Paid ElevenLabs Scribe is never the default.
3. **Post.**
   - **JA:** keep the voice's natural pace, no speed-up. Pauses: 、 0.25–0.35 s; 。？ 0.45–0.60 s. Place pauses on measured silence gaps, not on whisper word times.
   - **EN:** `atempo ×1.11` first, then commas as spoken (cap 0.35 s), sentence marks 0.40–0.55 s.
   - Both: −16 LUFS per line.
4. **Pick** the best measured take per line (passes the read check; closest to its scene window; no clipped consonants). Only the pick script writes `stages/vo/lines.json` and copies into the run's Remotion public dir; it asserts the target directory. Words are re-mapped through the pause edits.
5. **Fit.** Every line must fit its scene window from the picked music option (`launch-timeline.md`): `vo/pick.py` places it (`at` = 0.3 s lead; lines of one scene 0.35 s apart) and checks `at + duration + 0.35 s tail ≤ window` (the kit's tail: past it the picture would stretch the scene off the music). If it doesn't: the other take (the ranking prefers one that fits); then propose a shorter wording on the options page; only then extend the scene by whole beats. `vo/pick.py` also checks rule 7 (JA ≤ EN + 25 % per line) and the density ceilings per minute of runtime (JA ≤ 190 chars/min, EN ≤ 140 wpm; runtime = the music clock's total) and writes every violation into `stages/vo/options.json` (`flags`, summary), `picks.json` and the take board. Fix the flags or name them to the producer before the VO is confirmed.
6. **Native-language check = the producer's ears.** Record the voice first; the producer listens to the takes (and the rough cut) and decides. There is no separate reviewer step; flag anything the read check marked unsure so the producer listens to it first.
7. `vo/pick.py` writes `stages/vo/lines.json` and `stages/vo/options.json` (one option, "measured picks") **before** registration, so the pick doesn't change the stage afterwards. `--register` runs `options set vo`. The producer overrides single lines in chat ("line S3 JA take 2"): re-run `vo/pick.py --prefer S3:ja:2` and re-register (this restarts the countdown).

## Rules

1. **Voices are auditioned per run, and the voice + model + settings are recorded per line.**
2. **Two takes per line, raw first, pick writes public.** Never run the generator with no ids on an existing run: it regenerates every line.
3. **Local whisper read check is the default.** Scribe costs money.
4. **JA pacing:** the pace of an ordinary Japanese speaker telling a story; don't slow down for the sake of it (an over-slow read sounds odd).
5. **EN pacing:** atempo ×1.11 by default (1.2 tends to rush the line).
6. **Connected delivery between sentences** (娓娓道来). When lines run together in one scene, generate them as one continuous take and cut it into lines.
7. **Each JA line runs ≤ its EN line + 25 %.** Otherwise shorten the JA wording in the script stage.

## Gotchas

- **Never re-run an audition or take generation that already exists.** A re-run overwrites MP3s and spends credits. Audition and take files are immutable per run; a regeneration names the line ids and writes new take numbers.
- Speech-to-text mishears brand names and near-homophones (異動 → 移動); flag such words for the producer's ear, add the mishearings to `brand.heard`, and fix a misread in that language's pronunciation dictionary.
- Character voices are separate from the narrator: a character's own spoken line uses the character's voice (add it to the pool with its own id).
- Keep a short list of voices already auditioned and not picked in `direction.md`, so the next run doesn't re-audition them.
- `eleven_v3` ignores `speed` (0.7/0.9/1.0 gave the same length); audio tags slow it only ~4 %. `eleven_multilingual_v2` at 0.87 slows it but misreads JA badly (花瓶 → 貨幣, 承認 → 成人). Don't use it for JA.
- whisper's JA word timings are spread evenly per token; a pause placed from them lands inside a word (「担当者は」 got split). Use measured silence gaps.
- ElevenLabs: 128 kbps output, **2 concurrent requests** (a 3rd gets 429), credits can run out mid-round. Run takes 2 at a time and report partial results as partial.
- The permission system may deny a TTS call even with budget left. Stop, don't route around it, and hand the producer the exact one-line command (see SKILL.md, "Paid calls").
- Synthetic JA can sound unnatural to native listeners; EN VO + JA subtitles is a good fallback. The `en-jasub` variant is a default output for this reason.

## Options pages

- **Voice:** per language, a row per voice: name, id, settings, the sample player, measured mora/s or wpm, recommended badge.
- **VO:** every line × takes × language: players, the whisper transcript with misreads highlighted, mora/s or wpm, duration vs its scene window and vs the EN line, the picked take. Summary: lines passed / failed, total VO seconds per language.

## Acceptance

- Every picked take passes the read check: brand heard, key words match; on the final mix JA CER ≤ 5 %, EN WER ≤ 1 %.
- Each JA line ≤ EN + 25 %.
- Line loudness −16 ± 0.5 LUFS; pauses inside the bounds.
- `lines.json` durations and words match the files (re-measured, not copied).
- Ledger rows for every TTS call.

## Scripts

Run Python scripts as `"<SKILL_DIR>/scripts/py" <area>/<script>.py`; each `--help` is authoritative. Present in `<SKILL_DIR>/scripts/` now:

- `vo/generate.py` — Stage 5 · VO takes: every scene's VO line x language x N takes (default 2) -> stages/vo/raw/<lang>/<lineId>.t<n>.mp3 + stages/vo/takes.json
- `vo/pick.py` — Stage 5 · take pick: the best measured take per line x language -> stages/vo/final/<lang>/<id>.mp3 + stages/vo/lines.json (contracts §5)
- `vo/post.py` — Stage 5 · VO post: tempo + pause rules + -16 LUFS per line, on every raw take -> stages/vo/proc/<lang>/<id>.t<n>.flac + .json
- `vo/readcheck.py` — Stage 5 · read check (free, local): whisper.cpp large-v3 on every raw take -> <take>.scribe.json (ElevenLabs-Scribe shape:
- `voice/audition.py` — Stage 4 · voice audition: 3-4 voices x one sample line per language -> stages/voice/options/<lang>-<id>.json + .mp3.

