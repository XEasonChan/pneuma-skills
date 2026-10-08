/**
 * A stage's page, opened in place on the canvas: its options as tabs, the
 * selected one rendered for its medium, and the three actions — Confirm,
 * Auto-run to rough cut, Try more options. Confirm never writes film.json:
 * it goes through `RunActions` (a request file + a message to the director),
 * and `tl.mjs` records it.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  GATE,
  brand,
  contentUrl,
  formatLabel,
  isValidPick,
  langLabel,
  optionLangGroups,
  pickParts,
  pickedByLabel,
  stageMeta,
  type DerivedStage,
  type PendingRequest,
  type RunModel,
  type StageId,
} from "./model.js";
import type { LayoutNode } from "./layout.js";
import { AssetsBody, DeliverBody, IdeaBody, MusicBody, QcBlock, ScriptBody, VideoBody, VoBody, VoiceBody, VoicePickBody } from "./pages/bodies.js";
import { CountdownChip, StatusChip, VideoPlayer, useExists } from "./ui.js";
import { BoltIcon, CheckIcon, CloseIcon, GateIcon, MediumIcon, RefreshIcon, SendIcon, StarIcon } from "./icons.js";

export interface RunActions {
  /** An editing session with an agent attached: buttons can reach the director. */
  canAct: boolean;
  disabledReason: string | null;
  pendingFor(stage: StageId): PendingRequest | null;
  /** Pick `optionId` (or approve the stage as it is when null). */
  confirm(stage: StageId, optionId: string | null): void;
  setAutorun(on: boolean): void;
  moreOptions(stage: StageId, note: string): void;
}

export function usePageHeight(id: string, onMeasure: (id: string, h: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => onMeasure(id, el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, onMeasure]);
  return ref;
}

function Footer({
  stage,
  model,
  optionId,
  actions,
}: {
  stage: DerivedStage;
  model: RunModel;
  optionId: string | null;
  actions: RunActions;
}) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const pending = actions.pendingFor(stage.id);
  const isGate = stage.id === GATE;
  const hasOptions = stage.options.length > 0;
  const alreadyPicked = hasOptions ? stage.pick === optionId && (stage.status === "confirmed" || stage.status === "done") : stage.status === "confirmed" || stage.status === "done";
  const locked = stage.status === "locked";
  const nothing = !hasOptions && (stage.status === "empty" || stage.status === "working");
  const disabled = !actions.canAct || locked || alreadyPicked || !!pending || nothing;
  const autorunOn = model.film?.autoRun.enabled === true;
  const beforeGate = ["script", "music", "voice", "vo", "assets", "picture", "sound"].includes(stage.id);

  const label = isGate
    ? hasOptions
      ? `Approve rough cut ${optionId ?? ""}`
      : "Approve rough cut"
    : hasOptions
      ? `Confirm ${optionId ?? ""}`
      : stage.id === "finals"
        ? "Approve finals"
        : "Confirm";

  const why = pending
    ? "Sent — waiting for the director to record it (tl.mjs tick)"
    : !actions.canAct
      ? actions.disabledReason
      : locked
        ? `Locked — ${stage.reason}`
        : alreadyPicked
          ? `Confirmed ${pickedByLabel(stage)}`
          : nothing
            ? "Nothing to confirm yet"
            : isGate
              ? "Finals, languages and delivery run only after you approve this."
              : stage.status === "awaiting" && stage.deadlineMs !== null
                ? "Or let the countdown take the recommended option."
                : null;

  return (
    <div className="tl-page-foot" onPointerDown={(e) => e.stopPropagation()}>
      {asking ? (
        <div className="tl-more">
          <textarea
            autoFocus
            value={note}
            placeholder={isGate ? "What should change in the rough cut?" : "What should the other options try? (optional)"}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                actions.moreOptions(stage.id, note);
                setAsking(false);
                setNote("");
              }
              if (e.key === "Escape") setAsking(false);
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button
              className="tl-btn tl-primary"
              disabled={!actions.canAct}
              onClick={() => {
                actions.moreOptions(stage.id, note);
                setAsking(false);
                setNote("");
              }}
            >
              <SendIcon /> Send
            </button>
            <button className="tl-btn tl-ghost" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            className="tl-btn tl-primary"
            disabled={disabled}
            onClick={() => actions.confirm(stage.id, hasOptions ? optionId : null)}
            title={why ?? undefined}
            aria-label={alreadyPicked ? (isGate ? "Rough cut approved" : "Confirmed") : label.trim()}
          >
            {isGate ? <GateIcon /> : <CheckIcon />}
            {alreadyPicked ? (isGate ? "Rough cut approved" : "Confirmed") : label}
          </button>
          {beforeGate ? (
            <button
              className="tl-btn"
              disabled={!actions.canAct || !!actions.pendingFor("autorun" as StageId)}
              onClick={() => actions.setAutorun(!autorunOn)}
              title={autorunOn ? "Stop taking recommended options automatically" : "Take the recommended option at every stage up to the rough cut (never past it)"}
            >
              <BoltIcon />
              {autorunOn ? "Stop auto-run" : "Auto-run to rough cut"}
            </button>
          ) : null}
          {stage.id !== "idea" && stage.id !== "deliver" ? (
            <button className="tl-btn" disabled={!actions.canAct || locked} onClick={() => setAsking(true)}>
              <RefreshIcon />
              {isGate || stage.id === "finals" ? "Ask for changes" : "Try more options"}
            </button>
          ) : null}
          <span className="tl-spacer" />
          {why ? <span className="tl-note">{why}</span> : null}
        </>
      )}
    </div>
  );
}

