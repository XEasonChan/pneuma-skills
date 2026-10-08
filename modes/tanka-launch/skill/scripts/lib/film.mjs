/**
 * film.json — pure operations. `tl.mjs` is the only writer of the file; it
 * reads the workspace, calls these functions and writes the result. Every
 * function here takes the current time and the hashable texts as arguments,
 * so the same rules run in tests with a fake clock.
 *
 * Rules enforced here (contracts §1–§3):
 * - `roughcut` is the hard gate: only `--by producer` picks or approves it.
 * - a countdown expiring, or auto-run, never passes `roughcut`.
 * - a locked stage cannot be picked, approved or given options.
 * - `pick` records the approval (hash of the stage's files) in the same step,
 *   so "confirmed" always means "confirmed against these exact files".
 */

import {
  COUNTDOWN_STAGES,
  HARD_GATE,
  PICKED_BY,
  STAGES,
  STAGE_META,
  deriveStages,
  expiredDeadlines,
  hashStage,
  isRecord,
  isStage,
  isoMs,
  langGroups,
  maxApprovalRank,
  recommendedOption,
  resolveOption,
  stageIndex,
} from "./stage-state.mjs";

export const SCHEMA = 1;
export const DEFAULT_FORMATS = Object.freeze(["short-16x9", "short-9x16"]);
export const DEFAULT_LANGUAGES = Object.freeze(["ja", "en", "en-jasub"]);
export const DEFAULT_SETTINGS = Object.freeze({ budgetUsd: 60, countdownMin: 30, mock: false });
const MAX_EVENTS = 300;

