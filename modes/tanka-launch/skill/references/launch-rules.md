# launch-rules: the brand and market lint

**Load at:** every gate — before `options set` on `script`, `assets`, `picture`, and before the rough cut and finals are shown. Also whenever the producer asks for a "market check" or a "brand check".

**Reads:** the stage's files (script JSON, scenes.json, rendered DOM text or contact sheets, captions). **Writes:** `stages/<stage>/lint.json` = `{ stage, at, violations:[{rule, where, text, fix}], overrides:[{rule, where, by:"producer", note}] }`.

The rules come in two layers. **House rules** (R1–R19) hold for every run. **Market presets** (the M-rules below) are editable examples: keep the ones that fit the product and the market, rewrite or drop the rest in this file, and record a run-specific change in the run's `direction.md`.

## Procedure

1. Run every check below against the stage's files. R1, R8, R11 and R12 are automated for scenes.json and lines.json by `qc/lint.py` (also `qc.py lint --script` for the script, and inside every QC record); names pass only when the brief sets `allowNames` (`true`, or the list of allowed names, e.g. a buyer's first name in a US story). The lint can't see kit defaults a scene inherits by omitting a prop: check the sheets. Text checks run on the script and captions JSON; picture checks run on contact sheets (look at them) and, when available, the rendered DOM text dump from QC.
2. Fix violations before showing the stage. A violation you can't fix goes into the stage page as a red row with the proposed fix.
3. An exception needs the producer's explicit override in chat. Record it in `overrides` with their words. Never carry an override to another run.

## House rules

| # | Rule | Why | Check |
|---|---|---|---|
| R1 | **The brand in its display form in every on-screen text** (subtitles, type screens, marketing copy, the product UI), as set by `run.brief.brand` (else the `brand` preset in `scripts/common/style.json`; example: `{"display": "ACME", "match": ["Acme"], "spoken": {"en": "Acme", "ja": "アクメ"}}`). TTS text uses the spoken form. **Write the display form in the script text in both languages** (never the JA reading): the scripts derive the spoken form from it (`tts_text`), and the captions show the script text. | The brand is spelled one way on screen. | `qc/lint.py` lint-brand-caps: 0 other spellings in display text |
| R2 | Labels that name the product's assistant or any persona use `brand.assistantName` (the producer's choice; never hard-coded; default "your assistant"), one name everywhere. | One name per product, chosen by its owner. | string scan of labels |
| R3 | **Fictional companies and people**; roles over names (e.g. "Client contact", 「担当者」); if the film shows invented stories, a disclaimer ("All stories, people and companies in this film are fictional.") legible ≥ 1.5 s. A story may name a buyer when the brief allows it (`allowNames`). | Real names read as endorsements; invented names read as real people. | name list vs cast; disclaimer frame on the sheet |
| R4 | **Anonymised data only.** No real customer, colleague or personal data in UI content. | Privacy. | content scan against the cast list |
| R5 | **Real product UI only** (from the product's design source or PRD; see `launch-product-ui.md`). | Don't make up the interface. | every UI element maps to a source |
| R6 | No feature is claimed without a PRD or design source. | A launch film is a promise. | every scene has `source` |
| R7 | **No web chrome as video design:** no corner avatar badges, animated top captions, popup cards on typing or @mention. | Reads as a web page, not a film. | picture sheet check |
| R8 | **Roles over names** in on-screen text and VO (automated: `qc/lint.py` lint-names). | See R3. | lint |
| R9 | **One hero per frame; no avatar badges** on people or cards. | Focus. | sheet check |
| R10 | **Each parallel idea gets its own beat** (three results, three folders, three settings rows one by one), never one crowded frame. | Legibility at speed. | storyboard review |
| R11 | **Only integrations that exist:** show only services the product actually integrates with (`run.brief.integrations` / the `integrations` preset: `allow` and `deny` lists; automated for the deny list). | A logo on screen is a claim. | lint-integrations + icon check on sheets |
| R12 | **No leftovers** from kit defaults, placeholders or earlier films (automated: kit default lines, Lorem / TODO / placeholder, and `run.brief.leftovers` — e.g. a previous film's cast). | Carried-over content is the most common silent defect. | lint-leftovers + content scan vs this run's cast list |
| R13 | **Logo:** the product's official logo file from the asset roots (light on dark, dark on light), never a self-drawn icon. | Brand integrity. | asset check on sheets |
| R14 | **No dark or eerie intro** unless the brief asks for it. | First seconds set the tone. | first 6 s sheet |
| R15 | **Cards and panels expand, then settle** back into their slot; they don't pop in and vanish. | Continuity. | motion check |
| R16 | **Persistent UI stays and adapts** (e.g. a composer that changes with context) instead of disappearing between scenes. | Continuity. | motion check |
| R17 | **Borrow a reference film's motion logic, never its story.** | Originality. | script review |
| R18 | **The ending doesn't jump to an outcome the product doesn't deliver** (an order fulfilled, revenue booked). | Honest claims. | last use-case beat |
| R19 | **No money or order outcomes on screen** unless the brief asks for them. | Claims about results need evidence. | numbers lint (¥, $, 円, units, "order") on script and captions |

## Market presets (editable examples)

Enable a preset per run with `run.brief.market` (`us` · `jp` · `both`). These are starting points written for an assistant-style B2B product; adapt them to yours.

| # | Preset | Rule | Check |
|---|---|---|---|
| M1 | jp | **No outbound message before the owner's tap**, not even overnight. Overnight the AI only reads, prepares and drafts ("Draft · waiting for <owner>"); the morning tap sends. | every send is preceded by a visible user tap |
| M2 | jp | The AI never reports to a manager or coordinates others without the person in charge knowing. It proposes; the owner sends. | scene lint on report / coordination beats |
| M3 | jp | **No after-hours work by humans**; no manager approving on a phone at home. Only the AI works overnight, and only prepares. | night beats show no human working |
| M4 | jp | **No recording or eavesdropping cues.** Meeting sources are official notes from connected tools; say "from the tools you connect". | no "listening" / "quietly remembers" copy, no recorder visuals |
| M5 | jp | **No "say less" framing.** Frame it as: the user decides, the product makes sure they're ready. | copy lint |
| M6 | jp | Word choice with workplace weight: e.g. 異動 (transfer), not 退職 (quit), for a colleague who changed teams. | VO read check (`launch-vo.md`) |
| M7 | jp | Wardrobe for any on-screen character follows office norms (e.g. sleeves; no sleeveless tops). | footage / image check |
| M8 | both | **An action card goes to its owner first.** Only after the tap does the assistant message others. The assistant never speaks up in a group unprompted. | scene lint on messaging beats |
| M9 | both | **Internal review comes before anything goes to a client.** | order of beats in client-facing flows |
| M10 | us | A US story may name a buyer (`allowNames`); keep company names fictional. | name lint with the allow list |

## Acceptance

`lint.json` has zero open violations at the script, assets, picture, rough-cut and finals gates, and every override quotes the producer.
