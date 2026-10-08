/**
 * The run as the viewer sees it — pure functions over the watched files.
 *
 * Status is derived by the stage machine's own module (stage-state.mjs), the
 * ledger by ledger.mjs, and film.json is normalised by film.mjs — the same
 * code tl.mjs runs, so the canvas can never show a different state than
 * `tl.mjs status`.
 */

import {
  HARD_GATE,
  STAGES,
  langGroups,
  resolveOption,
  STAGE_META,
  deriveStages,
  expiredDeadlines,
  isHashText,
  nextDeadline,
  nextOpenStage,
} from "../skill/scripts/lib/stage-state.mjs";
import { normalizeFilm, parseRequest } from "../skill/scripts/lib/film.mjs";
import { parseLedger, summarizeLedger } from "../skill/scripts/lib/ledger.mjs";

// ── Types ───────────────────────────────────────────────────────────────────

export type StageId =
  | "idea"
  | "script"
  | "music"
  | "voice"
  | "vo"
  | "assets"
  | "picture"
  | "sound"
  | "roughcut"
  | "finals"
  | "deliver";

export type Status = "locked" | "empty" | "working" | "awaiting" | "confirmed" | "changed" | "stale" | "done";

export interface StageOption {
  id: string;
  title: string;
  summary?: string;
  recommended?: boolean;
  files: string[];
  preview?: string;
  [key: string]: unknown;
}

export interface Approval {
  hash: string;
  at: string;
  by: string;
  seq?: number;
}

export interface DerivedStage {
  id: StageId;
  n: string;
  label: string;
  medium: string;
  status: Status;
  reason: string | null;
  options: StageOption[];
  pick: string | null;
  pickedBy: string | null;
  recommended: string | null;
  deadline: string | null;
  deadlineMs: number | null;
  remainingMs: number | null;
  expired: boolean;
  approval: Approval | null;
  blocked: boolean;
  state: string;
  notes: string;
}

export interface Brief {
  idea: string;
  market: string;
  formats: string[];
  languages: string[];
  sellingPoints: string[];
  sources: { figma: string[]; prd: string[] };
}

export interface Film {
  schema: number;
  run: { id: string; title: string; createdAt?: string; brief: Brief };
  settings: { budgetUsd: number; countdownMin: number; mock: boolean | string };
  stages: Record<StageId, Record<string, unknown>>;
  autoRun: { enabled: boolean; until: string; since?: string; stoppedReason?: string };
  seq: number;
  events: Array<{ at: string; event: string; stage?: string; detail?: unknown }>;
}

export interface Budget {
  capUsd: number | null;
  spentUsd: number;
  reservedUsd: number;
  remainingUsd: number | null;
  overCap: boolean;
  calls: number;
  open: number;
  byStage: Record<string, number>;
}

export interface TimelineTracks {
  vo: Array<{ from: number; dur: number; id?: string; lang?: string; text?: string }>;
  bgm: Array<{ from: number; dur: number; file?: string; label?: string }>;
  sfx: Array<{ t: number; id?: string; group?: string }>;
  captions: Array<{ from: number; dur: number; text?: string; lang?: string }>;
}

export interface Timeline {
  fps: number;
  /** "frames" (the default) or "seconds" — the unit of every from/len/dur/t. */
  units: "frames" | "seconds";
  formats: Record<string, { width: number; height: number; frames?: number }>;
  scenes: Array<{ id: string; from: number; len: number; label?: string }>;
  tracks: TimelineTracks;
}

export interface PendingRequest {
  id: string;
  action: string;
  stage: string | null;
  option: string | null;
  requestedAt: string;
  at: number;
}

export interface Version {
  /** `version:<format>:<lang>` */
  nodeId: string;
  format: string;
  lang: string;
  key: string;
  roughcut: string;
  final: string;
  /** the VO-only master (render.mjs) — what the version shows before its rough cut is mixed */
  picture: string;
  qcRoughcut: Record<string, unknown> | null;
  qcFinal: Record<string, unknown> | null;
}