/** A refusal with a stable code and the CLI exit code that reports it. */
export class TLError extends Error {
  constructor(code, message, exitCode = 2) {
    super(message);
    this.name = "TLError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function emptyStage() {
  return {
    state: "empty",
    options: [],
    pick: null,
    pickedBy: null,
    deadline: null,
    approval: null,
    notes: "",
  };
}

/** ISO week number, for run ids like `2026-w40-memory-recall`. */
function isoWeek(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((thursday.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
    );
  return { year: thursday.getUTCFullYear(), week };
}

export function slugify(text, maxWords = 4) {
  const words = String(text ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w && !["a", "an", "the", "and", "of", "to", "for", "with", "in", "on"].includes(w))
    .slice(0, maxWords);
  return words.join("-");
}

export function runIdFor(title, idea, nowMs) {
  const { year, week } = isoWeek(nowMs);
  const slug = slugify(title) || slugify(idea) || "run";
  return `${year}-w${String(week).padStart(2, "0")}-${slug}`;
}

function titleFrom(idea) {
  const line = String(idea ?? "").split(/\n/)[0].trim();
  if (!line) return "New launch run";
  return line.length > 72 ? `${line.slice(0, 69).trimEnd()}…` : line;
}

function listOf(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/[,|]/).map((v) => v.trim()).filter(Boolean);
  return [];
}

function pushEvent(film, ms, event, stage, detail) {
  if (!Array.isArray(film.events)) film.events = [];
  const entry = { at: iso(ms), event };
  if (stage) entry.stage = stage;
  if (detail !== undefined) entry.detail = detail;
  film.events.push(entry);
  if (film.events.length > MAX_EVENTS) film.events.splice(0, film.events.length - MAX_EVENTS);
}

function nextSeq(film) {
  const current = Math.max(typeof film.seq === "number" ? film.seq : 0, maxApprovalRank(film));
  film.seq = Math.floor(current) + 1;
  return film.seq;
}

/** Bring any parsed film.json to the full shape (every stage present). */
export function normalizeFilm(raw) {
  const film = isRecord(raw) ? clone(raw) : {};
  film.schema = SCHEMA;
  if (!isRecord(film.run)) film.run = {};
  if (!isRecord(film.run.brief)) film.run.brief = {};
  const brief = film.run.brief;
  if (typeof brief.idea !== "string") brief.idea = "";
  if (!["us", "jp", "both"].includes(brief.market)) brief.market = "both";
  brief.formats = listOf(brief.formats).length ? listOf(brief.formats) : [...DEFAULT_FORMATS];
  brief.languages = listOf(brief.languages).length ? listOf(brief.languages) : [...DEFAULT_LANGUAGES];
  brief.sellingPoints = listOf(brief.sellingPoints);
  if (!isRecord(brief.sources)) brief.sources = {};
  brief.sources.figma = listOf(brief.sources.figma);
  brief.sources.prd = listOf(brief.sources.prd);
  if (!isRecord(film.settings)) film.settings = {};
  film.settings = { ...DEFAULT_SETTINGS, ...film.settings };
  if (!isRecord(film.stages)) film.stages = {};
  for (const id of STAGES) {
    film.stages[id] = { ...emptyStage(), ...(isRecord(film.stages[id]) ? film.stages[id] : {}) };
    if (!Array.isArray(film.stages[id].options)) film.stages[id].options = [];
  }
  if (!isRecord(film.autoRun)) film.autoRun = { enabled: false, until: HARD_GATE };
  film.autoRun.until = HARD_GATE;
  film.autoRun.enabled = film.autoRun.enabled === true;
  if (typeof film.seq !== "number") film.seq = maxApprovalRank(film);
  if (!Array.isArray(film.events)) film.events = [];
  return film;
}

/**
 * A new film. With an idea, the idea stage is confirmed by the producer — they typed
 * it — and the script stage can start. Without one (the seed), nothing is.
 */
export function createFilm(input = {}, { now, texts = {} } = {}) {
  const ms = now ?? 0;
  const idea = String(input.idea ?? "").trim();
  const title = String(input.title ?? "").trim() || titleFrom(idea);
  const settings = { ...DEFAULT_SETTINGS };
  if (input.settings) {
    for (const [k, v] of Object.entries(input.settings)) {
      if (v !== undefined && v !== null && v !== "") settings[k] = v;
    }
  }
  const film = normalizeFilm({
    schema: SCHEMA,
    run: {
      id: input.id || (idea ? runIdFor(input.title, idea, ms) : "new-run"),
      title: idea ? title : "New launch run",
      createdAt: iso(ms),
      brief: {
        idea,
        market: input.market,
        formats: input.formats,
        languages: input.languages,
        sellingPoints: input.sellingPoints,
        sources: { figma: input.figma, prd: input.prd },
      },
    },
    settings,
    stages: {},
    autoRun: { enabled: false, until: HARD_GATE },
    seq: 0,
    events: [],
  });
  pushEvent(film, ms, "init", null, idea ? { title: film.run.title } : { seed: true });
  if (idea) confirmIdea(film, { now: ms, texts, by: "producer" });
  return film;
}

function confirmIdea(film, { now, texts, by }) {
  const stage = film.stages.idea;
  stage.approval = { hash: hashStage(film, "idea", texts), at: iso(now), by, seq: nextSeq(film) };
  stage.state = "confirmed";
  stage.pickedBy = by;
}

/** Merge a brief patch. `--by producer` re-confirms the idea (downstream goes stale). */
export function setBrief(filmIn, patch, { now, texts = {}, by = null } = {}) {
  const film = normalizeFilm(filmIn);
  if (!isRecord(patch)) throw new TLError("bad-brief", "brief must be a JSON object", 1);
  const brief = film.run.brief;
  // every brief field merges (idea, market, formats, languages, sellingPoints and the run's presets: brand, integrations,
  // allowNames, leftovers, music…); `sources` merges per key and `title` names the run
  for (const [key, value] of Object.entries(patch)) {
    if (key !== "sources" && key !== "title" && value !== undefined) brief[key] = value;
  }
  if (isRecord(patch.sources)) {
    if (patch.sources.figma !== undefined) brief.sources.figma = patch.sources.figma;
    if (patch.sources.prd !== undefined) brief.sources.prd = patch.sources.prd;
  }
  if (typeof patch.title === "string" && patch.title.trim()) film.run.title = patch.title.trim();
  const normalized = normalizeFilm(film);
  pushEvent(normalized, now, "brief", "idea");
  if (by === "producer" && normalized.run.brief.idea) confirmIdea(normalized, { now, texts, by });
  return normalized;
}

function assertStage(stageId) {
  if (!isStage(stageId)) {
    throw new TLError("unknown-stage", `unknown stage "${stageId}" (one of: ${STAGES.join(", ")})`, 1);
  }
}

function derivedOf(film, stageId, texts, now) {
  return deriveStages(film, texts, now).find((s) => s.id === stageId);
}

function assertUnlocked(film, stageId, texts, now, verb) {
  const d = derivedOf(film, stageId, texts, now);
  if (d.status === "locked") {
    throw new TLError("locked", `cannot ${verb} "${stageId}": it is locked (${d.reason})`);
  }
  return d;
}

function safeRelPath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.split("/").includes("..") &&
    !/^[a-zA-Z]:/.test(path)
  );
}

