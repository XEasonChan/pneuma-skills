/** Type surface of `stage-state.mjs` (the derived-status algorithm shared by tl.mjs and the viewer); see that file for the semantics. */

export type StageId = "idea" | "script" | "music" | "voice" | "vo" | "assets" | "picture" | "sound" | "roughcut" | "finals" | "deliver";
export type DerivedStatus = "empty" | "locked" | "working" | "awaiting" | "confirmed" | "auto" | "changed" | "stale" | "blocked" | "done";
export interface StageMeta {
  n: string;
  label: string;
  medium: string;
  countdown: boolean;
  final: boolean;
}
export interface Option {
  id: string;
  title?: string;
  summary?: string;
  recommended?: boolean;
  files?: string[];
  preview?: string;
  lang?: string;
  [key: string]: unknown;
}
/** Project-relative path → file text. Text files only; media never enters a hash. */
export type Texts = Readonly<Record<string, string>>;

export const STAGES: readonly StageId[];
export const STAGE_META: Readonly<Record<StageId, StageMeta>>;
export const HARD_GATE: "roughcut";
export const COUNTDOWN_STAGES: readonly StageId[];
export const STATUSES: readonly DerivedStatus[];
export const PASSING: readonly DerivedStatus[];
export const PICKED_BY: readonly string[];
export const HASH_TEXT_PATTERNS: readonly string[];
export const STAGE_EXTRA_PREFIXES: Readonly<Record<string, readonly string[]>>;

export function isHashText(path: string): boolean;
export function isRecord(value: unknown): value is Record<string, unknown>;
export function stableStringify(value: unknown): string;
export function isStage(value: unknown): value is StageId;
export function stageIndex(stage: string): number;
export function isoMs(value: unknown): number | null;
export function langGroups(options: readonly Option[]): Map<string, Option[]> | null;
export function resolveOption(stage: { options: readonly Option[] }, optionId: string): Option[] | Option | null;
export function recommendedOption(stage: { options: readonly Option[] }): string | null;
export function stageHashInputs(film: unknown, stageId: string, texts?: Texts): unknown[];
export function hashStage(film: unknown, stageId: string, texts?: Texts): string;
/** Every stage's derived status, in stage order (the viewer narrows the element type). */
export function deriveStages(film: unknown, texts?: Texts, now?: number): unknown[];
export function stageStatus(film: unknown, stageId: string, texts?: Texts, now?: number): unknown;
export function nextOpenStage(derived: readonly unknown[]): unknown;
export function expiredDeadlines(derived: readonly unknown[]): unknown[];
export function nextDeadline(derived: readonly unknown[]): unknown;
export function maxApprovalRank(film: unknown): number;
export function formatCountdown(ms: number): string;
