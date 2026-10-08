#!/usr/bin/env node
/**
 * tl.mjs — the Launch Studio stage machine. The ONLY writer of film.json and
 * ledger.jsonl (contracts §1–§4). Runs under Bun or Node ≥ 18.
 *
 *   init --idea "<text>" [--title] [--market us|jp|both] [--formats a,b] [--languages ja,en,en-jasub]
 *        [--selling-points "a|b"] [--figma key,..] [--prd path,..] [--budget 60] [--countdown-min 30]
 *        [--mock on|off] [--force]
 *   status [--json]
 *   options set <stage> --file options.json [--keep-pick] [--countdown-min N]
 *   pick <stage> <optionId> [--by producer|auto-timeout|auto-run] [--note "…"]
 *   approve <stage> [--by producer|auto] [--note "…"]
 *   tick [--json]
 *   autorun on|off
 *   mark <stage> working|blocked|clear [--note "…"]
 *   brief set --file brief.json [--by producer]
 *   budget set <usd>
 *   mock on|off
 *   hash <stage>
 *   ledger reserve --stage <s> --provider <p> --what "<desc>" --usd <estimate>
 *   ledger commit <id> --usd <actual> [--request-id <rid>] [--status done|failed]
 *   ledger summary [--json]
 *
 * Every command that changes film.json first applies what is due — the producer's
 * requests from the viewer (requests/*.json) and expired countdowns — so a
 * closed viewer or a busy agent never loses a click or a timeout.
 *
 * Exit codes: 0 ok · 1 usage or I/O error · 2 refused by a stage rule ·
 * 3 over the budget cap.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  HARD_GATE,
  STAGES,
  STAGE_META,
  deriveStages,
  expiredDeadlines,
  formatCountdown,
  hashStage,
  nextOpenStage,
  stageHashInputs,
} from "./lib/stage-state.mjs";
import {
  TLError,
  approveStage,
  createFilm,
  markStage,
  normalizeFilm,
  pickOption,
  reconcile,
  setAutorun,
  setBrief,
  setBudget,
  setMock,
  setOptions,
  stopForBudget,
} from "./lib/film.mjs";
import {
  checkReserve,
  commitEntry,
  foldLedger,
  newLedgerId,
  parseLedger,
  reserveEntry,
  summarizeLedger,
} from "./lib/ledger.mjs";
import {
  appendLedger,
  archiveRequest,
  loadEnv,
  readFilm,
  readLedgerText,
  readRequests,
  readTexts,
  resolveWorkspace,
  truthy,
  withLock,
  writeFilm,
  writeJsonAtomic,
} from "./lib/io.mjs";

// ── Argument parsing ────────────────────────────────────────────────────────

const BOOLEAN_FLAGS = new Set(["json", "force", "keep-pick", "help"]);

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq > 0 ? arg.slice(2, eq) : arg.slice(2);
      if (eq > 0) flags[name] = arg.slice(eq + 1);
      else if (BOOLEAN_FLAGS.has(name)) flags[name] = true;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[name] = argv[++i];
      else flags[name] = true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function fail(message, exitCode = 1) {
  const err = new Error(message);
  err.exitCode = exitCode;
  throw err;
}

function need(value, message) {
  if (value === undefined || value === null || value === true || value === "") fail(message, 1);
  return value;
}

function readJsonFile(path, what) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    fail(`cannot read ${what} from ${path}: ${err instanceof Error ? err.message : err}`, 1);
  }
}

// ── Output helpers ──────────────────────────────────────────────────────────

const out = (line = "") => process.stdout.write(`${line}\n`);

function money(n) {
  return n === null || n === undefined ? "—" : `$${Number(n).toFixed(2)}`;
}

function keysPresent(env) {
  const has = (name) => typeof env[name] === "string" && env[name].trim() !== "";
  return {
    elevenlabs: has("ELEVENLABS_API_KEY"),
    fal: has("FAL_KEY"),
    openrouter: has("OPENROUTER_API_KEY"),
    figma: has("FIGMA_TOKEN"),
  };
}

/**
 * Mock labelling: an explicit process env TL_MOCK (selftests, a shell) wins; otherwise film.json settings.mock — which `init`
 * copies from the init param (the skill .env's TL_MOCK) and `tl.mjs mock on|off` changes. The .env value alone never keeps a
 * run in mock after `mock off`.
 */