/** Validate an options array (contracts §1). Returns a clean copy. */
export function validateOptions(options) {
  if (!Array.isArray(options) || options.length === 0) {
    throw new TLError("bad-options", "options must be a non-empty JSON array", 1);
  }
  const ids = new Set();
  const clean = options.map((o, i) => {
    if (!isRecord(o)) throw new TLError("bad-options", `option #${i + 1} is not an object`, 1);
    const id = typeof o.id === "string" ? o.id.trim() : "";
    if (!id || !/^[A-Za-z0-9._-]{1,40}$/.test(id)) {
      throw new TLError("bad-options", `option #${i + 1} needs an id of letters, digits, . _ or -`, 1);
    }
    if (ids.has(id)) throw new TLError("bad-options", `duplicate option id "${id}"`, 1);
    ids.add(id);
    const files = Array.isArray(o.files) ? o.files : [];
    for (const f of files) {
      if (!safeRelPath(f)) throw new TLError("bad-options", `option ${id}: file "${f}" must be a workspace-relative path`, 1);
    }
    if (o.preview !== undefined && o.preview !== null && !safeRelPath(o.preview)) {
      throw new TLError("bad-options", `option ${id}: preview must be a workspace-relative path`, 1);
    }
    const out = { ...o, id, title: typeof o.title === "string" ? o.title : id, files };
    if (typeof o.summary !== "string") delete out.summary;
    out.recommended = o.recommended === true;
    return out;
  });
  // One recommended option — per language on a per-language stage (every option has a `lang`).
  const groups = langGroups(clean);
  for (const group of groups ? [...groups.values()] : [clean]) {
    const flagged = group.filter((o) => o.recommended);
    if (flagged.length === 0) group[0].recommended = true;
    if (flagged.length > 1) for (const o of flagged.slice(1)) o.recommended = false;
  }
  return clean;
}

/**
 * Register a stage's options. Starts the countdown on stages 2–8; clears the
 * pick and approval unless `keepPick` and the picked id is still offered.
 */
export function setOptions(filmIn, stageId, options, { now, texts = {}, countdownMin, keepPick = false } = {}) {
  assertStage(stageId);
  if (stageId === "idea") {
    throw new TLError("bad-stage", `the idea stage has no options; use "brief set"`, 1);
  }
  const film = normalizeFilm(filmIn);
  assertUnlocked(film, stageId, texts, now, "set options on");
  const clean = validateOptions(options);
  const stage = film.stages[stageId];
  const keep = keepPick && stage.pick && resolveOption({ options: clean }, stage.pick) !== null;
  const minutes = Number(countdownMin ?? film.settings.countdownMin ?? DEFAULT_SETTINGS.countdownMin);
  stage.options = clean;
  stage.state = keep ? stage.state : "options";
  if (!keep) {
    stage.pick = null;
    stage.pickedBy = null;
    stage.pickedAt = null;
    stage.approval = null;
  }
  stage.optionsAt = iso(now);
  stage.deadline =
    !keep && COUNTDOWN_STAGES.includes(stageId) && Number.isFinite(minutes) && minutes > 0
      ? iso(now + Math.round(minutes * 60000))
      : keep
        ? stage.deadline
        : null;
  pushEvent(film, now, "options", stageId, { ids: clean.map((o) => o.id), deadline: stage.deadline });
  return film;
}

