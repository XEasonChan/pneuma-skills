/**
 * Launch Studio viewer — a node canvas for one launch-video run.
 *
 * Four conventions:
 *
 * 1. STATUS IS DERIVED, NEVER STORED. `buildModel` runs the stage machine's
 *    own stage-state.mjs over the watched files, so the canvas shows exactly
 *    what `tl.mjs status` would print.
 *
 * 2. THE VIEWER NEVER WRITES film.json. A button press writes a request to
 *    `requests/<id>.json` (the viewer's inbox) and tells the director with a
 *    viewer notification; `tl.mjs tick` applies the request in time order
 *    and archives it. A closed tab or a busy agent loses nothing.
 *
 * 3. THE COUNTDOWN TICKS HERE AND IN THE CLI. The viewer times the next
 *    deadline and, when it passes (or on load, for deadlines that passed
 *    while it was closed), asks the director to run `tl.mjs tick`. Every
 *    mutating tl.mjs command applies what is due anyway.
 *
 * 4. WHAT THE AGENT READS IS WHAT THE PRODUCER SEES. The open page, option and
 *    playhead ride on every message as the selection's address.
 */

import { useCallback, useEffect, useInsertionEffect, useMemo, useRef, useState } from "react";

import type { Source } from "../../../core/types/source.js";
import type { ViewerActionResult, ViewerFileContent, ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { useSource } from "../../../src/hooks/useSource.js";
import { useStore } from "../../../src/store.js";
import { getApiBase } from "../../../src/utils/api.js";

import {
  GATE,
  brand,
  buildModel,
  defaultOptionId,
  expiredStages,
  formatLabel,
  langLabel,
  stageMeta,
  upcomingDeadline,
  type RunModel,
  type StageId,
} from "./model.js";
import { buildLayout, edgePath, nodeRect, type Expanded, type LayoutColumn, type LayoutNode } from "./layout.js";
import { Canvas, type CanvasHandle } from "./Canvas.js";
import { ColumnHead, NodeCard } from "./Nodes.js";
import { StagePage, type RunActions } from "./StagePage.js";
import { VersionPage } from "./VersionPage.js";
import { SettingsPanel, TopBar } from "./TopBar.js";
import { CSS, STYLE_ID } from "./styles.js";

const COMMAND = "tanka-launch-command";

function useStyles() {
  useInsertionEffect(() => {
    if (document.getElementById(STYLE_ID)) {
      const el = document.getElementById(STYLE_ID)!;
      if (el.textContent !== CSS) el.textContent = CSS;
      return;
    }
    const el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
  }, []);
}

function rid(stage: string): string {
  const r = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 15)}-${stage}-${r}`;
}

/** Parse a canvas address into what to open. */
export function parseNodeId(nodeId: string): { kind: "overview" } | { kind: "stage"; stage: StageId; option?: string } | { kind: "version"; nodeId: string } | null {
  if (!nodeId || nodeId === "overview") return { kind: "overview" };
  if (nodeId.startsWith("version:")) return { kind: "version", nodeId };
  const [stage, option] = nodeId.split(":");
  const ids: StageId[] = ["idea", "script", "music", "voice", "vo", "assets", "picture", "sound", "roughcut", "finals", "deliver"];
  if (!ids.includes(stage as StageId)) return null;
  return { kind: "stage", stage: stage as StageId, option };
}

export default function LaunchStudioPreview(props: ViewerPreviewProps) {
  useStyles();
  const { value: files } = useSource(props.sources.files as Source<ViewerFileContent[]> | undefined);
  const base = useMemo(() => getApiBase(), []);
  const [clock, setClock] = useState(() => Date.now());
  const model: RunModel = useMemo(() => buildModel(files ?? [], clock), [files, clock]);

  const [expanded, setExpanded] = useState<Expanded>(null);
  const [optionFor, setOptionFor] = useState<Partial<Record<StageId, string>>>({});
  const [pageHeights, setPageHeights] = useState<Record<string, number>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [versionSeek, setVersionSeek] = useState<{ t: number; seq: number } | null>(null);
  const [sentAt, setSentAt] = useState<Record<string, number>>({});
  const playhead = useRef(0);
  const canvas = useRef<CanvasHandle>(null);

  const layout = useMemo(() => buildLayout(model, expanded, pageHeights), [model, expanded, pageHeights]);

  // Home: the stages around the one the run is waiting on, at a readable
  // scale. Fit (Shift+1) still frames the whole run.
  const home = useMemo(() => {
    if (!model.started || !model.next) return layout.bounds;
    const cols = layout.columns;
    const key = model.next.id === "finals" ? "versions" : model.next.id;
    const i = cols.findIndex((c) => c.key === key);
    if (i < 0) return layout.bounds;
    const from = cols[Math.max(0, i - 2)];
    const to = cols[Math.min(cols.length - 1, i + 1)];
    const span = cols.slice(Math.max(0, i - 2), Math.min(cols.length, i + 2));
    const top = Math.min(...span.map((c) => c.top)) - 40;
    const bottom = Math.max(...span.flatMap((c) => c.nodes.map((n) => n.y + n.h)));
    return { x: from.x - 24, y: top, w: to.x + to.w - from.x + 48, h: bottom - top + 24 };
  }, [layout, model.started, model.next]);

  const onMeasure = useCallback((id: string, h: number) => {
    setPageHeights((prev) => (Math.abs((prev[id] ?? 0) - h) < 2 ? prev : { ...prev, [id]: h }));
  }, []);

  // ── Clock: re-derive at the next deadline and every 30 s ─────────────────
  useEffect(() => {
    const next = upcomingDeadline(model);
    const delay = next && next.deadlineMs !== null ? Math.max(250, next.deadlineMs - Date.now() + 400) : 30_000;
    const id = window.setTimeout(() => setClock(Date.now()), Math.min(delay, 30_000));
    return () => window.clearTimeout(id);
  }, [model]);

  // ── Can buttons reach the director? ───────────────────────────────────────
  const cliConnected = useStore((s: { cliConnected?: boolean }) => s.cliConnected === true);
  const canAct = props.editing !== false && !props.readonly && !!props.onNotifyAgent;
  const disabledReason = props.readonly
    ? "Replay — read only"
    : props.editing === false
      ? "Viewing session — open an editing session to confirm"
      : !props.onNotifyAgent
        ? "No director attached"
        : null;

  const notify = useCallback(
    (kind: string, summary: string, message: string) => {
      props.onNotifyAgent?.({ type: `${COMMAND}:${kind}`, severity: "warning", summary, message });
    },
    [props],
  );

  const writeRequest = useCallback(
    async (body: Record<string, unknown>): Promise<string | null> => {
      const id = rid(String(body.stage ?? body.action));
      const content = JSON.stringify({ id, by: "producer", via: "canvas", requestedAt: new Date().toISOString(), ...body }, null, 2);
      try {
        await props.fileChannel.write(`requests/${id}.json`, content);
        return `requests/${id}.json`;
      } catch {
        return null;
      }
    },
    [props.fileChannel],
  );

  const actions: RunActions = useMemo(
    () => ({
      canAct,
      disabledReason,
      pendingFor(stage: StageId) {
        const hit = model.requests.find((r) => (stage === ("autorun" as StageId) ? r.action === "autorun" : r.stage === stage));
        if (hit) return hit;
        const local = sentAt[stage];
        if (local && Date.now() - local < 8000) return { id: "local", action: "pick", stage, option: null, requestedAt: "", at: local };
        return null;
      },
      async confirm(stage: StageId, optionId: string | null) {
        const s = model.byId[stage];
        const meta = stageMeta(stage);
        const option = optionId ? s.options.find((o) => o.id === optionId) : null;
        const action = optionId ? "pick" : "approve";
        setSentAt((p) => ({ ...p, [stage]: Date.now() }));
        const file = await writeRequest({ action, stage, option: optionId });
        const direct = optionId ? `tl.mjs pick ${stage} ${optionId} --by producer` : `tl.mjs approve ${stage} --by producer`;
        const head = stage === GATE ? `approve ${stage}` : optionId ? `confirm ${stage} ${optionId}` : `approve ${stage}`;
        const what =
          stage === GATE
            ? `The producer approved the rough cut${optionId ? ` (option ${optionId})` : ""} — the hard gate.`
            : optionId
              ? `The producer pressed Confirm on stage ${meta.n} · ${meta.label}, option ${optionId}${option ? ` ("${brand(option.title)}")` : ""}.`
              : `The producer pressed Confirm on stage ${meta.n} · ${meta.label}.`;
        const then =
          stage === GATE
            ? "Then start the finals: every format × language, final mix, master and QC."
            : stage === "finals"
              ? "Then deliver: copy the finals to the delivery folder and set the reminder."
              : "Then continue with the next stage.";
        notify(
          "confirm-stage",
          `${stage === GATE ? "Approve" : "Confirm"} · ${meta.label}${optionId ? ` ${optionId}` : ""}`,
          [
            head,
            "",
            what,
            file
              ? `Their request is waiting at ${file}. Run \`tl.mjs tick\` (in your pneuma-tanka-launch skill's scripts/) — it records \`${direct}\`. Do not run that pick yourself as well.`
              : `The canvas could not write its request file. Record it with \`${direct}\`.`,
            then,
          ].join("\n"),
        );
      },
      async setAutorun(on: boolean) {
        setSentAt((p) => ({ ...p, autorun: Date.now() }));
        const file = await writeRequest({ action: "autorun", on });
        notify(
          "auto-run",
          on ? "Auto-run to rough cut" : "Stop auto-run",
          on
            ? [
                "autorun on",
                "",
                'the producer pressed "Auto-run to rough cut".',
                file ? `Run \`tl.mjs tick\` — it applies ${file}: auto-run on, and every stage that is waiting takes its recommended option.` : "Run `tl.mjs autorun on`.",
                "Then keep going stage by stage without waiting for picks: register each stage's options (tl.mjs takes the recommended one at once) and build the next. Stop at the rough cut — it is the producer's — and at the budget cap.",
              ].join("\n")
            : ["autorun off", "", 'the producer pressed "Stop auto-run".', file ? `Run \`tl.mjs tick\` to apply ${file}.` : "Run `tl.mjs autorun off`.", "From here each stage waits for their pick or its countdown."].join("\n"),
        );
      },
      moreOptions(stage: StageId, note: string) {
        const s = model.byId[stage];
        const meta = stageMeta(stage);
        const ids = s.options.map((o) => `${o.id}${o.recommended ? " (recommended)" : ""}`).join(", ") || "none yet";
        notify(
          "more-options",
          `${stage === GATE ? "Changes" : "More options"} · ${meta.label}`,
          [
            stage === GATE ? `changes: ${stage}` : `more options: ${stage}`,
            "",
            stage === GATE
              ? `The producer asked for changes to the rough cut.${note.trim() ? ` Their note: "${note.trim()}"` : ""}`
              : `The producer asked for more options on stage ${meta.n} · ${meta.label}.${note.trim() ? ` Their note: "${note.trim()}"` : ""}`,
            `Options now: ${ids}; picked: ${s.pick ?? "none"}.`,
            stage === GATE
              ? "Make the changes, re-render the rough cut and QC it, then show it again. Only the producer approves it."
              : `Make more options as siblings with new ids, register the full list with \`tl.mjs options set ${stage} --file <options.json>${s.pick ? " --keep-pick" : ""}\`, open the stage on the canvas and say in a line how each new one differs.`,
          ].join("\n"),
        );
      },
    }),
    [canAct, disabledReason, model, notify, sentAt, writeRequest],
  );

  // ── The countdown: ask for a tick when a deadline passes (or passed) ─────
  const told = useRef(new Set<string>());
  const toldPendingOnLoad = useRef(false);
  useEffect(() => {
    if (!canAct || !model.started) return;
    const expired = expiredStages(model).filter((s) => !told.current.has(`${s.id}@${s.deadline}`));
    const stuck =
      !toldPendingOnLoad.current && model.requests.some((r) => Date.now() - r.at > 15_000) ? model.requests.filter((r) => Date.now() - r.at > 15_000) : [];
    toldPendingOnLoad.current = true;
    if (expired.length === 0 && stuck.length === 0) return;
    for (const s of expired) told.current.add(`${s.id}@${s.deadline}`);
    const lines: string[] = [];
    if (expired.length) {
      lines.push(`countdown: ${expired.map((s) => s.id).join(", ")}`, "");
      for (const s of expired) {
        const meta = stageMeta(s.id);
        lines.push(
          `The countdown on stage ${meta.n} · ${meta.label} ran out at ${new Date(s.deadlineMs!).toLocaleTimeString()} with no pick — the recommended option is ${s.recommended ?? "the first"}.`,
        );
      }
    } else {
      lines.push("pending requests", "");
    }
    if (stuck.length) lines.push(`${stuck.length} button press(es) from the canvas are still waiting in requests/.`);
    lines.push("Run `tl.mjs tick` to apply them, then continue with the next stage (and keep going if auto-run is on).");
    notify(
      "countdown-expired",
      expired.length ? `Countdown · ${expired.map((s) => stageMeta(s.id).label).join(", ")}` : "Pending requests",
      lines.join("\n"),
    );
  }, [model, canAct, notify]);

  // ── Selection → the agent's context ───────────────────────────────────────
  const selectAddress = useCallback(
    (address: Record<string, unknown> | null, label: string) => {
      if (!address) {
        props.onSelect(null);
        return;
      }
      props.onSelect({ type: "node", content: label, label, address });
    },
    [props],
  );

  // ── Opening things ────────────────────────────────────────────────────────
  const openStage = useCallback(
    (stage: StageId, option?: string) => {
      const s = model.byId[stage];
      const opt = option ?? optionFor[stage] ?? defaultOptionId(s) ?? undefined;
      if (opt) setOptionFor((p) => ({ ...p, [stage]: opt }));
      setExpanded({ kind: "stage", stage });
      const meta = stageMeta(stage);
      selectAddress(opt && s.options.length ? { nodeId: `${stage}:${opt}` } : { nodeId: stage }, `${meta.label}${opt && s.options.length ? ` · option ${opt}` : ""}`);
    },
    [model, optionFor, selectAddress],
  );

  const openVersion = useCallback(
    (nodeId: string, time?: number) => {
      setExpanded({ kind: "version", nodeId });
      const v = model.versions.find((x) => x.nodeId === nodeId);
      if (time !== undefined) setVersionSeek({ t: time, seq: Date.now() });
      selectAddress({ nodeId, ...(time !== undefined ? { time } : {}) }, v ? `${formatLabel(v.format)} · ${langLabel(v.lang)}` : nodeId);
    },
    [model.versions, selectAddress],
  );

  const close = useCallback(() => {
    setExpanded(null);
    selectAddress(null, "");
  }, [selectAddress]);

  const onOpenNode = useCallback(
    (node: LayoutNode) => {
      if (node.kind === "version") openVersion(node.id);
      else if (node.kind === "option") openStage(node.stage, node.option?.id);
      else if (node.kind !== "placeholder" && node.kind !== "page") openStage(node.stage);
    },
    [openStage, openVersion],
  );

  const onOpenColumn = useCallback((col: LayoutColumn) => openStage(col.stage), [openStage]);

  // Focus the open page once it has been laid out (and again if it grows).
  const focusKey = expanded ? (expanded.kind === "stage" ? `page:${expanded.stage}` : `page:${expanded.nodeId}`) : "overview";
  const lastFocus = useRef<string>("");
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const key = `${focusKey}|${pageHeights[focusKey] ? "m" : "u"}`;
    if (lastFocus.current === key) return;
    lastFocus.current = key;
    if (!expanded) {
      c.home();
      return;
    }
    const rect = nodeRect(layout, focusKey.slice("page:".length));
    if (rect) c.focus(rect, { maxK: 1, minK: 0.5, padding: 24, align: "top" });
  }, [focusKey, layout, expanded, pageHeights]);

  // Re-fit once, when the first real film arrives after an empty first paint.
  const fittedStarted = useRef<boolean | null>(null);
  useEffect(() => {
    if (fittedStarted.current === model.started) return;
    const first = fittedStarted.current === null;
    fittedStarted.current = model.started;
    if (!first && !expanded) canvas.current?.home();
  }, [model.started, layout.bounds, expanded]);

  // ── Agent → viewer: navigate-to and locator cards ─────────────────────────
  const navigate = useCallback(
    (address: Record<string, unknown> | null | undefined): ViewerActionResult => {
      const nodeId = typeof address?.nodeId === "string" ? address.nodeId : "";
      const target = parseNodeId(nodeId);
      if (!target) return { success: false, message: `unknown node "${nodeId}" — use a stage id, <stage>:<option>, version:<format>:<lang> or overview` };
      if (target.kind === "overview") {
        close();
        return { success: true, message: "showing the whole run", data: { nodeId: "overview" } };
      }
      if (target.kind === "version") {
        if (!model.versions.some((v) => v.nodeId === target.nodeId)) {
          return { success: false, message: `no version "${target.nodeId}"; versions: ${model.versions.map((v) => v.nodeId).join(", ") || "none"}` };
        }
        const time = typeof address?.time === "number" ? address.time : undefined;
        openVersion(target.nodeId, time);
        return { success: true, message: `opened ${target.nodeId}`, data: { nodeId: target.nodeId, time: time ?? null } };
      }
      const s = model.byId[target.stage];
      if (target.option && !s.options.some((o) => o.id === target.option)) {
        return { success: false, message: `stage "${target.stage}" has no option "${target.option}" (options: ${s.options.map((o) => o.id).join(", ") || "none"})` };
      }
      openStage(target.stage, target.option);
      return { success: true, message: `opened ${target.stage}${target.option ? ` on option ${target.option}` : ""}`, data: { nodeId, status: s.status } };
    },
    [close, model, openStage, openVersion],
  );

  const handledAction = useRef<string | null>(null);
  useEffect(() => {
    const req = props.actionRequest;
    if (!req || handledAction.current === req.requestId) return;
    handledAction.current = req.requestId;
    if (req.actionId === "navigate-to") {
      props.onActionResult?.(req.requestId, navigate(req.params?.address as Record<string, unknown>));
    } else {
      props.onActionResult?.(req.requestId, { success: false, message: `unknown action "${req.actionId}"` });
    }
  }, [props.actionRequest, props.onActionResult, navigate]);

  useEffect(() => {
    const nav = props.navigateRequest;
    if (!nav) return;
    const result = navigate(nav.address as Record<string, unknown>);
    props.onNavigateComplete?.(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.navigateRequest]);

  // Deep link: `#tl=<nodeId>[&t=<seconds>][&settings=1]` opens that node once
  // the run has loaded — for shared links and for screenshots.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !model.started) return;
    deepLinked.current = true;
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    const nodeId = hash.get("tl");
    if (hash.get("settings") === "1") setSettingsOpen(true);
    if (!nodeId) return;
    const t = hash.get("t");
    window.setTimeout(() => navigate({ nodeId, ...(t ? { time: Number(t) } : {}) }), 60);
  }, [model.started, navigate]);

  // ── Render ────────────────────────────────────────────────────────────────
  const currentStage: StageId | null = expanded?.kind === "stage" ? expanded.stage : expanded?.kind === "version" ? "finals" : null;
  const selectedNodeId = expanded?.kind === "stage" ? `${expanded.stage}:${optionFor[expanded.stage] ?? ""}` : null;
  const params = (props.initParams ?? {}) as Record<string, number | string>;
  const blocked = model.stages.find((s) => s.blocked);

  const banner = model.filmError ? (
    <div className="tl-banner tl-errb">{model.filmError} — tl.mjs will not run until it parses.</div>
  ) : blocked ? (
    <div className="tl-banner tl-errb">
      Run stopped at {stageMeta(blocked.id).label}: {blocked.notes || "blocked"}. Tell the director how to continue.
    </div>
  ) : model.requests.length ? (
    <div className="tl-banner">
      <span className="tl-chip tl-pending">sent</span>
      {model.requests.length} request{model.requests.length === 1 ? "" : "s"} waiting for the director to record (tl.mjs tick)
    </div>
  ) : !canAct && model.started ? (
    <div className="tl-banner">{disabledReason}</div>
  ) : !cliConnected && model.started ? (
    <div className="tl-banner" title="Button presses are written to requests/ and applied by the next tl.mjs command">
      Director not connected — your choices are saved and applied when it runs <span className="tl-mono">tl.mjs tick</span>
    </div>
  ) : null;

  const legend = (
    <div className="tl-legend" onPointerDown={(e) => e.stopPropagation()}>
      <span>
        <i style={{ background: "var(--tl-primary)" }} /> picked path
      </span>
      <span>
        <i style={{ background: "var(--tl-warning)" }} /> awaiting
      </span>
      <span>
        <i style={{ background: "var(--tl-success)" }} /> confirmed
      </span>
      <span>
        <i style={{ background: "var(--tl-error)" }} /> changed
      </span>
      <span>
        <i style={{ background: "var(--tl-stale)" }} /> stale
      </span>
    </div>
  );

  return (
    <div className="tl-root" data-theme={props.theme === "light" ? "light" : "dark"}>
      <TopBar
        model={model}
        current={currentStage}
        onStage={(id) => (id === "finals" && model.versions.length ? openStage("finals") : openStage(id))}
        onSettings={() => setSettingsOpen((v) => !v)}
        settingsOpen={settingsOpen}
      />
      {settingsOpen ? <SettingsPanel model={model} params={params} onClose={() => setSettingsOpen(false)} /> : null}
      <Canvas
        ref={canvas}
        bounds={layout.bounds}
        autoFit={!expanded}
        home={home}
        onEscape={() => (settingsOpen ? setSettingsOpen(false) : close())}
        overlay={
          <>
            {banner}
            {expanded ? null : legend}
          </>
        }
      >
        <svg className="tl-edges" width={1} height={1}>
          {layout.edges.map((e) => (
            <path key={e.id} d={edgePath(e)} className={`tl-edge${e.kind === "plain" ? "" : ` tl-${e.kind === "lit" ? "lit" : e.kind}`}`} />
          ))}
        </svg>
        {layout.columns
          .filter((col) => !col.page)
          .map((col) => (
            <ColumnHead key={`h-${col.key}`} col={col} model={model} onOpen={onOpenColumn} />
          ))}
        {layout.nodes.map((node) => {
          if (node.kind === "page") {
            if (node.version || expanded?.kind === "version") {
              return (
                <VersionPage
                  key={node.id}
                  node={node}
                  model={model}
                  base={base}
                  onClose={close}
                  onMeasure={onMeasure}
                  onSwitch={(id) => openVersion(id)}
                  onTime={(t) => {
                    playhead.current = t;
                  }}
                  seekTo={versionSeek}
                />
              );
            }
            return (
              <StagePage
                key={node.id}
                node={node}
                model={model}
                base={base}
                optionId={optionFor[node.stage] ?? defaultOptionId(model.byId[node.stage])}
                onSelectOption={(id) => {
                  setOptionFor((p) => ({ ...p, [node.stage]: id }));
                  selectAddress({ nodeId: `${node.stage}:${id}` }, `${stageMeta(node.stage).label} · option ${id}`);
                }}
                actions={actions}
                onClose={close}
                onMeasure={onMeasure}
                deliveryDir={String(params.deliveryDir ?? "")}
              />
            );
          }
          return (
            <NodeCard
              key={node.id}
              node={node}
              model={model}
              base={base}
              selected={selectedNodeId === node.id}
              pending={!!node.option && model.requests.some((r) => r.stage === node.stage && r.option === node.option?.id)}
              onOpen={onOpenNode}
            />
          );
        })}
      </Canvas>
      {!model.started ? <EmptyState model={model} params={params} /> : null}
    </div>
  );
}

function EmptyState({ model, params }: { model: RunModel; params: Record<string, number | string> }) {
  const budget = model.film?.settings.budgetUsd ?? params.budgetUsd ?? 60;
  const countdown = model.film?.settings.countdownMin ?? params.countdownMin ?? 30;
  return (
    <div className="tl-empty">
      <div className="tl-empty-card">
        <div className="tl-mark" style={{ marginBottom: 8 }}>
          LAUNCH STUDIO
        </div>
        <h2>What is this week's video about?</h2>
        <p>
          Type the idea or selling point in the chat. The director writes the brief, then three script options — and each stage after it lands here as options you can
          play, compare and confirm.
        </p>
        <p>
          Every stage from script to sound waits <b>{countdown} min</b> for your pick, then takes the recommended option. The rough cut is the one hard gate: finals,
          languages and delivery wait for you. Paid calls stop at <b>${Number(budget).toFixed(0)}</b>.
        </p>
        <div className="tl-steps">
          {model.stages.map((s) => (
            <span key={s.id} className={s.id === GATE ? "tl-gate" : ""}>
              {stageMeta(s.id).n} {stageMeta(s.id).label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