function isMock(film) {
  const e = process.env.TL_MOCK;
  if (e !== undefined && e !== "") return truthy(e);
  return film?.settings?.mock === true || truthy(film?.settings?.mock);
}

function describeChange(c) {
  if (c.action === "autorun") return "auto-run switched by the producer";
  const label = STAGE_META[c.stage]?.label ?? c.stage;
  if (c.action === "approve") return `${label} approved by the producer`;
  const how = c.by === "auto-timeout" ? "countdown ran out → recommended" : c.by === "auto-run" ? "auto-run → recommended" : "The producer";
  return `${label}: picked ${c.option} (${how})`;
}

// ── Loading and the due-work pass ───────────────────────────────────────────

function loadFilmOrFail(ws) {
  const raw = readFilm(ws);
  if (!raw) fail(`no film.json in ${ws} — start the run with: tl.mjs init --idea "<text>"`, 1);
  return normalizeFilm(raw);
}

/**
 * Apply requests and expired deadlines. Writes film.json and archives the
 * requests it handled. Returns `{ film, changes, outcomes, invalid }`.
 */
function applyDue(ws, film, texts, now) {
  const { pending, invalid } = readRequests(ws);
  const res = reconcile(film, { now, texts, requests: pending });
  const byId = new Map(res.requests.map((r) => [r.id, r]));
  const touched = res.changes.length > 0 || pending.length > 0;
  if (touched) writeFilm(ws, res.film);
  for (const req of pending) archiveRequest(ws, req.file, byId.get(req.id) ?? { ok: false, error: "not applied" });
  for (const bad of invalid) archiveRequest(ws, bad.file, { ok: false, error: bad.error });
  return { film: res.film, changes: res.changes, outcomes: res.requests, invalid };
}

function reportDue(due, { quiet = false } = {}) {
  if (quiet) return;
  for (const c of due.changes) out(`applied: ${describeChange(c)}`);
  for (const o of due.outcomes) if (!o.ok) out(`request ${o.id} refused: ${o.error}`);
  for (const b of due.invalid) out(`request ${b.file} ignored: ${b.error}`);
}

/** Load, apply what is due, run `mutate`, write. All under the lock. */
function mutateFilm(ws, mutate, { quietDue = false } = {}) {
  return withLock(ws, () => {
    const now = Date.now();
    const texts = readTexts(ws);
    const due = applyDue(ws, loadFilmOrFail(ws), texts, now);
    reportDue(due, { quiet: quietDue });
    const result = mutate(due.film, { now, texts });
    if (result && result.film) {
      // Anything the mutation made due (auto-run after new options) runs now.
      const settled = reconcile(result.film, { now, texts, requests: [] });
      writeFilm(ws, settled.film);
      for (const c of settled.changes) out(`applied: ${describeChange(c)}`);
      return { ...result, film: settled.film, due, settled };
    }
    return { ...result, due };
  });
}

// ── Status ──────────────────────────────────────────────────────────────────

function statusReport(ws, env) {
  const now = Date.now();
  const raw = readFilm(ws);
  if (!raw) return { ws, film: null };
  const film = normalizeFilm(raw);
  const texts = readTexts(ws);
  const derived = deriveStages(film, texts, now);
  const ledger = summarizeLedger(parseLedger(readLedgerText(ws)).entries, film.settings.budgetUsd);
  const { pending } = readRequests(ws);
  return { ws, film, derived, ledger, pending, now, keys: keysPresent(env), mock: isMock(film) };
}