function assertBy(by, allowed, verb) {
  if (!allowed.includes(by)) {
    throw new TLError("bad-by", `${verb} --by must be one of: ${allowed.join(", ")}`, 1);
  }
}

/**
 * Pick an option and record the approval of the stage in the same step.
 * Returns `{ film, changed }`; picking the option already picked (with its
 * files unchanged) is a no-op, so a duplicate request never bumps the order.
 */
export function pickOption(filmIn, stageId, optionId, { now, texts = {}, by = "producer", note } = {}) {
  assertStage(stageId);
  assertBy(by, PICKED_BY, "pick");
  if (stageId === HARD_GATE && by !== "producer") {
    throw new TLError("hard-gate", `the rough cut is the hard gate: only the producer picks it (got --by ${by})`);
  }
  if (stageId === "idea") throw new TLError("bad-stage", "the idea stage has no options", 1);
  const film = normalizeFilm(filmIn);
  const d = assertUnlocked(film, stageId, texts, now, "pick");
  const stage = film.stages[stageId];
  const option = resolveOption(stage, optionId);
  if (!option) {
    const ids = stage.options.map((o) => o.id).join(", ") || "none registered";
    const groups = langGroups(stage.options);
    const hint = groups ? ` — this stage takes one option per language, comma-joined (${[...groups.values()].map((g) => g[0].id).join(",")})` : "";
    throw new TLError("unknown-option", `stage "${stageId}" has no option "${optionId}" (options: ${ids})${hint}`);
  }
  optionId = option.id; // a composite pick is stored in the stages' own language order
  if (stage.pick === optionId && (d.status === "confirmed" || d.status === "done")) {
    return { film, changed: false };
  }
  stage.pick = optionId;
  stage.pickedBy = by;
  stage.pickedAt = iso(now);
  stage.deadline = null;
  stage.state = by === "producer" ? "confirmed" : "auto";
  if (note) stage.notes = stage.notes ? `${stage.notes}\n${note}` : String(note);
  stage.approval = {
    hash: hashStage(film, stageId, texts),
    at: iso(now),
    by: by === "producer" ? "producer" : "auto",
    seq: nextSeq(film),
  };
  pushEvent(film, now, "pick", stageId, { option: optionId, by });
  return { film, changed: true };
}

/**
 * Approve a stage as it is now (a stage without options — idea, picture
 * build, rough cut, finals — or a re-approval after a change). The rough cut
 * needs `--by producer`. Returns `{ film, changed }`.
 */
export function approveStage(filmIn, stageId, { now, texts = {}, by = "auto", note } = {}) {
  assertStage(stageId);
  assertBy(by, ["producer", "auto"], "approve");
  if (stageId === HARD_GATE && by !== "producer") {
    throw new TLError("hard-gate", "the rough cut is the hard gate: approve it only with --by producer, after the producer says so");
  }
  const film = normalizeFilm(filmIn);
  const d = assertUnlocked(film, stageId, texts, now, "approve");
  const stage = film.stages[stageId];
  if (stage.options.length > 0 && !stage.pick) {
    // the producer approving a stage that has options approves the one they are
    // looking at: the only option, or the recommended one. Anything
    // automatic has to pick explicitly (tl.mjs pick / tick).
    const only = stage.options.length === 1 ? stage.options[0] : null;
    const target = only ?? (langGroups(stage.options) ? recommendedOption(stage) : stage.options.find((o) => o.recommended === true)) ?? null;
    if (by === "producer" && target) {
      return pickOption(film, stageId, target.id, { now, texts, by: "producer", note });
    }
    throw new TLError("pick-first", `stage "${stageId}" has options; pick one (tl.mjs pick ${stageId} <id>)`);
  }
  const hash = hashStage(film, stageId, texts);
  if (hash === null) {
    throw new TLError("empty", `stage "${stageId}" has nothing to approve yet (no files under stages/${stageId}/)`);
  }
  if (d.status === "confirmed" || d.status === "done") {
    return { film, changed: false };
  }
  stage.approval = { hash, at: iso(now), by, seq: nextSeq(film) };
  stage.state = STAGE_META[stageId].final ? "done" : by === "producer" ? "confirmed" : "auto";
  stage.deadline = null;
  if (note) stage.notes = stage.notes ? `${stage.notes}\n${note}` : String(note);
  pushEvent(film, now, "approve", stageId, { by });
  return { film, changed: true };
}

