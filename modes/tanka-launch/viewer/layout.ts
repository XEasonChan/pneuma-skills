/**
 * Canvas layout — pure. Columns left to right in stage order; each column
 * holds the stage's option nodes (or one node for a stage without options,
 * or a placeholder while it is locked or empty). An opened stage replaces
 * its column with its page, in place, and everything to its right moves.
 */

import {
  GATE,
  isVertical,
  pickParts,
  stageMeta,
  type DerivedStage,
  type RunModel,
  type StageId,
  type StageOption,
  type Version,
} from "./model.js";

export type Expanded = { kind: "stage"; stage: StageId } | { kind: "version"; nodeId: string } | null;

export type NodeKind = "idea" | "option" | "stage" | "placeholder" | "version" | "deliver" | "page";

export interface LayoutNode {
  id: string;
  kind: NodeKind;
  stage: StageId;
  option?: StageOption;
  version?: Version;
  x: number;
  y: number;
  w: number;
  h: number;
  picked: boolean;
}

export interface LayoutColumn {
  key: string;
  stage: StageId;
  x: number;
  w: number;
  top: number;
  nodes: LayoutNode[];
  page: LayoutNode | null;
}

export interface LayoutEdge {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: "lit" | "dim" | "ghost" | "plain" | "stale";
}

export interface Layout {
  columns: LayoutColumn[];
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  bounds: { x: number; y: number; w: number; h: number };
}

export const COL_GAP = 96;
export const NODE_GAP = 16;
export const HEAD_H = 34;

const OPTION_H: Record<string, number> = {
  script: 132,
  music: 154,
  voice: 124,
  vo: 124,
  assets: 150,
  video: 204,
};

export const PAGE_W: Record<string, number> = {
  idea: 640,
  script: 940,
  music: 820,
  voice: 760,
  vo: 820,
  assets: 860,
  picture: 820,
  sound: 820,
  roughcut: 860,
  finals: 860,
  deliver: 640,
  version: 980,
};

const COLUMN_W = 252;
export const VERSION_W = 236;
export const VERSION_H = 196;
const PASSING = new Set(["confirmed", "done"]);

function optionHeight(stage: DerivedStage): number {
  return OPTION_H[stage.medium] ?? OPTION_H.video;
}

function stack(nodes: LayoutNode[]): number {
  const total = nodes.reduce((sum, n) => sum + n.h, 0) + NODE_GAP * Math.max(0, nodes.length - 1);
  let y = -total / 2;
  for (const n of nodes) {
    n.y = y;
    y += n.h + NODE_GAP;
  }
  return -total / 2;
}

/**
 * Build the layout. `pageHeights` are the measured heights of open pages
 * (a page grows with its content); unmeasured pages use a default.
 */