function stageLine(s) {
  const meta = STAGE_META[s.id];
  const bits = [];
  if (s.status === "awaiting") {
    bits.push(`${s.options.length} option${s.options.length === 1 ? "" : "s"}`);
    if (s.recommended) bits.push(`recommended ${s.recommended}`);
    if (s.deadlineMs !== null) bits.push(s.expired ? "countdown EXPIRED — run tl.mjs tick" : `${formatCountdown(s.remainingMs)} left`);
    if (s.id === HARD_GATE) bits.push("hard gate — the producer approves");
  }
  if (s.pick) bits.push(`pick ${s.pick}${s.pickedBy ? ` by ${s.pickedBy}` : ""}`);
  else if (s.approval && (s.status === "confirmed" || s.status === "done")) bits.push(`approved by ${s.approval.by}`);
  if (s.reason && s.status !== "awaiting") bits.push(s.reason);
  if (s.blocked && s.notes) bits.push(`blocked: ${s.notes}`);
  return `${meta.n.padStart(2)}  ${meta.label.padEnd(15)} ${s.status.padEnd(10)} ${bits.join(" · ")}`;
}

function printStatus(report, asJson) {
  if (!report.film) {
    if (asJson) out(JSON.stringify({ workspace: report.ws, film: null }, null, 2));
    else out(`No film.json in ${report.ws}. Start with: tl.mjs init --idea "<text>"`);
    return;
  }
  const { film, derived, ledger, pending } = report;
  const next = nextOpenStage(derived);
  const expired = expiredDeadlines(derived).map((s) => s.id);
  if (asJson) {
    const { records: _records, ...budget } = ledger;
    out(
      JSON.stringify(
        {
          workspace: report.ws,
          run: film.run,
          settings: { ...film.settings, mock: report.mock },
          autoRun: film.autoRun,
          budget,
          stages: derived.map((s) => ({
            id: s.id,
            label: s.label,
            status: s.status,
            reason: s.reason,
            options: s.options.map((o) => ({ id: o.id, title: o.title, recommended: o.recommended === true })),
            pick: s.pick,
            pickedBy: s.pickedBy,
            recommended: s.recommended,
            deadline: s.deadline,
            remainingMs: s.remainingMs,
            expired: s.expired,
            approval: s.approval,
            blocked: s.blocked,
            notes: s.notes,
          })),
          next: next ? { stage: next.id, status: next.status } : null,
          expired,
          pendingRequests: pending.map((p) => ({ id: p.id, action: p.action, stage: p.stage, option: p.option })),
          keys: report.keys,
        },
        null,
        2,
      ),
    );
    return;
  }
  const rule = film.run.brief?.brand;
  const display = typeof rule?.display === "string" ? rule.display.trim() : "";
  const words = display ? [display, ...(Array.isArray(rule.match) ? rule.match.filter((w) => typeof w === "string" && w) : [])] : [];
  const brandRe = words.length ? new RegExp(`(?<![\\w.-])(?:${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\w-]|\\.\\w)`, "gi") : null;
  const brand = (t) => (brandRe ? String(t ?? "").replace(brandRe, display) : String(t ?? ""));
  out(`Launch run · ${brand(film.run.title)} (${film.run.id})`);
  out(
    `Budget ${money(ledger.spentUsd)} of ${money(ledger.capUsd)} · ${ledger.paidCalls} paid call(s)${ledger.mockCalls ? ` + ${ledger.mockCalls} mock` : ""}${
      ledger.open ? `, ${ledger.open} open` : ""
    } · auto-run ${film.autoRun.enabled ? "ON (until the rough cut)" : "off"}${report.mock ? " · MOCK providers" : ""}`,
  );
  for (const s of derived) out(stageLine(s));
  if (next) {
    const hint =
      next.status === "awaiting"
        ? next.id === HARD_GATE
          ? "waiting for the producer to approve the rough cut"
          : next.id === "finals"
            ? "finals are rendered — on the producer's OK: tl.mjs approve finals --by producer"
            : next.id === "deliver"
              ? "delivery report written — tl.mjs approve deliver"
              : `waiting for a pick (or the countdown)`
        : next.status === "empty" && next.id === "finals"
          ? "render every format × language, master and QC them (out/final/, out/qc/final-*.json)"
          : next.status === "empty" && next.id === "deliver"
            ? "copy the finals to the delivery folder, write stages/deliver/report.json, set the reminder"
        : next.status === "locked"
          ? next.reason
          : next.status === "empty" && next.id === "idea"
            ? 'start the run: tl.mjs init --idea "<the producer\'s words>" (the idea stage has no options; their typed idea confirms it)'
          : next.status === "empty"
            ? `build its options, then: tl.mjs options set ${next.id} --file <options.json>`
            : next.status === "changed"
              ? "its files changed after approval — show the producer, then re-pick or re-approve"
              : next.status === "stale"
                ? `rebuild on the new upstream (${next.reason}), then register options again`
                : next.status;
    out(`Next: ${next.id} (${next.status}) — ${hint}`);
  } else {
    out("Next: nothing — every stage is done.");
  }
  if (expired.length) out(`Expired countdowns: ${expired.join(", ")} — run tl.mjs tick`);
  if (pending.length) out(`Pending requests from the viewer: ${pending.length} — run tl.mjs tick`);
  const k = report.keys;
  out(
    `Keys: ElevenLabs ${k.elevenlabs ? "set" : "missing"} · fal ${k.fal ? "set" : "missing"} · OpenRouter ${
      k.openrouter ? "set" : "missing"
    } · Figma ${k.figma ? "set" : "missing"}`,
  );
}