export function setAutorun(filmIn, on, { now, by = "producer", reason } = {}) {
  const film = normalizeFilm(filmIn);
  film.autoRun = {
    enabled: !!on,
    until: HARD_GATE,
    since: on ? iso(now) : film.autoRun.since ?? null,
    by,
    ...(on ? {} : { stoppedAt: iso(now), stoppedReason: reason ?? "off" }),
  };
  pushEvent(film, now, on ? "autorun-on" : "autorun-off", null, reason ? { reason } : undefined);
  return film;
}

/** Set a stage's stored hint: `working`, `blocked` (with a note) or clear it. */
export function markStage(filmIn, stageId, state, { now, note } = {}) {
  assertStage(stageId);
  if (!["working", "blocked", "clear"].includes(state)) {
    throw new TLError("bad-state", `mark takes working, blocked or clear (got "${state}")`, 1);
  }
  const film = normalizeFilm(filmIn);
  const stage = film.stages[stageId];
  if (state === "clear") {
    stage.state = stage.approval ? (stage.pickedBy === "producer" ? "confirmed" : "auto") : stage.options.length ? "options" : "empty";
  } else {
    stage.state = state;
  }
  if (note) stage.notes = String(note);
  pushEvent(film, now, `mark-${state}`, stageId, note ? { note } : undefined);
  return film;
}

export function setBudget(filmIn, usd, { now } = {}) {
  const value = Number(usd);
  if (!Number.isFinite(value) || value < 0) throw new TLError("bad-budget", "budget must be a number of USD ≥ 0", 1);
  const film = normalizeFilm(filmIn);
  film.settings.budgetUsd = value;
  pushEvent(film, now, "budget", null, { usd: value });
  return film;
}

/** Mock providers on/off (film.json settings.mock). */
export function setMock(filmIn, on, { now } = {}) {
  const film = normalizeFilm(filmIn);
  film.settings.mock = !!on;
  pushEvent(film, now, on ? "mock-on" : "mock-off", null);
  return film;
}

/**
 * Stop auto-run because a paid call would pass the cap, and mark the stage
 * blocked, so the viewer shows why the run stopped.
 */
export function stopForBudget(filmIn, stageId, { now, note } = {}) {
  let film = normalizeFilm(filmIn);
  if (film.autoRun.enabled) film = setAutorun(film, false, { now, by: "budget", reason: "budget" });
  if (isStage(stageId)) {
    film.stages[stageId].state = "blocked";
    film.stages[stageId].notes = note ?? "budget cap reached";
  }
  pushEvent(film, now, "budget-stop", isStage(stageId) ? stageId : null, note ? { note } : undefined);
  return film;
}

// ── Requests (the viewer's inbox) and the tick ─────────────────────────────

/**
 * A request the viewer wrote to `requests/<id>.json` when the producer pressed a
 * button. Only three actions change state; everything else is a message to
 * the director. `by` is always the producer: the viewer is their surface.
 */
