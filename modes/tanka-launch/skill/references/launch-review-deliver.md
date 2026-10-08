# launch-review-deliver: option pages, hand-offs, delivery

**Load at:** every stage when you register options, and at `deliver`. Reload on "compare page", "让我选", "deliver".

**Reads:** the stage's options and previews, `tl.mjs status --json`, the producer's notes. **Writes:** `stages/<id>/options.json` + previews, `stages/<id>/fixes.md` (numbered review lists); the deliver scripts write `out/deliver/<run>-delivery-note.md` and `out/deliver/reminder.json`.

## Stage protocol (what to show, what the producer decides, what defaults)

| Stage | Options | Preview format | The producer decides | Default on timeout / auto-run |
|---|---|---|---|---|
| idea | 1 (the brief) | `brief.html` | market, angle constraints, formats | their typed idea is the confirmation; the JP market preset on for `jp`/`both`; no names; disclaimer |
| script | 3 (from 5 angles) | per-line table HTML with density totals | angle; per-line keep / short / cut | the use-case-template option; natural pace; captions = VO |
| music | 3 (per-scene BPM · one-grid density · contrast bed) | demo MP3 (bed + guide VO) + BPM lane | the bed and arrangement | per-scene BPM when the brief asks for tempo changes, else one-grid |
| voice | 3–4 per language | sample MP3s on the same line | voice per language | the last approved voice per language |
| vo | 2 takes per line | players + transcripts + fit | per-line picks | the best measured take |
| assets | library-only vs library + generated | UI map, take boards, costs | which gaps to buy | library first |
| picture | 1 build (+ HTML prototypes only for a new special piece) | VO-only MP4 per version, sheets | timecoded comments | the previous pick for any special piece |
| sound | 1 rough mix (+ timbre options for a new signature moment) | rough-cut MP4 + sound map | missing/unwanted moments | all typing and clicks audible |
| **roughcut** | the lead format in each voiced language (lead language first) | MP4 + QC report | **approve (hard gate)** | **none: waits for the producer** |
| finals | all formats × languages | MP4s + QC | OK or one-line fixes | none: waits for the producer |
| deliver | – | log | explicit OK (finals approval) | – |

## Rules

1. **Every option page names what changed vs the last pick** and differs from its siblings in one dimension where possible; shared VO and picture are stream-copied so only the variable changes.
2. **Always include "previous + the change"** next to a bold rewrite after a comment (over-correction wastes loops).
3. **Send each render the moment it passes QC; never batch.** The producer's waiting time is the bottleneck. In Pneuma: navigate the viewer to the new version node and say one line. Outside Pneuma: open the file or page for them, don't just paste a path.
4. **Exemplar first, then fan out.** Build the lead version (primary format × lead language) through QC first; the others follow its approved rhythm in one pass.
5. **Read the producer's input before acting:** chat, viewer context, stage `notes`. A **numbered, timecoded review list** becomes `stages/<stage>/fixes.md` (one row per item: time, what, fix, status) and your report answers item by item. A **one-line reversal** ("don't delete them after all") restores the previous state exactly; don't re-interpret it.
6. **Never keep two sessions on one film.** If the producer seems to send the same instruction to two sessions, say so and ask which one owns the film (duplicate implementations shift frame counts).

## Delivery

1. Only after the producer approves `finals` (`approve finals --by producer`, from their explicit OK). Never on a countdown.
2. Copy **only the final MP4s** with `"<SKILL_DIR>/scripts/py" deliver/deliver.py --yes` (`--yes` = the producer's final OK in chat; the script also refuses unless the rough cut was approved by the producer). Destination: `deliveryDir`/`<run id>/` (default `~/LaunchStudio/deliveries/<run id>/`); copies are verified by sha256 and frame count; the delivery note goes to `out/deliver/<run>-delivery-note.md`. Mock mode delivers into `out/mock-delivery/`.
3. **Keep the previous final as the fallback.** The script renames an existing final to `<name>-fallback.mp4` (an older fallback gets a timestamp); never delete or overwrite one by hand.
4. **Reminder:** `deliver/reminder.py` (or `deliver.py --remind "…" --due …`) only records it (`out/deliver/reminder.json`, status `stubbed`; no task-manager integration is bundled). After the producer's final OK, set it in the producer's task manager if a tool for it is available, then mark it `set`; otherwise give the producer the exact reminder text and say it wasn't set.
5. Check the delivery note (hashes, paths, time, reminder status); then `tl.mjs approve deliver`.
6. Names come from the script: `<brand>-<run>-<format>-<LANG>.mp4` (Q16).

## Gotchas

- Artifacts over 64 MB can't be published; comparisons of several MP4s stay local pages (the viewer handles them in Pneuma).
- Superseded deliveries pile up in the delivery folder. Ask before removing anything; mark the current one in the log.
- Copies renamed by hand don't match build names; the delivery log is the mapping.

## Acceptance

Every review page names what changed; every delivered file has a verified copy, a row in the delivery note and a fallback; the reminder is `set`, or "not set" with the text handed to the producer.

## Scripts

Run Python scripts as `"<SKILL_DIR>/scripts/py" <area>/<script>.py`; each `--help` is authoritative. Present in `<SKILL_DIR>/scripts/` now:

- `deliver/deliver.py` — Stage 10 · deliver the finals: copy out/final/*.mp4 to <deliveryDir>/<run>/, keep the previous final as '…-fallback', write a
- `deliver/reminder.py` — Reminder hook (STUB): records the reminder the delivery wants and prints what to do; it does not create one yet.