// ── Commands ────────────────────────────────────────────────────────────────

function cmdInit(ws, flags, env) {
  const idea = String(need(flags.idea, 'init needs --idea "<what the producer typed>"')).trim();
  return withLock(ws, () => {
    const existing = readFilm(ws);
    if (existing && String(existing?.run?.brief?.idea ?? "").trim() && flags.force !== true) {
      fail(`film.json already holds a run ("${existing.run?.title ?? existing.run?.id}"); pass --force to start over`, 2);
    }
    if (existing && flags.force === true) {
      writeJsonAtomic(join(ws, `.tl/film-${Date.now()}.json`), existing);
    }
    const now = Date.now();
    const budget = flags.budget ?? env.TL_BUDGET_USD;
    const countdown = flags["countdown-min"] ?? env.TL_COUNTDOWN_MIN;
    const mock = flags.mock !== undefined ? truthy(flags.mock) : truthy(env.TL_MOCK);
    const film = createFilm(
      {
        idea,
        title: flags.title,
        market: flags.market,
        formats: flags.formats,
        languages: flags.languages,
        sellingPoints: flags["selling-points"],
        figma: flags.figma,
        prd: flags.prd,
        settings: {
          budgetUsd: budget !== undefined && budget !== "" ? Number(budget) : undefined,
          countdownMin: countdown !== undefined && countdown !== "" ? Number(countdown) : undefined,
          mock,
        },
      },
      { now, texts: readTexts(ws) },
    );
    writeFilm(ws, film);
    out(`Run ${film.run.id} started: "${film.run.title}"`);
    out(
      `Idea confirmed by the producer. Budget ${money(film.settings.budgetUsd)}, countdown ${film.settings.countdownMin} min per stage${
        film.settings.mock ? ", MOCK providers" : ""
      }.`,
    );
    out("Next: write 3 script options, then: tl.mjs options set script --file <options.json>");
    return 0;
  });
}

function cmdOptions(ws, positional, flags) {
  const sub = positional[1];
  if (sub !== "set") fail("usage: tl.mjs options set <stage> --file options.json [--keep-pick]", 1);
  const stage = need(positional[2], "options set needs a stage");
  const file = need(flags.file, "options set needs --file options.json");
  const options = readJsonFile(file, "options");
  const list = Array.isArray(options) ? options : Array.isArray(options?.options) ? options.options : options;
  const res = mutateFilm(ws, (film, { now, texts }) => ({
    film: setOptions(film, stage, list, {
      now,
      texts,
      keepPick: flags["keep-pick"] === true,
      countdownMin: flags["countdown-min"] !== undefined ? Number(flags["countdown-min"]) : undefined,
    }),
  }));
  const s = res.film.stages[stage];
  out(`${STAGE_META[stage].label}: ${s.options.length} option(s) registered (${s.options.map((o) => `${o.id}${o.recommended ? "*" : ""}`).join(", ")}).`);
  if (s.pick) out(`Picked ${s.pick} by ${s.pickedBy}.`);
  else if (s.deadline) out(`Countdown running until ${s.deadline}; on timeout the recommended option is taken.`);
  else if (stage === HARD_GATE) out("Hard gate: waiting for the producer to approve the rough cut.");
  return 0;
}

