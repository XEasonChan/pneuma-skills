/**
 * Launch Studio stage state — ONE algorithm for two runtimes.
 *
 * `film.json` stores hints (`state`), options, picks, deadlines and
 * approvals. The STATUS of a stage is never stored: it is derived here, by
 * the same code in `tl.mjs` (Bun / Node) and in the viewer (browser), so the
 * canvas and the stage-machine CLI can never disagree (contracts §2).
 *
 * This module is pure: no `node:*` imports, no I/O, no clock reads. Callers
 * pass `texts` (workspace-relative path → UTF-8 text of every hashable file)
 * and `now` (epoch ms).
 *
 *   locked    an upstream stage is not confirmed
 *   empty     nothing registered yet
 *   working   the director marked the stage as being worked on (or blocked)
 *   awaiting  options are ready and nobody has picked (the countdown runs)
 *   confirmed picked/approved, and the files still hash to the approval
 *   changed   the stage's files no longer hash to what was approved
 *   stale     an upstream stage changed, moved, or was re-picked after this
 *             stage was approved
 *   done      a final stage (finals, deliver) approved and unchanged
 *
 * Only `confirmed` and `done` let the next stage start.
 */

import { sha256 } from "./sha256.mjs";

export const STAGES = Object.freeze([
  "idea",
  "script",
  "music",
  "voice",
  "vo",
  "assets",
  "picture",
  "sound",
  "roughcut",
  "finals",
  "deliver",
]);

/** Display order number, label and how the viewer renders the stage. */
export const STAGE_META = Object.freeze({
  idea: { n: "1", label: "Idea", medium: "brief", countdown: false, final: false },
  script: { n: "2", label: "Script", medium: "script", countdown: true, final: false },
  music: { n: "3", label: "Music & rhythm", medium: "music", countdown: true, final: false },
  voice: { n: "4", label: "Voice", medium: "voice", countdown: true, final: false },
  vo: { n: "5", label: "VO", medium: "vo", countdown: true, final: false },
  assets: { n: "6", label: "Assets", medium: "assets", countdown: true, final: false },
  picture: { n: "7", label: "Picture", medium: "video", countdown: true, final: false },
  sound: { n: "8", label: "Sound", medium: "video", countdown: true, final: false },
  roughcut: { n: "★", label: "Rough cut", medium: "video", countdown: false, final: false },
  finals: { n: "9", label: "Finals", medium: "video", countdown: false, final: true },
  deliver: { n: "10", label: "Deliver", medium: "deliver", countdown: false, final: true },
});

/** The hard gate: only the producer approves it; countdowns and auto-run never pass it. */
export const HARD_GATE = "roughcut";

/** Stages that get a deadline when their options are registered (stages 2–8). */
export const COUNTDOWN_STAGES = Object.freeze(STAGES.filter((s) => STAGE_META[s].countdown));

export const STATUSES = Object.freeze([
  "locked",
  "empty",
  "working",
  "awaiting",
  "confirmed",
  "changed",
  "stale",
  "done",
]);

/** Statuses that let the next stage start. */
export const PASSING = Object.freeze(["confirmed", "done"]);

export const PICKED_BY = Object.freeze(["producer", "auto-timeout", "auto-run"]);

/**
 * Which workspace files are HASH INPUTS. A file is hashed only if it is text
 * AND the viewer receives it, so this list and the manifest's
 * `viewer.watchPatterns` must agree (a test pins that). Everything else a
 * stage references — MP3, MP4, PNG — enters the hash by its path only.
 */
export const HASH_TEXT_PATTERNS = Object.freeze([
  /^stages\/.+\.(json|md|txt|srt|vtt)$/,
  /^timeline\.json$/,
  /^timelines\/[^/]+\.json$/,
  /^remotion\/scenes\.json$/,
  /^out\/qc\/.+\.json$/,
]);

export function isHashText(path) {
  return typeof path === "string" && HASH_TEXT_PATTERNS.some((re) => re.test(path));
}