export interface RunModel {
  hasFilm: boolean;
  filmError: string | null;
  film: Film | null;
  started: boolean;
  texts: Record<string, string>;
  stages: DerivedStage[];
  byId: Record<StageId, DerivedStage>;
  budget: Budget;
  requests: PendingRequest[];
  versions: Version[];
  /** Media cache buster: changes whenever film.json does. */
  rev: string;
  next: DerivedStage | null;
  derivedAt: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export const STAGE_IDS = STAGES as unknown as StageId[];
export const GATE: StageId = HARD_GATE as StageId;

export function stageMeta(id: StageId): { n: string; label: string; medium: string; countdown: boolean; final: boolean } {
  return (STAGE_META as Record<string, { n: string; label: string; medium: string; countdown: boolean; final: boolean }>)[id];
}

/**
 * The run's brand display rule (film.json run.brief.brand: `{ display, match }`), applied to every title,
 * summary and caption the canvas shows. Set by buildModel from the film it parses; no rule = text as written.
 */
let BRAND_RE: RegExp | null = null;
let BRAND_DISPLAY = "";
export function setBrandRule(rule: { display?: unknown; match?: unknown } | null | undefined): void {
  const display = typeof rule?.display === "string" ? rule.display.trim() : "";
  if (!display) {
    BRAND_RE = null;
    BRAND_DISPLAY = "";
    return;
  }
  const words = [display, ...(Array.isArray(rule?.match) ? rule!.match.filter((w): w is string => typeof w === "string" && !!w) : [])];
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  BRAND_RE = new RegExp(`(?<![\\w.-])(?:${words.map(esc).join("|")})(?![\\w-]|\\.\\w)`, "gi");
  BRAND_DISPLAY = display;
}
export function brand(text: unknown): string {
  const s = String(text ?? "");
  return BRAND_RE ? s.replace(BRAND_RE, BRAND_DISPLAY) : s;
}

export function parseJson<T = unknown>(text: string | undefined | null): T | null {
  if (typeof text !== "string" || !text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const FORMAT_LABELS: Record<string, string> = {
  "short-16x9": "Short · 16:9",
  "short-9x16": "Vertical · 9:16",
  "full-16x9": "Full film · 16:9",
  "full-9x16": "Full film · 9:16",
};
export const LANG_LABELS: Record<string, string> = {
  ja: "JA",
  en: "EN",
  "en-jasub": "EN + JA subs",
};

export function formatLabel(format: string): string {
  return FORMAT_LABELS[format] ?? format;
}
export function langLabel(lang: string): string {
  return LANG_LABELS[lang] ?? lang.toUpperCase();
}
export function isVertical(format: string): boolean {
  return /9x16|vertical/i.test(format);
}

// ── Timeline ────────────────────────────────────────────────────────────────

export function parseTimeline(raw: unknown): Timeline | null {
  if (!isRecord(raw)) return null;
  const fps = num(raw.fps, 30) || 30;
  // "frames" is what the kit's render.mjs writes; "seconds" / "s" for hand-written clocks.
  const units = raw.units === "seconds" || raw.units === "s" || raw.units === "sec" ? "seconds" : "frames";
  const tracks = isRecord(raw.tracks) ? raw.tracks : {};
  const list = (v: unknown) => (Array.isArray(v) ? v.filter(isRecord) : []);
  return {
    fps,
    units,
    formats: isRecord(raw.formats) ? (raw.formats as Timeline["formats"]) : {},
    scenes: list(raw.scenes).map((s, i) => ({
      id: String(s.id ?? `s${i + 1}`),
      from: num(s.from),
      len: num(s.len ?? s.dur),
      label: typeof s.label === "string" ? s.label : undefined,
    })),
    tracks: {
      vo: list(tracks.vo).map((e) => ({ from: num(e.from), dur: num(e.dur), id: e.id as string, lang: e.lang as string, text: e.text as string })),
      bgm: list(tracks.bgm).map((e) => ({ from: num(e.from), dur: num(e.dur), file: e.file as string, label: e.label as string })),
      sfx: list(tracks.sfx).map((e) => ({ t: num(e.t ?? e.from), id: e.id as string, group: e.group as string })),
      captions: list(tracks.captions).map((e) => ({ from: num(e.from), dur: num(e.dur), text: e.text as string, lang: e.lang as string })),
    },
  };
}

/** Seconds of a timeline value. */
export function secondsOf(tl: Timeline, value: number): number {
  return tl.units === "seconds" ? value : value / tl.fps;
}

/** Total length in seconds. */
export function timelineDuration(tl: Timeline, format?: string, lang?: string): number {
  // formats are keyed by the version key <format>-<lang> (render.mjs), older files by format
  const f = format ? (lang ? tl.formats[`${format}-${lang}`] : undefined) ?? tl.formats[format] : undefined;
  if (f?.frames) return f.frames / tl.fps;
  let end = 0;
  for (const s of tl.scenes) end = Math.max(end, s.from + s.len);
  for (const e of tl.tracks.vo) end = Math.max(end, e.from + e.dur);
  for (const e of tl.tracks.bgm) end = Math.max(end, e.from + e.dur);
  for (const e of tl.tracks.captions) end = Math.max(end, e.from + e.dur);
  return secondsOf(tl, end);
}

/**
 * The timeline for one version: `timelines/<format>-<lang>.json` when the
 * director wrote a per-edition clock, else `timeline.json`. VO and captions
 * are filtered to the version's language when entries carry one.
 */
export function timelineFor(texts: Record<string, string>, format: string, lang: string): Timeline | null {
  const own = parseTimeline(parseJson(texts[`timelines/${format}-${lang}.json`]));
  const tl = own ?? parseTimeline(parseJson(texts["timeline.json"]));
  if (!tl) return null;
  const voLang = lang === "en-jasub" ? "en" : lang;
  const capLang = lang === "en-jasub" ? "ja" : lang;
  const keep = (l: string | undefined, want: string) => !l || l === want || l === lang;
  return {
    ...tl,
    tracks: {
      ...tl.tracks,
      vo: tl.tracks.vo.filter((e) => keep(e.lang, voLang)),
      captions: tl.tracks.captions.filter((e) => keep(e.lang, capLang)),
    },
  };
}

// ── The model ───────────────────────────────────────────────────────────────

export interface FileLike {
  path: string;
  content: string;
}

export function buildModel(files: FileLike[] | null | undefined, now: number): RunModel {
  const byPath: Record<string, string> = {};
  for (const f of files ?? []) byPath[f.path.replace(/^\.\//, "")] = f.content;

  const texts: Record<string, string> = {};
  for (const [path, content] of Object.entries(byPath)) if (isHashText(path)) texts[path] = content;

  const filmText = byPath["film.json"];
  let film: Film | null = null;
  let filmError: string | null = null;
  if (typeof filmText === "string") {
    const raw = parseJson(filmText);
    if (raw === null) filmError = "film.json is not valid JSON";
    else film = normalizeFilm(raw) as Film;
    const brief = (raw as { run?: { brief?: { brand?: { display?: unknown; match?: unknown } } } } | null)?.run?.brief;
    setBrandRule(brief?.brand);
  } else setBrandRule(null);

  const stages = deriveStages(film, texts, now) as DerivedStage[];
  const byId = Object.fromEntries(stages.map((s) => [s.id, s])) as Record<StageId, DerivedStage>;
  const ledger = summarizeLedger(parseLedger(byPath["ledger.jsonl"] ?? "").entries, film?.settings.budgetUsd ?? 60);
  const { records: _records, ...budget } = ledger as unknown as Budget & { records: unknown };

  const requests: PendingRequest[] = [];
  for (const [path, content] of Object.entries(byPath)) {
    const m = /^requests\/([^/]+)\.json$/.exec(path);
    if (!m) continue;
    const req = parseRequest(parseJson(content), m[1]);
    if (req) requests.push(req as PendingRequest);
  }
  requests.sort((a, b) => a.at - b.at);

  const versions: Version[] = [];
  if (film && film.run.brief.idea.trim()) {
    for (const format of film.run.brief.formats) {
      for (const lang of film.run.brief.languages) {
        const key = `${format}-${lang}`;
        const qc = (kind: "roughcut" | "final") =>
          parseJson<Record<string, unknown>>(
            texts[`out/qc/${kind}-${key}.json`] ?? texts[`out/qc/${kind}/${key}.json`] ?? (kind === "roughcut" ? texts[`out/qc/${key}.json`] : undefined),
          );
        versions.push({
          nodeId: `version:${format}:${lang}`,
          format,
          lang,
          key,
          roughcut: `out/roughcut/${key}.mp4`,
          final: `out/final/${key}.mp4`,
          picture: `out/picture/${key}.mp4`,
          qcRoughcut: qc("roughcut"),
          qcFinal: qc("final"),
        });
      }
    }
  }

  return {
    hasFilm: typeof filmText === "string",
    filmError,
    film,
    started: !!film && film.run.brief.idea.trim().length > 0,
    texts,
    stages,
    byId,
    budget: budget as Budget,
    requests,
    versions,
    rev: film ? `${film.seq}-${film.events.length}` : "0",
    next: (nextOpenStage(stages) as DerivedStage | null) ?? null,
    derivedAt: now,
  };
}

export function expiredStages(model: RunModel): DerivedStage[] {
  return expiredDeadlines(model.stages) as DerivedStage[];
}

export function upcomingDeadline(model: RunModel): DerivedStage | null {
  return (nextDeadline(model.stages) as DerivedStage | null) ?? null;
}

/** Per-language stage (voice): language → its options, in first-seen order; null for an ordinary stage. */
export function optionLangGroups(stage: DerivedStage): Map<string, StageOption[]> | null {
  return (langGroups(stage.options) as Map<string, StageOption[]> | null) ?? null;
}

/** Is `id` a valid pick for the stage: an option, or (per-language stage) one option per language, comma-joined. */
export function isValidPick(stage: DerivedStage, id: string | null | undefined): boolean {
  return !!id && resolveOption(stage, id) !== null;
}

/** The option ids a pick names (a composite pick names one per language). */
export function pickParts(pick: string | null | undefined): string[] {
  return pick ? pick.split(",").map((x) => x.trim()).filter(Boolean) : [];
}

/** The option a stage page opens on: the pick, else the recommended one. */
export function defaultOptionId(stage: DerivedStage): string | null {
  return stage.pick ?? stage.recommended ?? stage.options[0]?.id ?? null;
}

/** A JSON document among an option's files (the first that parses). */
export function optionDoc<T = Record<string, unknown>>(model: RunModel, option: StageOption | undefined, test?: (doc: unknown) => boolean): T | null {
  if (!option) return null;
  for (const path of option.files) {
    const doc = parseJson(model.texts[path]);
    if (doc !== null && (!test || test(doc))) return doc as T;
  }
  return null;
}

/** Every JSON document among an option's files, with its path. */
export function optionDocs(model: RunModel, option: StageOption | undefined): Array<{ path: string; doc: unknown }> {
  if (!option) return [];
  const out: Array<{ path: string; doc: unknown }> = [];
  for (const path of option.files) {
    const doc = parseJson(model.texts[path]);
    if (doc !== null) out.push({ path, doc });
  }
  return out;
}

const MEDIA = {
  audio: /\.(mp3|wav|m4a|aac|ogg|flac|aiff?)$/i,
  video: /\.(mp4|mov|webm|m4v)$/i,
  image: /\.(png|jpe?g|webp|gif|avif|svg)$/i,
};

export function mediaKind(path: string | undefined | null): "audio" | "video" | "image" | null {
  if (!path) return null;
  if (MEDIA.audio.test(path)) return "audio";
  if (MEDIA.video.test(path)) return "video";
  if (MEDIA.image.test(path)) return "image";
  return null;
}

/** Media paths of an option (files + preview), by kind. */
export function optionMedia(option: StageOption | undefined, kind: "audio" | "video" | "image"): string[] {
  if (!option) return [];
  const all = [...option.files, ...(option.preview ? [option.preview] : [])];
  return [...new Set(all.filter((p) => mediaKind(p) === kind))];
}

/** Resolve a path written inside a stage JSON: workspace-relative, or relative to that JSON's folder. */
export function resolveRef(fromDoc: string, ref: string | undefined | null): string | null {
  if (!ref || typeof ref !== "string") return null;
  if (/^(https?:|data:|\/)/.test(ref)) return ref;
  if (/^(stages|assets|out|remotion|timelines)\//.test(ref)) return ref;
  const dir = fromDoc.includes("/") ? fromDoc.slice(0, fromDoc.lastIndexOf("/")) : "";
  const parts = (dir ? `${dir}/${ref}` : ref).split("/");
  const stack: string[] = [];
  for (const p of parts) {
    if (p === "..") stack.pop();
    else if (p && p !== ".") stack.push(p);
  }
  return stack.join("/");
}

export function contentUrl(base: string, path: string, rev: string): string {
  if (/^(https?:|data:)/.test(path)) return path;
  const clean = path.replace(/^\/+/, "");
  return `${base}/content/${clean.split("/").map(encodeURIComponent).join("/")}?rev=${encodeURIComponent(rev)}`;
}

export function money(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

export function formatSeconds(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
}

export function pickedByLabel(stage: DerivedStage): string {
  if (!stage.pickedBy && stage.approval) return stage.approval.by === "producer" ? "by the producer" : "auto";
  switch (stage.pickedBy) {
    case "producer":
      return "by the producer";
    case "auto-timeout":
      return "by the countdown";
    case "auto-run":
      return "by auto-run";
    default:
      return "";
  }
}

export function stageById(model: RunModel, id: StageId): DerivedStage {
  return model.byId[id];
}

export { STAGE_META };