function cmdPick(ws, positional, flags) {
  const stage = need(positional[1], "pick needs a stage");
  const option = need(positional[2], "pick needs an option id");
  const by = flags.by ?? "producer";
  const res = mutateFilm(ws, (film, ctx) => pickOption(film, stage, option, { ...ctx, by, note: flags.note }));
  out(res.changed ? `${STAGE_META[stage].label}: picked ${option} (by ${by}); approval recorded.` : `${STAGE_META[stage].label}: ${option} was already picked — nothing changed.`);
  return 0;
}

function cmdApprove(ws, positional, flags) {
  const stage = need(positional[1], "approve needs a stage");
  const by = flags.by ?? "auto";
  const res = mutateFilm(ws, (film, ctx) => approveStage(film, stage, { ...ctx, by, note: flags.note }));
  out(res.changed ? `${STAGE_META[stage].label}: approved (by ${by}).` : `${STAGE_META[stage].label}: already approved as it is — nothing changed.`);
  return 0;
}

function cmdTick(ws, flags) {
  return withLock(ws, () => {
    const now = Date.now();
    const texts = readTexts(ws);
    const film = loadFilmOrFail(ws);
    const due = applyDue(ws, film, texts, now);
    if (flags.json) {
      out(JSON.stringify({ changes: due.changes, requests: due.outcomes, invalid: due.invalid }, null, 2));
      return 0;
    }
    if (!due.changes.length && !due.outcomes.length && !due.invalid.length) {
      out("Nothing due.");
    } else {
      reportDue(due);
    }
    const next = nextOpenStage(deriveStages(due.film, texts, now));
    if (next) out(`Next: ${next.id} (${next.status})`);
    return 0;
  });
}

function cmdAutorun(ws, positional) {
  const mode = positional[1];
  if (mode !== "on" && mode !== "off") fail("usage: tl.mjs autorun on|off", 1);
  const res = mutateFilm(ws, (film, { now }) => ({ film: setAutorun(film, mode === "on", { now, by: "producer" }) }));
  out(
    mode === "on"
      ? `Auto-run on: every stage takes its recommended option as soon as its options are registered, up to the rough cut (never past it). Budget cap ${money(res.film.settings.budgetUsd)} still stops the run.`
      : "Auto-run off: stages wait for a pick or their countdown.",
  );
  return 0;
}

function cmdMark(ws, positional, flags) {
  const stage = need(positional[1], "mark needs a stage");
  const state = need(positional[2], "mark needs working, blocked or clear");
  mutateFilm(ws, (film, { now }) => ({ film: markStage(film, stage, state, { now, note: flags.note }) }), { quietDue: false });
  out(`${STAGE_META[stage]?.label ?? stage}: marked ${state}.`);
  return 0;
}

function cmdBrief(ws, positional, flags) {
  if (positional[1] !== "set") fail("usage: tl.mjs brief set --file brief.json [--by producer]", 1);
  const patch = readJsonFile(need(flags.file, "brief set needs --file brief.json"), "brief");
  const by = flags.by === "producer" ? "producer" : null;
  mutateFilm(ws, (film, { now, texts }) => ({ film: setBrief(film, patch, { now, texts, by }) }));
  out(by ? "Brief updated and confirmed by the producer." : "Brief updated. The idea stage shows changed until the producer confirms it (brief set … --by producer).");
  return 0;
}

