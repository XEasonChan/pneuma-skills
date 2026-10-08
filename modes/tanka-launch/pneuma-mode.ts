/**
 * Launch Studio — ModeDefinition: the manifest bound to the canvas.
 *
 * `extractContext` is what rides on every chat message: where the run stands
 * (every stage's derived status, the countdowns, the budget, pending button
 * presses) and what the producer has open (a stage and option, or a version and
 * its playhead). It derives status with the stage machine's own module, so
 * the director can never read "confirmed" here and "changed" from tl.mjs.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type { ViewerFileContent, ViewerSelectionContext } from "../../core/types/viewer-contract.js";

import manifest from "./manifest.js";
import LaunchStudioPreview from "./viewer/LaunchStudioPreview.js";
import { brand, buildModel, formatLabel, langLabel, money, stageMeta, type RunModel } from "./viewer/model.js";
import { formatCountdown } from "./skill/scripts/lib/stage-state.mjs";

function stageSummary(model: RunModel, now: number): string {
  return model.stages
    .map((s) => {
      const bits: string[] = [s.status === "changed" ? "CHANGED" : s.status];
      if (s.status === "awaiting") {
        bits.push(`${s.options.length} opt`);
        if (s.recommended) bits.push(`rec ${s.recommended}`);
        if (s.deadlineMs !== null) bits.push(s.deadlineMs <= now ? "countdown EXPIRED" : `${formatCountdown(s.deadlineMs - now)} left`);
      }
      if (s.pick) bits.push(`pick ${s.pick}${s.pickedBy && s.pickedBy !== "producer" ? ` (${s.pickedBy})` : ""}`);
      if (s.blocked) bits.push("BLOCKED");
      return `${s.id} ${bits.join(" ")}`;
    })
    .join(" · ");
}

function describeFocus(model: RunModel, address: Record<string, unknown>): string[] {
  const nodeId = typeof address.nodeId === "string" ? address.nodeId : "";
  if (!nodeId || nodeId === "overview") return ["On screen: the whole run (overview)."];
  if (nodeId.startsWith("version:")) {
    const v = model.versions.find((x) => x.nodeId === nodeId);
    if (!v) return [`On screen: ${nodeId} (not in this run's brief).`];
    const time = typeof address.time === "number" ? ` · playhead ${address.time.toFixed(2)} s` : "";
    return [
      `On screen: version ${formatLabel(v.format)} · ${langLabel(v.lang)} — ${v.roughcut} / ${v.final}${time}`,
      `QC: rough cut ${v.qcRoughcut ? "recorded" : "none"} · final ${v.qcFinal ? "recorded" : "none"}`,
    ];
  }
  const [stageId, optionId] = nodeId.split(":");
  const stage = model.byId[stageId as keyof RunModel["byId"]];
  if (!stage) return [`On screen: ${nodeId}`];
  const meta = stageMeta(stage.id);
  const lines = [`On screen: stage ${meta.n} · ${meta.label} (${stage.status}${stage.reason ? ` — ${stage.reason}` : ""})`];
  const option = optionId ? stage.options.find((o) => o.id === optionId) : undefined;
  if (option) {
    lines.push(
      `Option in view: ${option.id} "${brand(option.title)}"${option.recommended ? " (recommended)" : ""}${stage.pick === option.id ? " — the pick" : ""}; files: ${option.files.join(", ") || "none"}`,
    );
  }
  if (stage.options.length) lines.push(`Options: ${stage.options.map((o) => `${o.id}${o.recommended ? "*" : ""}`).join(", ")}`);
  return lines;
}

export function extractLaunchStudioContext(selection: ViewerSelectionContext | null, files: ViewerFileContent[]): string {
  const now = Date.now();
  const model = buildModel(files, now);
  if (!model.hasFilm) {
    return `<viewer-context mode="tanka-launch">\nNo film.json yet — the run has not started. Start it with tl.mjs init --idea "<the producer's idea>".\n</viewer-context>`;
  }
  if (model.filmError) {
    return `<viewer-context mode="tanka-launch">\n${model.filmError}. Fix it before running tl.mjs.\n</viewer-context>`;
  }
  const film = model.film!;
  const lines: string[] = [];
  lines.push(
    model.started
      ? `Run: "${brand(film.run.title)}" (${film.run.id}) · budget ${money(model.budget.spentUsd)} of ${money(model.budget.capUsd)} · auto-run ${film.autoRun.enabled ? "ON" : "off"} · countdown ${film.settings.countdownMin} min`
      : "Run: not started — film.json holds no idea yet (tl.mjs init --idea …).",
  );
  lines.push(`Stages: ${stageSummary(model, now)}`);
  if (model.next) lines.push(`Waiting on: ${model.next.id} (${model.next.status})`);
  if (model.requests.length) {
    lines.push(
      `Pending canvas requests: ${model.requests.map((r) => `${r.action} ${r.stage ?? ""} ${r.option ?? ""}`.trim()).join("; ")} — run tl.mjs tick to record them.`,
    );
  }
  const address = selection?.address as Record<string, unknown> | undefined;
  if (address) {
    lines.push(...describeFocus(model, address));
    lines.push(`Address: ${JSON.stringify(address)}`);
  }
  return `<viewer-context mode="tanka-launch" run="${film.run.id}">\n${lines.join("\n")}\n</viewer-context>`;
}

const mode: ModeDefinition = {
  manifest,
  viewer: {
    PreviewComponent: LaunchStudioPreview,
    workspace: {
      type: "all",
      multiFile: true,
      ordered: false,
      hasActiveFile: false,
      topBarNavigation: false,
      // A run starts with `tl.mjs init`; the canvas never creates files.
      createEmpty: () => null,
    },
    extractContext: extractLaunchStudioContext,
    actions: manifest.viewerApi?.actions,
    updateStrategy: "incremental",
  },
};

export default mode;