export function parseRequest(raw, fallbackId) {
  if (!isRecord(raw)) return null;
  const action = raw.action;
  if (!["pick", "approve", "autorun"].includes(action)) return null;
  const at = isoMs(raw.requestedAt);
  if (at === null) return null;
  return {
    id: typeof raw.id === "string" ? raw.id : fallbackId,
    action,
    stage: typeof raw.stage === "string" ? raw.stage : null,
    option: typeof raw.option === "string" ? raw.option : null,
    on: raw.on !== false,
    note: typeof raw.note === "string" ? raw.note : undefined,
    requestedAt: raw.requestedAt,
    at,
  };
}

function applyRequest(film, req, { now, texts }) {
  switch (req.action) {
    case "pick":
      return pickOption(film, req.stage, req.option, { now, texts, by: "producer", note: req.note });
    case "approve":
      return approveStage(film, req.stage, { now, texts, by: "producer", note: req.note });
    case "autorun":
      return { film: setAutorun(film, req.on, { now, by: "producer" }), changed: true };
    default:
      throw new TLError("bad-request", `unknown request action "${req.action}"`, 1);
  }
}

function applyAutorun(film, { now, texts, changes }) {
  if (!film.autoRun?.enabled) return film;
  const gate = stageIndex(HARD_GATE);
  for (;;) {
    // awaiting stages take their recommended option; a stage auto-run (or a countdown) picked whose files then CHANGED
    // (the director revised it, e.g. `options set --keep-pick`) is re-confirmed on the same pick. The producer's own picks are
    // never re-confirmed automatically: a changed stage they picked waits for them.
    const next = deriveStages(film, texts, now).find(
      (s) =>
        stageIndex(s.id) < gate &&
        s.options.length > 0 &&
        (s.status === "awaiting" || (s.status === "changed" && (s.pickedBy === "auto-run" || s.pickedBy === "auto-timeout"))),
    );
    if (!next) return film;
    const option = next.status === "changed" ? resolveOption(film.stages[next.id], next.pick) ?? recommendedOption(film.stages[next.id]) : recommendedOption(film.stages[next.id]);
    if (!option) return film;
    const res = pickOption(film, next.id, option.id, { now, texts, by: "auto-run" });
    film = res.film;
    changes.push({ stage: next.id, option: option.id, by: "auto-run" });
  }
}

/**
 * Apply everything that is due, in time order: the producer's requests (by when they
 * pressed the button) and expired countdowns (by their deadline), then
 * auto-run. A request made before a deadline wins over the timeout; one made
 * after it re-picks. Never passes the rough cut.
 *
 * Returns `{ film, changes, requests }` where `requests` reports each
 * request's outcome (`{ id, ok, error?, changed? }`).
 */
export function reconcile(filmIn, { now, texts = {}, requests = [] } = {}) {
  let film = normalizeFilm(filmIn);
  const changes = [];
  const outcomes = [];
  const queue = requests.filter(Boolean).slice().sort((a, b) => a.at - b.at);

  for (;;) {
    const due = expiredDeadlines(deriveStages(film, texts, now))[0] ?? null;
    const req = queue[0] ?? null;
    if (req && (!due || req.at <= due.deadlineMs)) {
      queue.shift();
      try {
        const res = applyRequest(film, req, { now, texts });
        film = res.film;
        outcomes.push({ id: req.id, ok: true, changed: res.changed });
        if (res.changed) {
          changes.push({ stage: req.stage, option: req.option, action: req.action, by: "producer" });
        }
      } catch (err) {
        outcomes.push({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    } else if (due) {
      const option = recommendedOption(film.stages[due.id]);
      if (!option) break;
      film = pickOption(film, due.id, option.id, { now, texts, by: "auto-timeout" }).film;
      changes.push({ stage: due.id, option: option.id, by: "auto-timeout" });
    } else {
      break;
    }
    film = applyAutorun(film, { now, texts, changes });
  }
  film = applyAutorun(film, { now, texts, changes });
  return { film, changes, requests: outcomes };
}