function cmdMock(ws, positional) {
  const mode = positional[1];
  if (mode !== "on" && mode !== "off") fail("usage: tl.mjs mock on|off", 1);
  mutateFilm(ws, (film, { now }) => ({ film: setMock(film, mode === "on", { now }) }));
  const envWins = process.env.TL_MOCK !== undefined && process.env.TL_MOCK !== "";
  out(
    mode === "on"
      ? "Mock providers ON: every paid script writes a local stand-in and records provider mock, $0."
      : `Mock providers OFF: paid scripts call ElevenLabs / fal / Codex for real, each priced and reserved against the budget cap first.${
          envWins ? " NOTE: this shell sets TL_MOCK, which still overrides film.json here." : ""
        }`,
  );
  return 0;
}

function cmdBudget(ws, positional) {
  if (positional[1] !== "set") fail("usage: tl.mjs budget set <usd>", 1);
  const usd = need(positional[2], "budget set needs a number");
  const res = mutateFilm(ws, (film, { now }) => ({ film: setBudget(film, usd, { now }) }));
  out(`Budget cap set to ${money(res.film.settings.budgetUsd)}.`);
  return 0;
}

function cmdHash(ws, positional) {
  const stage = need(positional[1], "hash needs a stage");
  const film = loadFilmOrFail(ws);
  const texts = readTexts(ws);
  out(JSON.stringify({ stage, hash: hashStage(film, stage, texts), inputs: stageHashInputs(film, stage, texts).map((i) => i.path) }, null, 2));
  return 0;
}

function cmdLedger(ws, positional, flags, env) {
  const sub = positional[1];
  if (sub === "summary") {
    const raw = readFilm(ws);
    const cap = raw ? normalizeFilm(raw).settings.budgetUsd : Number(env.TL_BUDGET_USD ?? 60);
    const parsed = parseLedger(readLedgerText(ws));
    const summary = summarizeLedger(parsed.entries, cap);
    if (flags.json) {
      out(JSON.stringify({ ...summary, badLines: parsed.bad }, null, 2));
      return 0;
    }
    out(`Spent ${money(summary.spentUsd)} of ${money(summary.capUsd)} (${money(summary.remainingUsd)} left) · ${summary.calls} call(s), ${summary.open} open`);
    for (const [stage, usd] of Object.entries(summary.byStage)) out(`  ${stage.padEnd(10)} ${money(usd)}`);
    for (const r of summary.records) {
      out(`  ${r.id}  ${String(r.status).padEnd(8)} ${String(r.provider).padEnd(10)} ${money(r.actualUsd ?? r.estimateUsd)}  ${r.stage ?? ""} · ${r.what ?? ""}`);
    }
    if (parsed.bad) out(`  (${parsed.bad} unreadable line(s) ignored)`);
    return 0;
  }

  if (sub === "reserve") {
    const stage = need(flags.stage, "ledger reserve needs --stage");
    const provider = need(flags.provider, "ledger reserve needs --provider");
    const what = need(flags.what, 'ledger reserve needs --what "<desc>"');
    const usd = Number(need(flags.usd, "ledger reserve needs --usd <estimate>"));
    if (!Number.isFinite(usd) || usd < 0) fail("--usd must be a number ≥ 0", 1);
    return withLock(ws, () => {
      const now = Date.now();
      const raw = readFilm(ws);
      const film = raw ? normalizeFilm(raw) : null;
      const cap = film ? film.settings.budgetUsd : Number(env.TL_BUDGET_USD ?? 60);
      const mock = isMock(film) || provider === "mock";
      const summary = summarizeLedger(parseLedger(readLedgerText(ws)).entries, cap);
      const check = checkReserve(summary, mock ? 0 : usd);
      if (!check.ok) {
        if (film) writeFilm(ws, stopForBudget(film, stage, { now, note: `budget cap: ${money(check.spentUsd)} spent + ${money(check.estimateUsd)} (${what}) would pass ${money(check.capUsd)}` }));
        process.stderr.write(
          `Over budget: ${money(check.spentUsd)} spent + ${money(check.estimateUsd)} for "${what}" = ${money(check.wouldBe)} > cap ${money(check.capUsd)}. The run stops here${
            film?.autoRun?.enabled ? " (auto-run switched off)" : ""
          }; ask the producer before spending more (tl.mjs budget set <usd>).\n`,
        );
        out(JSON.stringify({ error: "over-budget", ...check }));
        return 3;
      }
      const entry = reserveEntry({ id: newLedgerId(now), now, stage, provider, what, usd, mock });
      appendLedger(ws, entry);
      out(JSON.stringify({ id: entry.id, estimateUsd: entry.estimateUsd, provider: entry.provider, spentAfterUsd: check.wouldBe, capUsd: check.capUsd }));
      return 0;
    });
  }

  if (sub === "commit") {
    const id = need(positional[2], "ledger commit needs the reservation id");
    const status = flags.status ?? "done";
    if (!["done", "failed"].includes(status)) fail("--status must be done or failed", 1);
    const usd = flags.usd === undefined || flags.usd === true ? null : Number(flags.usd);
    if (status === "done" && (usd === null || !Number.isFinite(usd))) fail("ledger commit --status done needs --usd <actual>", 1);
    return withLock(ws, () => {
      const records = foldLedger(parseLedger(readLedgerText(ws)).entries);
      const record = records.find((r) => r.id === id);
      if (!record) fail(`no ledger reservation "${id}"`, 2);
      if (record.status !== "reserved") fail(`ledger entry "${id}" is already ${record.status}`, 2);
      const entry = commitEntry(record, { now: Date.now(), usd, requestId: flags["request-id"], status });
      appendLedger(ws, entry);
      out(JSON.stringify({ id, status, actualUsd: entry.actualUsd }));
      return 0;
    });
  }

  fail("usage: tl.mjs ledger reserve|commit|summary …", 1);
}