function RoughcutBody({ model, base, kind }: { model: RunModel; base: string; kind: "roughcut" | "final" }) {
  const [key, setKey] = useState(model.versions[0]?.key ?? "");
  const v = model.versions.find((x) => x.key === key) ?? model.versions[0];
  const url = v ? contentUrl(base, kind === "final" ? v.final : v.roughcut, model.rev) : null;
  const exists = useExists(url);
  if (!v) return <p className="tl-lead">No formats or languages in the brief.</p>;
  const vertical = /9x16/.test(v.format);
  return (
    <div>
      <div className="tl-pills" style={{ marginBottom: 10 }}>
        {model.versions.map((x) => (
          <button key={x.key} className={`tl-btn${x.key === v.key ? " tl-primary" : ""}`} style={{ height: 24, fontSize: 11.5 }} onClick={() => setKey(x.key)}>
            {formatLabel(x.format)} · {langLabel(x.lang)}
          </button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: vertical ? "260px 1fr" : "minmax(0, 1fr) 270px", gap: 16 }}>
        <VideoPlayer
          src={exists === false ? null : url}
          aspect={vertical ? "9 / 16" : "16 / 9"}
          maxHeight={vertical ? 460 : 340}
          emptyText={`out/${kind === "final" ? "final" : "roughcut"}/${v.key}.mp4 is not rendered yet`}
        />
        <div>
          <div className="tl-h3">QC</div>
          <QcBlock qc={(kind === "final" ? v.qcFinal : v.qcRoughcut) as Record<string, unknown> | null} />
        </div>
      </div>
    </div>
  );
}

export function StagePage({
  node,
  model,
  base,
  optionId,
  onSelectOption,
  actions,
  onClose,
  onMeasure,
  deliveryDir,
}: {
  node: LayoutNode;
  model: RunModel;
  base: string;
  optionId: string | null;
  onSelectOption: (id: string) => void;
  actions: RunActions;
  onClose: () => void;
  onMeasure: (id: string, h: number) => void;
  deliveryDir: string;
}) {
  const stage = model.byId[node.stage];
  const meta = stageMeta(node.stage);
  const ref = usePageHeight(node.id, onMeasure);
  // A per-language stage (voice) picks one option per language: the "selected option" is the comma-joined set.
  const groups = optionLangGroups(stage);
  const option = groups ? undefined : stage.options.find((o) => o.id === optionId) ?? stage.options[0];
  const selectedId = groups ? (isValidPick(stage, optionId) ? optionId : stage.pick ?? stage.recommended) : option?.id ?? null;

  // Keep the selection valid when options are re-registered. A single option id (e.g. from a `navigate-to voice:ja-konoha`)
  // on a per-language stage swaps that language's pick into the current set.
  useEffect(() => {
    if (!stage.options.length) return;
    if (groups) {
      if (isValidPick(stage, optionId)) return;
      const base = pickParts(stage.pick ?? stage.recommended);
      const one = stage.options.find((o) => o.id === optionId);
      const next = one ? base.map((id) => (stage.options.find((o) => o.id === id)?.lang === one.lang ? one.id : id)).join(",") : stage.pick ?? stage.recommended;
      if (next && next !== optionId) onSelectOption(next);
      return;
    }
    if (!stage.options.some((o) => o.id === optionId)) onSelectOption(stage.pick ?? stage.recommended ?? stage.options[0].id);
  }, [stage, groups, optionId, onSelectOption]);

  let body;
  switch (stage.id) {
    case "idea":
      body = <IdeaBody model={model} />;
      break;
    case "script":
      body = <ScriptBody model={model} option={option} base={base} />;
      break;
    case "music":
      body = <MusicBody model={model} option={option} base={base} />;
      break;
    case "voice":
      body = groups ? (
        <VoicePickBody model={model} stage={stage} selected={selectedId} onSelect={onSelectOption} base={base} />
      ) : (
        <VoiceBody model={model} option={option} base={base} />
      );
      break;
    case "vo":
      body = <VoBody model={model} option={option} base={base} />;
      break;
    case "assets":
      body = <AssetsBody model={model} option={option} base={base} />;
      break;
    case "roughcut":
      body = <RoughcutBody model={model} base={base} kind="roughcut" />;
      break;
    case "finals":
      body = <RoughcutBody model={model} base={base} kind="final" />;
      break;
    case "deliver":
      body = <DeliverBody model={model} deliveryDir={deliveryDir} />;
      break;
    default:
      body = <VideoBody model={model} option={option} base={base} stage={stage.id} />;
  }

  return (
    <div ref={ref} className="tl-page" style={{ left: node.x, top: node.y, width: node.w }} data-tl-node="">
      <div className="tl-page-head">
        <MediumIcon medium={stage.id === GATE ? "gate" : meta.medium} style={{ width: 16, height: 16, color: "var(--tl-muted)" }} />
        <span className="tl-n">{meta.n}</span>
        <h2>{stage.id === "finals" ? "Finals · every format and language" : meta.label}</h2>
        <StatusChip status={stage.status} title={stage.reason ?? undefined} />
        {stage.status === "awaiting" && stage.deadlineMs !== null ? <CountdownChip deadlineMs={stage.deadlineMs} prefix="auto-picks in" /> : null}
        {stage.id === GATE ? <span className="tl-chip tl-gate">hard gate · the producer approves</span> : null}
        <span className="tl-spacer" />
        {stage.reason && stage.status !== "awaiting" ? <span className="tl-note">{stage.reason}</span> : null}
        <button className="tl-btn tl-ghost tl-icon" onClick={onClose} title="Close (Esc)">
          <CloseIcon />
        </button>
      </div>
      {stage.options.length > 0 && !groups ? (
        <div className="tl-tabs" onPointerDown={(e) => e.stopPropagation()}>
          {stage.options.map((o) => (
            <button key={o.id} className={`tl-tab${o.id === option?.id ? " tl-on" : ""}`} onClick={() => onSelectOption(o.id)} title={o.summary ? brand(o.summary) : undefined}>
              <span className="tl-node-id">{o.id}</span>
              <span className="tl-tab-title">{brand(o.title)}</span>
              {o.recommended ? <StarIcon style={{ width: 12, height: 12, color: "var(--tl-primary)", flex: "none" }} /> : null}
              {stage.pick === o.id ? <CheckIcon style={{ width: 13, height: 13, color: "var(--tl-success)", flex: "none" }} /> : null}
            </button>
          ))}
        </div>
      ) : null}
      {option?.summary && stage.options.length > 0 && !groups && !["script"].includes(stage.id) ? (
        <p className="tl-lead" style={{ padding: "10px 14px 0", margin: 0 }}>
          {brand(option.summary)}
        </p>
      ) : null}
      <div className="tl-page-body" data-tl-scroll="" style={{ maxHeight: 620 }}>
        {body}
      </div>
      <Footer stage={stage} model={model} optionId={selectedId} actions={actions} />
    </div>
  );
}