export function buildLayout(model: RunModel, expanded: Expanded, pageHeights: Record<string, number> = {}): Layout {
  const columns: LayoutColumn[] = [];
  const edges: LayoutEdge[] = [];
  let x = 0;

  const order: Array<{ key: string; stage: StageId }> = [
    ...(["idea", "script", "music", "voice", "vo", "assets", "picture", "sound", "roughcut"] as StageId[]).map((s) => ({ key: s, stage: s })),
    { key: "versions", stage: "finals" as StageId },
    { key: "deliver", stage: "deliver" as StageId },
  ];

  for (const { key, stage: stageId } of order) {
    const stage = model.byId[stageId];
    const col: LayoutColumn = { key, stage: stageId, x, w: COLUMN_W, top: 0, nodes: [], page: null };

    const isOpenStage = expanded?.kind === "stage" && expanded.stage === stageId && key !== "versions";
    const isOpenVersion = expanded?.kind === "version" && key === "versions";
    const isOpenFinals = expanded?.kind === "stage" && expanded.stage === "finals" && key === "versions";

    if (isOpenStage || isOpenVersion || isOpenFinals) {
      const pageKey = isOpenVersion ? "version" : stageId;
      const w = PAGE_W[pageKey] ?? 820;
      const id = isOpenVersion ? `page:${expanded.nodeId}` : `page:${stageId}`;
      const h = pageHeights[id] ?? 560;
      const page: LayoutNode = { id, kind: "page", stage: stageId, x, y: -h / 2, w, h, picked: true };
      if (isOpenVersion) page.version = model.versions.find((v) => v.nodeId === expanded.nodeId);
      col.w = w;
      col.page = page;
      col.top = page.y;
      col.nodes = [page];
    } else if (key === "versions") {
      // A grid: one column per format, one row per language.
      const formats = [...new Set(model.versions.map((v) => v.format))];
      const langs = [...new Set(model.versions.map((v) => v.lang))];
      const W = VERSION_W;
      const H = VERSION_H;
      const total = langs.length * H + Math.max(0, langs.length - 1) * NODE_GAP;
      for (const v of model.versions) {
        const c = formats.indexOf(v.format);
        const r = langs.indexOf(v.lang);
        col.nodes.push({ id: v.nodeId, kind: "version", stage: "finals", version: v, x: x + c * (W + NODE_GAP), y: -total / 2 + r * (H + NODE_GAP), w: W, h: H, picked: false });
      }
      col.w = formats.length ? formats.length * W + (formats.length - 1) * NODE_GAP : 220;
      col.top = -total / 2;
      if (col.nodes.length === 0) {
        col.nodes.push({ id: "placeholder:versions", kind: "placeholder", stage: "finals", x, y: 0, w: 220, h: 84, picked: false });
        col.w = 220;
        col.top = stack(col.nodes);
      }
    } else if (stageId === "idea") {
      col.w = 280;
      col.nodes.push({ id: "idea", kind: "idea", stage: "idea", x, y: 0, w: 280, h: 156, picked: PASSING.has(stage.status) });
      col.top = stack(col.nodes);
    } else if (stageId === "deliver") {
      col.w = 232;
      col.nodes.push({ id: "deliver", kind: "deliver", stage: "deliver", x, y: 0, w: 232, h: 120, picked: PASSING.has(stage.status) });
      col.top = stack(col.nodes);
    } else if (stage.options.length > 0) {
      const h = optionHeight(stage);
      // The recommended option carries the "auto-picks in" chip while its countdown runs (Nodes.tsx showCountdown): give it the
      // chip's row, or the fixed-height card clips its own title and summary.
      const chipRow = (o: { recommended?: boolean }) =>
        stage.status === "awaiting" && o.recommended && stage.deadlineMs !== null && !stage.pick ? 30 : 0;
      for (const option of stage.options) {
        col.nodes.push({
          id: `${stageId}:${option.id}`,
          kind: "option",
          stage: stageId,
          option,
          x,
          y: 0,
          w: COLUMN_W,
          h: h + chipRow(option),
          picked: pickParts(stage.pick).includes(option.id),
        });
      }
      col.top = stack(col.nodes);
    } else if (stage.approval || stage.status === "working" || (stageId === GATE && stage.status !== "locked")) {
      const h = stage.medium === "video" ? OPTION_H.video : 120;
      col.nodes.push({ id: stageId, kind: "stage", stage: stageId, x, y: 0, w: COLUMN_W, h, picked: PASSING.has(stage.status) });
      col.top = stack(col.nodes);
    } else {
      col.w = 220;
      col.nodes.push({ id: `placeholder:${stageId}`, kind: "placeholder", stage: stageId, x, y: 0, w: 220, h: 84, picked: false });
      col.top = stack(col.nodes);
    }
    columns.push(col);
    x += col.w + COL_GAP;
  }

  // ── Edges ────────────────────────────────────────────────────────────────
  const anchorY = (n: LayoutNode) => (n.kind === "page" ? n.y + 42 : n.y + n.h / 2);
  const activeOf = (col: LayoutColumn): LayoutNode | null => {
    if (col.page) return col.page;
    if (col.key === "versions") return null;
    const picked = col.nodes.find((n) => n.picked);
    return picked ?? null;
  };

  for (let i = 0; i < columns.length - 1; i += 1) {
    const a = columns[i];
    const b = columns[i + 1];
    const targets = b.nodes;

    if (a.key === "versions") {
      // Every version feeds delivery.
      const deliverNode = targets[0];
      const lit = PASSING.has(model.byId.deliver.status);
      for (const n of a.nodes) {
        if (n.kind === "placeholder") continue;
        edges.push(edge(`${n.id}->${deliverNode.id}`, n.x + n.w, anchorY(n), deliverNode.x, anchorY(deliverNode), lit ? "lit" : n.kind === "page" ? "plain" : "dim"));
      }
      continue;
    }

    const from = activeOf(a);
    if (!from) continue;
    for (const t of targets) {
      let kind: LayoutEdge["kind"];
      if (t.kind === "placeholder") kind = "ghost";
      else if (b.key === "versions") kind = PASSING.has(model.byId[GATE].status) ? "lit" : "plain";
      else if (t.kind === "page") kind = "lit";
      else if (t.picked) kind = model.byId[t.stage].status === "stale" ? "stale" : "lit";
      else if (b.nodes.some((n) => n.picked)) kind = "dim";
      else kind = "plain";
      edges.push(edge(`${from.id}->${t.id}`, from.x + from.w, anchorY(from), t.x, anchorY(t), kind));
    }
  }

  // ── Bounds ───────────────────────────────────────────────────────────────
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const nodes: LayoutNode[] = [];
  for (const col of columns) {
    minY = Math.min(minY, col.top - HEAD_H);
    for (const n of col.nodes) {
      nodes.push(n);
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x + n.w);
      minY = Math.min(minY, n.y - HEAD_H);
      maxY = Math.max(maxY, n.y + n.h);
    }
  }
  return { columns, nodes, edges, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}

function edge(id: string, x1: number, y1: number, x2: number, y2: number, kind: LayoutEdge["kind"]): LayoutEdge {
  return { id, x1, y1, x2, y2, kind };
}

/** Cubic bezier path between two ports, horizontal tangents. */
export function edgePath(e: LayoutEdge): string {
  const dx = Math.max(40, (e.x2 - e.x1) * 0.5);
  return `M${e.x1},${e.y1} C${e.x1 + dx},${e.y1} ${e.x2 - dx},${e.y2} ${e.x2},${e.y2}`;
}

/** The rectangle to focus when a node id is addressed. */
export function nodeRect(layout: Layout, id: string): { x: number; y: number; w: number; h: number } | null {
  const n = layout.nodes.find((node) => node.id === id || node.id === `page:${id}`);
  if (!n) return null;
  return { x: n.x, y: n.y - HEAD_H, w: n.w, h: n.h + HEAD_H };
}

export function versionAspect(format: string): string {
  return isVertical(format) ? "9 / 16" : "16 / 9";
}

export { stageMeta };