function usage() {
  out(`tl.mjs — Launch Studio stage machine
  init --idea "<text>" [--title …] [--market us|jp|both] [--formats …] [--languages …] [--force]
  status [--json]
  options set <stage> --file options.json [--keep-pick]
  pick <stage> <optionId> [--by producer|auto-timeout|auto-run]
  approve <stage> [--by producer|auto]          (${HARD_GATE} needs --by producer)
  tick                                         apply requests + expired countdowns
  autorun on|off
  mark <stage> working|blocked|clear [--note …]
  brief set --file brief.json [--by producer]
  budget set <usd>
  mock on|off                                  film.json settings.mock (the env TL_MOCK, when set, still wins)
  hash <stage>
  ledger reserve --stage <s> --provider <p> --what "…" --usd <n>   (exit 3 over the cap)
  ledger commit <id> --usd <n> [--request-id <rid>] [--status done|failed]
  ledger summary [--json]
Stages: ${STAGES.join(", ")}`);
}

function main(argv) {
  const { positional, flags } = parseArgs(argv);
  const cmd = positional[0];
  if (!cmd || flags.help || cmd === "help") {
    usage();
    return cmd ? 0 : 1;
  }
  const env = loadEnv();
  const ws = resolveWorkspace(typeof flags.workspace === "string" ? flags.workspace : undefined);
  switch (cmd) {
    case "init":
      return cmdInit(ws, flags, env);
    case "status":
      printStatus(statusReport(ws, env), flags.json === true);
      return 0;
    case "options":
      return cmdOptions(ws, positional, flags);
    case "pick":
      return cmdPick(ws, positional, flags);
    case "approve":
      return cmdApprove(ws, positional, flags);
    case "tick":
      return cmdTick(ws, flags);
    case "autorun":
      return cmdAutorun(ws, positional);
    case "mark":
      return cmdMark(ws, positional, flags);
    case "brief":
      return cmdBrief(ws, positional, flags);
    case "budget":
      return cmdBudget(ws, positional);
    case "mock":
      return cmdMock(ws, positional);
    case "hash":
      return cmdHash(ws, positional);
    case "ledger":
      return cmdLedger(ws, positional, flags, env);
    default:
      usage();
      return 1;
  }
}

try {
  process.exitCode = main(process.argv.slice(2)) ?? 0;
} catch (err) {
  const code = err instanceof TLError ? err.exitCode : typeof err?.exitCode === "number" ? err.exitCode : 1;
  process.stderr.write(`tl.mjs: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = code;
}
