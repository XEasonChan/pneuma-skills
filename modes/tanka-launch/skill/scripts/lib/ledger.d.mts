/** Type surface of `ledger.mjs` (ledger.jsonl: every paid call, reserved before and committed after); see that file. */

export const PROVIDERS: readonly string[];
export const LEDGER_STATUSES: readonly string[];
export interface LedgerRecord {
  id: string;
  stage?: string;
  provider?: string;
  what?: string;
  status?: string;
  estimateUsd?: number;
  actualUsd?: number | null;
  requestId?: string | null;
  [key: string]: unknown;
}
export interface LedgerSummary {
  capUsd: number;
  spentUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  paidCalls: number;
  mockCalls: number;
  records: LedgerRecord[];
  [key: string]: unknown;
}

export function round2(value: number): number;
export function parseLedger(text: string): { entries: LedgerRecord[]; bad: number; [key: string]: unknown };
export function foldLedger(entries: readonly LedgerRecord[]): LedgerRecord[];
export function costOf(record: LedgerRecord): number;
export function summarizeLedger(entries: readonly LedgerRecord[], capUsd: number): LedgerSummary;
export function checkReserve(summary: LedgerSummary, usd: number): { ok: boolean; [key: string]: unknown };
export function newLedgerId(nowMs: number, rand?: () => number): string;
export function reserveEntry(input: { id: string; now: number; stage: string; provider: string; what: string; usd: number; mock?: boolean }): LedgerRecord;
export function commitEntry(record: LedgerRecord, input: { now: number; usd: number; requestId?: string | null; status?: string }): LedgerRecord;