/**
 * Files a stage owns outside `stages/<id>/`. They are what the stage
 * produced: the picture is `remotion/scenes.json`, the rough cut is its QC
 * records, the finals are theirs. The rough cut's clocks enter its hash as
 * the picked option's files (`timelines/<format>-<lang>.json` of each
 * rough-cut version): NOT the whole `timelines/` folder or `timeline.json`,
 * which the finals' renders of the other formats and languages rewrite — a
 * prefix there would re-open the hard gate on every finals render.
 */
export const STAGE_EXTRA_PREFIXES = Object.freeze({
  picture: ["remotion/scenes.json"],
  roughcut: ["out/qc/roughcut"],
  finals: ["out/qc/final"],
});

// ── Small pure helpers ──────────────────────────────────────────────────────

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

/** JSON with object keys sorted at every depth, so key order never changes a hash. */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

export function isStage(value) {
  return typeof value === "string" && STAGES.includes(value);
}

export function stageIndex(stage) {
  return STAGES.indexOf(stage);
}

/** Epoch ms of an ISO string, or null. */
export function isoMs(value) {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * PER-LANGUAGE STAGES. When every option of a stage carries a `lang`
 * (voice auditions: `ja-konoha`, `en-calm`, …), the stage takes ONE pick PER
 * LANGUAGE: the pick is the comma-joined ids, one per language in the order
 * the options first name them (`"ja-konoha,en-calm"`), and each language has
 * its own recommended option. Scripts read the pick the same way
 * (vo/generate.py splits it).
 */
export function langGroups(options) {
  const list = arr(options).filter((o) => isRecord(o) && typeof o.id === "string");
  if (list.length === 0 || !list.every((o) => typeof o.lang === "string" && o.lang)) return null;
  const groups = new Map();
  for (const o of list) {
    if (!groups.has(o.lang)) groups.set(o.lang, []);
    groups.get(o.lang).push(o);
  }
  return groups;
}

/** A composite option (one per language) built from its parts, or null. */
function compositeOf(parts) {
  if (!parts.length) return null;
  return {
    id: parts.map((p) => p.id).join(","),
    title: parts.map((p) => p.title ?? p.id).join(" + "),
    files: parts.flatMap((p) => arr(p.files)),
    recommended: parts.every((p) => p.recommended === true),
    composite: true,
    parts: parts.map((p) => p.id),
  };
}

/**
 * The option an id names: a registered option, or — on a per-language stage —
 * a composite `"a,b"` naming exactly one option per language. Null otherwise.
 */
export function resolveOption(stage, optionId) {
  const options = arr(stage?.options).filter((o) => isRecord(o) && typeof o.id === "string");
  if (typeof optionId !== "string" || !optionId) return null;
  const direct = options.find((o) => o.id === optionId);
  if (direct && !langGroups(options)) return direct;
  const groups = langGroups(options);
  if (!groups) return null;
  const ids = optionId.split(",").map((x) => x.trim()).filter(Boolean);
  const parts = ids.map((id) => options.find((o) => o.id === id));
  if (parts.some((p) => !p)) return null;
  const langs = parts.map((p) => p.lang);
  if (new Set(langs).size !== langs.length || langs.length !== groups.size) return null;
  const order = [...groups.keys()];
  return compositeOf(parts.slice().sort((a, b) => order.indexOf(a.lang) - order.indexOf(b.lang)));
}

/** The option a timeout or auto-run takes: the flagged one, else the first (per language on a per-language stage). */
export function recommendedOption(stage) {
  const options = arr(stage?.options).filter((o) => isRecord(o) && typeof o.id === "string");
  const groups = langGroups(options);
  if (groups) return compositeOf([...groups.values()].map((g) => g.find((o) => o.recommended === true) ?? g[0]));
  return options.find((o) => o.recommended === true) ?? options[0] ?? null;
}

function optionPaths(option) {
  const paths = arr(option?.files).filter((f) => typeof f === "string" && f.length > 0);
  if (typeof option?.preview === "string" && option.preview) paths.push(option.preview);
  return paths;
}

// ── Hashing ─────────────────────────────────────────────────────────────────

/**
 * The inputs that define a stage right now, as `{ path, value }` strings.
 *
 * - idea: the brief in film.json.
 * - a stage with a pick: the picked option's record and its files (text by
 *   content, media by path). Sibling options are NOT inputs: asking for more
 *   options must not un-confirm what was picked.
 * - every stage: its own text files under `stages/<id>/` except the
 *   `options/` folder, plus the files it produced elsewhere
 *   (`STAGE_EXTRA_PREFIXES`).
 */
export function stageHashInputs(film, stageId, texts = {}) {
  const stage = isRecord(film?.stages?.[stageId]) ? film.stages[stageId] : {};
  const inputs = [];
  const seen = new Set();
  const add = (path, value) => {
    if (seen.has(path)) return;
    seen.add(path);
    inputs.push({ path, value });
  };
  const fileValue = (path) =>
    typeof texts[path] === "string" ? texts[path] : `media:${path}`;

  if (stageId === "idea") {
    add("film.json#run.brief", stableStringify(film?.run?.brief ?? null));
  }

  const pickId = typeof stage.pick === "string" ? stage.pick : null;
  const picked = pickId ? resolveOption(stage, pickId) : null;
  if (pickId) {
    add(
      `film.json#stages.${stageId}.pick`,
      stableStringify(
        picked
          ? {
              id: picked.id,
              title: picked.title ?? null,
              files: arr(picked.files),
              preview: picked.preview ?? null,
            }
          : { id: pickId, missing: true },
      ),
    );
    for (const path of optionPaths(picked).sort()) add(path, fileValue(path));
  }

  const own = `stages/${stageId}/`;
  const optionsDir = `stages/${stageId}/options/`;
  const extras = STAGE_EXTRA_PREFIXES[stageId] ?? [];
  const owned = Object.keys(texts)
    .filter((p) => isHashText(p))
    .filter(
      (p) =>
        (p.startsWith(own) && !p.startsWith(optionsDir)) ||
        extras.some((prefix) => p === prefix || p.startsWith(prefix)),
    )
    .sort();
  for (const path of owned) add(path, texts[path]);

  return inputs.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** SHA-256 of the stage's inputs, or null when nothing defines it yet. */
export function hashStage(film, stageId, texts = {}) {
  const inputs = stageHashInputs(film, stageId, texts);
  if (inputs.length === 0) return null;
  return sha256(inputs.map((i) => `${i.path}\u0000${i.value}\u0000`).join(""));
}

// ── Derivation ──────────────────────────────────────────────────────────────

function approvalOf(stage) {
  const a = stage?.approval;
  return isRecord(a) && typeof a.hash === "string" ? a : null;
}

/** Order of two approvals: by `seq` when both have one, else by `at`. */
function approvalRank(approval) {
  if (!approval) return -Infinity;
  if (typeof approval.seq === "number") return approval.seq;
  return isoMs(approval.at) ?? -Infinity;
}

function newerThan(a, b) {
  if (!a || !b) return false;
  if (typeof a.seq === "number" && typeof b.seq === "number") return a.seq > b.seq;
  const am = isoMs(a.at);
  const bm = isoMs(b.at);
  return am !== null && bm !== null && am > bm;
}

/**
 * Derive every stage, in order.
 *
 * Returns one record per stage:
 * `{ id, n, label, status, reason, options, pick, pickedBy, recommended,
 *    deadline, deadlineMs, remainingMs, expired, approval, hash, blocked,
 *    state, notes }`
 */
export function deriveStages(film, texts = {}, now = 0) {
  const out = [];
  for (let i = 0; i < STAGES.length; i += 1) {
    const id = STAGES[i];
    const meta = STAGE_META[id];
    const stage = isRecord(film?.stages?.[id]) ? film.stages[id] : {};
    const options = arr(stage.options).filter((o) => isRecord(o) && typeof o.id === "string");
    const approval = approvalOf(stage);
    const deadlineMs = isoMs(stage.deadline);
    const pick = typeof stage.pick === "string" ? stage.pick : null;
    const rec = {
      id,
      n: meta.n,
      label: meta.label,
      medium: meta.medium,
      status: "empty",
      reason: null,
      options,
      pick,
      pickedBy: stage.pickedBy ?? null,
      recommended: recommendedOption(stage)?.id ?? null,
      deadline: stage.deadline ?? null,
      deadlineMs,
      remainingMs: null,
      expired: false,
      approval,
      hash: null,
      blocked: stage.state === "blocked",
      state: typeof stage.state === "string" ? stage.state : "empty",
      notes: typeof stage.notes === "string" ? stage.notes : "",
    };

    const upstream = out.slice(0, i);
    const blocking = upstream.find((u) => !PASSING.includes(u.status)) ?? null;

    if (approval) {
      const moved =
        upstream.find((u) => u.status === "changed" || u.status === "stale") ??
        upstream.find((u) => newerThan(u.approval, approval)) ??
        null;
      if (moved) {
        rec.status = "stale";
        rec.reason =
          moved.status === "changed" || moved.status === "stale"
            ? `${moved.id} is ${moved.status}`
            : `${moved.id} was confirmed again after this stage`;
      } else if (blocking) {
        rec.status = "stale";
        rec.reason = `${blocking.id} is ${blocking.status}`;
      } else {
        rec.hash = hashStage(film, id, texts);
        if (rec.hash !== approval.hash) {
          rec.status = "changed";
          rec.reason = "files changed after approval";
        } else {
          rec.status = meta.final ? "done" : "confirmed";
        }
      }
    } else if (blocking) {
      rec.status = "locked";
      rec.reason = `waiting for ${blocking.id}`;
    } else if (options.length > 0 && !pick) {
      rec.status = "awaiting";
      if (deadlineMs !== null) {
        rec.remainingMs = deadlineMs - now;
        rec.expired = rec.remainingMs <= 0;
      }
    } else if (options.length > 0 && pick) {
      // A pick with no recorded approval: `tl.mjs pick` always writes both,
      // so this is a hand edit. It is not confirmed until approved.
      rec.status = "awaiting";
      rec.reason = "picked but not approved";
    } else if (stage.state === "working" || stage.state === "blocked") {
      rec.status = "working";
      if (stage.state === "blocked") rec.reason = stage.notes || "blocked";
    } else if (meta.final && hashStage(film, id, texts) !== null) {
      // Finals and delivery have no options: once their records exist they
      // wait for the OK (finals: the producer's; delivery: the copy report).
      rec.status = "awaiting";
      rec.reason = id === "finals" ? "finals rendered — waiting for the producer's OK" : "delivery report written — approve to close the run";
    }
    out.push(rec);
  }
  return out;
}

/** Status of one stage. */
export function stageStatus(film, stageId, texts = {}, now = 0) {
  return deriveStages(film, texts, now).find((s) => s.id === stageId)?.status ?? null;
}

/** The first stage that does not pass (what the run is waiting on), or null. */
export function nextOpenStage(derived) {
  return derived.find((s) => !PASSING.includes(s.status)) ?? null;
}

/** Awaiting countdown stages whose deadline has passed, earliest first. */
export function expiredDeadlines(derived) {
  return derived
    .filter((s) => s.status === "awaiting" && s.expired && s.id !== HARD_GATE && s.deadlineMs !== null)
    .sort((a, b) => a.deadlineMs - b.deadlineMs);
}

/** The next deadline still running (for the viewer's timer), or null. */
export function nextDeadline(derived) {
  const running = derived
    .filter((s) => s.status === "awaiting" && s.deadlineMs !== null && !s.expired)
    .sort((a, b) => a.deadlineMs - b.deadlineMs);
  return running[0] ?? null;
}

/** Highest approval rank in a film — used to order approvals. */
export function maxApprovalRank(film) {
  let max = 0;
  for (const id of STAGES) {
    const r = approvalRank(approvalOf(film?.stages?.[id]));
    if (Number.isFinite(r) && r > max) max = r;
  }
  return max;
}

/** "mm:ss" (or "h:mm:ss") for a remaining duration; "0:00" when past. */
export function formatCountdown(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "";
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
