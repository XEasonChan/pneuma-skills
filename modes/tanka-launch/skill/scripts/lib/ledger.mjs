/**
 * ledger.jsonl — pure parsing, folding and the budget check (contracts §4).
 *
 * The file is append-only: `reserve` appends a `reserved` line BEFORE a paid
 * request leaves, `commit` appends a second line with the same id and the
 * final status. Folding by id (last line wins) gives each call's state.
 *
 * What counts against the cap:
 *   reserved → its estimate (the money may already be spent)
 *   done     → the actual, else the estimate
 *   failed   → the actual if the vendor reported one, else 0
 */

export const PROVIDERS = Object.freeze(["elevenlabs", "fal", "openrouter", "codex", "mock"]);
export const LEDGER_STATUSES = Object.freeze(["reserved", "done", "failed"]);

const EPS = 1e-9;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Parse ledger text into entries; malformed lines are counted, not thrown. */
export function parseLedger(text) {
  const entries = [];
  let bad = 0;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed);
      if (entry && typeof entry === "object" && typeof entry.id === "string") entries.push(entry);
      else bad += 1;
    } catch {
      bad += 1;
    }
  }
  return { entries, bad };
}

/** One record per id, in first-seen order, later lines overriding earlier ones. */
export function foldLedger(entries) {
  const byId = new Map();
  for (const entry of entries) {
    const prev = byId.get(entry.id);
    byId.set(entry.id, prev ? { ...prev, ...entry } : { ...entry });
  }
  return [...byId.values()];
}

/** What one folded record counts against the cap. */
export function costOf(record) {
  if (record.status === "reserved") return num(record.estimateUsd) ?? 0;
  if (record.status === "done") return num(record.actualUsd) ?? num(record.estimateUsd) ?? 0;
  if (record.status === "failed") return num(record.actualUsd) ?? 0;
  return 0;
}

/** Totals for the budget meter and `ledger summary`. */
export function summarizeLedger(entries, capUsd) {
  const records = foldLedger(entries);
  const cap = num(capUsd);
  let spent = 0;
  let reserved = 0;
  let committed = 0;
  const byStage = {};
  const byProvider = {};
  for (const r of records) {
    const cost = costOf(r);
    spent += cost;
    if (r.status === "reserved") reserved += cost;
    else committed += cost;
    const stage = r.stage || "unassigned";
    const provider = r.provider || "unknown";
    byStage[stage] = round2((byStage[stage] ?? 0) + cost);
    byProvider[provider] = round2((byProvider[provider] ?? 0) + cost);
  }
  return {
    capUsd: cap,
    spentUsd: round2(spent),
    reservedUsd: round2(reserved),
    committedUsd: round2(committed),
    remainingUsd: cap === null ? null : round2(cap - spent),
    overCap: cap !== null && spent > cap + EPS,
    calls: records.length,
    /** real provider calls (mock stand-ins excluded) */
    paidCalls: records.filter((r) => r.provider !== "mock").length,
    mockCalls: records.filter((r) => r.provider === "mock").length,
    open: records.filter((r) => r.status === "reserved").length,
    byStage,
    byProvider,
    records,
  };
}

/** May a call estimated at `usd` start? */
export function checkReserve(summary, usd) {
  const estimate = num(usd) ?? 0;
  const wouldBe = round2(summary.spentUsd + estimate);
  const ok = summary.capUsd === null || summary.spentUsd + estimate <= summary.capUsd + EPS;
  return { ok, wouldBe, capUsd: summary.capUsd, spentUsd: summary.spentUsd, estimateUsd: round2(estimate) };
}

export function newLedgerId(nowMs, rand = Math.random) {
  const r = Math.floor(rand() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `L${nowMs.toString(36)}${r}`;
}

export function reserveEntry({ id, now, stage, provider, what, usd, mock = false }) {
  return {
    id,
    ts: new Date(now).toISOString(),
    stage: stage ?? null,
    provider: mock ? "mock" : provider,
    what: mock ? `[mock] ${what ?? ""}`.trim() : what ?? "",
    estimateUsd: mock ? 0 : round2(num(usd) ?? 0),
    actualUsd: null,
    status: "reserved",
    requestId: null,
  };
}

export function commitEntry(record, { now, usd, requestId, status = "done" }) {
  return {
    ...record,
    ts: new Date(now).toISOString(),
    actualUsd: record.provider === "mock" ? 0 : num(usd) === null ? null : round2(num(usd)),
    status,
    requestId: requestId ?? record.requestId ?? null,
  };
}
