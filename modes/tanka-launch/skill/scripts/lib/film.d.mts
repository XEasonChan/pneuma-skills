/** Type surface of `film.mjs` (film.json transitions; tl.mjs is its only caller that writes); see that file for the semantics. */

export const SCHEMA: 1;
export const DEFAULT_FORMATS: readonly string[];
export const DEFAULT_LANGUAGES: readonly string[];
export const DEFAULT_SETTINGS: Readonly<{ budgetUsd: number; countdownMin: number; mock: boolean }>;
export class TLError extends Error {
  code: string;
  exitCode: number;
  constructor(code: string, message: string, exitCode?: number);
}
type Film = Record<string, unknown>;
type Texts = Readonly<Record<string, string>>;
interface Change {
  film: Film;
  changed?: boolean;
  [key: string]: unknown;
}

export function emptyStage(): Record<string, unknown>;
export function slugify(text: string, maxWords?: number): string;
export function runIdFor(title: string | undefined, idea: string, nowMs: number): string;
/** Any parsed film.json brought to the full shape (every stage present). Typed loosely: the viewer narrows it to its own Film. */
export function normalizeFilm(raw: unknown): any;
export function createFilm(input?: Record<string, unknown>, opts?: { now?: number; texts?: Texts }): Film;
export function setBrief(film: Film, patch: Record<string, unknown>, opts?: { now?: number; texts?: Texts; by?: string | null }): Film;
export function validateOptions(options: unknown): unknown[];
export function setOptions(film: Film, stageId: string, options: unknown, opts?: { now?: number; texts?: Texts; countdownMin?: number; keepPick?: boolean }): Change;
export function pickOption(film: Film, stageId: string, optionId: string, opts?: { now?: number; texts?: Texts; by?: string; note?: string }): Change;
export function approveStage(film: Film, stageId: string, opts?: { now?: number; texts?: Texts; by?: string; note?: string }): Change;
export function setAutorun(film: Film, on: boolean, opts?: { now?: number; by?: string; reason?: string }): Film;
export function markStage(film: Film, stageId: string, state: string, opts?: { now?: number; note?: string }): Film;
export function setBudget(film: Film, usd: number, opts?: { now?: number }): Film;
export function setMock(film: Film, on: boolean, opts?: { now?: number }): Film;
export function stopForBudget(film: Film, stageId: string, opts?: { now?: number; note?: string }): Film;
/** A request file the canvas wrote (requests/*.json), validated; null when it is not one. */
export function parseRequest(raw: unknown, fallbackId: string): any;
export function reconcile(film: Film, opts?: { now?: number; texts?: Texts; requests?: unknown[] }): Change & { changes?: unknown[] };
