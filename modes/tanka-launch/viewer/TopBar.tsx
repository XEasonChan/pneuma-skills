/**
 * The top bar: run title, budget meter (ledger spent / cap), auto-run state,
 * settings, and the stage rail — every stage's derived status on one row.
 */

import { brand, formatSeconds, money, stageMeta, type RunModel, type StageId } from "./model.js";
import { formatCountdown } from "../skill/scripts/lib/stage-state.mjs";
import { useNow } from "./ui.js";
import { BoltIcon, CloseIcon, GearIcon } from "./icons.js";

export function TopBar({
  model,
  current,
  onStage,
  onSettings,
  settingsOpen,
}: {
  model: RunModel;
  current: StageId | null;
  onStage: (id: StageId) => void;
  onSettings: () => void;
  settingsOpen: boolean;
}) {
  const film = model.film;
  const b = model.budget;
  const cap = b.capUsd ?? 0;
  const ratio = cap > 0 ? b.spentUsd / cap : 0;
  const anyDeadline = model.stages.some((s) => s.status === "awaiting" && s.deadlineMs !== null);
  const now = useNow(1000, anyDeadline);
  return (
    <div className="tl-top">
      <div className="tl-top-row">
        <span className="tl-mark">LAUNCH</span>
        <div className="tl-title">
          <h1 title={film ? brand(film.run.title) : undefined}>{film && model.started ? brand(film.run.title) : "Launch studio"}</h1>
          {film && model.started ? <span className="tl-runid">{film.run.id}</span> : null}
        </div>
        {film?.autoRun.enabled ? (
          <span className="tl-chip tl-rec" title="Every stage takes its recommended option up to the rough cut">
            <BoltIcon /> auto-run on
          </span>
        ) : film?.autoRun.stoppedReason === "budget" ? (
          <span className="tl-chip tl-st-changed" title="Auto-run stopped: a paid call would pass the budget cap">
            auto-run stopped · budget
          </span>
        ) : null}
        <div className="tl-budget" title={`${b.calls} paid call(s)${b.open ? `, ${b.open} still open` : ""}. Reserved calls count at their estimate.`}>
          <div className="tl-budget-label">
            <span>Budget</span>
            <span>
              <b>{money(b.spentUsd)}</b> / {money(b.capUsd)}
            </span>
          </div>
          <div className={`tl-meter${ratio >= 1 ? " tl-over" : ratio >= 0.8 ? " tl-warn" : ""}`}>
            <i style={{ width: `${Math.min(100, ratio * 100)}%` }} />
          </div>
        </div>
        <button className={`tl-btn tl-ghost tl-icon${settingsOpen ? " tl-on" : ""}`} onClick={onSettings} title="Settings: keys, folders, CLI paths">
          {settingsOpen ? <CloseIcon /> : <GearIcon />}
        </button>
      </div>
      <div className="tl-rail" role="tablist">
        {model.stages.map((s) => {
          const meta = stageMeta(s.id);
          const sub =
            s.status === "awaiting" && s.deadlineMs !== null
              ? formatCountdown(s.deadlineMs - now)
              : s.status === "awaiting" && s.id === "roughcut"
                ? "The producer"
                : s.pick
                  ? `${s.pick}${s.pickedBy === "auto-timeout" ? " · timeout" : s.pickedBy === "auto-run" ? " · auto" : ""}`
                  : s.status === "locked"
                    ? ""
                    : s.status === "empty"
                      ? ""
                      : s.status;
          const usd = b.byStage[s.id];
          return (
            <button
              key={s.id}
              role="tab"
              className={`tl-rail-item${current === s.id ? " tl-on" : ""}`}
              data-status={s.status}
              data-gate={s.id === "roughcut" ? "true" : "false"}
              onClick={() => onStage(s.id)}
              title={`${meta.n} ${meta.label} — ${s.status}${s.reason ? ` (${s.reason})` : ""}${usd ? ` · ${money(usd)}` : ""}`}
            >
              <span className="tl-rail-bar" />
              <span className="tl-rail-label">
                <span>{meta.label === "Music & rhythm" ? "Music" : meta.label}</span>
                <span className="tl-muted" style={{ fontWeight: 500 }}>{meta.n}</span>
              </span>
              <span className="tl-rail-sub">{sub || " "}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Home-relative paths read as "~/…"; the full path stays in the tooltip. */
function Path({ value }: { value: string }) {
  const short = value.replace(/^\/(?:Users|home)\/[^/]+/, "~");
  return <span title={value}>{short}</span>;
}

const KEY_ROWS: Array<{ param: string; env: string; label: string; optional?: boolean }> = [
  { param: "elevenLabsApiKey", env: "ELEVENLABS_API_KEY", label: "ElevenLabs" },
  { param: "falApiKey", env: "FAL_KEY", label: "fal.ai (Seedance)" },
  { param: "openrouterApiKey", env: "OPENROUTER_API_KEY", label: "OpenRouter", optional: true },
  { param: "figmaToken", env: "FIGMA_TOKEN", label: "Figma token", optional: true },
];

/**
 * Settings: which keys are configured (never their values), the folders and
 * CLI paths, the budget and countdown. Values come from the session's init
 * params; they are changed where Pneuma keeps them.
 */
export function SettingsPanel({ model, params, onClose }: { model: RunModel; params: Record<string, number | string>; onClose: () => void }) {
  const has = (k: string) => String(params[k] ?? "").trim() !== "";
  const film = model.film;
  const mock = /^(on|true|1|yes)$/i.test(String(params.mock ?? "")) || film?.settings.mock === true;
  const roots = String(params.assetRoots ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <div className="tl-pop" onPointerDown={(e) => e.stopPropagation()}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
        <h3 style={{ margin: 0, flex: 1 }}>Run settings</h3>
        <button className="tl-btn tl-ghost tl-icon" onClick={onClose} title="Close">
          <CloseIcon />
        </button>
      </div>
      <div className="tl-h3">API keys</div>
      <dl style={{ margin: 0 }}>
        {KEY_ROWS.map((r) => (
          <div className="tl-set-row" key={r.param}>
            <dt>{r.label}</dt>
            <dd>
              {has(r.param) ? <span className="tl-yes">configured</span> : <span className="tl-no">{r.optional ? "not set (optional)" : "not set"}</span>}
              <span className="tl-mono tl-muted"> · {r.env}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="tl-note" style={{ margin: "8px 0 0" }}>
        Values are never shown here. Keys live in Pneuma: <b>Launcher → Settings → API Keys</b> (saved to ~/.pneuma/api-keys.json — name them as above and every new run picks them up), or in this workspace's launch form.
      </p>
      <div className="tl-h3">Folders and tools</div>
      <dl style={{ margin: 0 }}>
        <div className="tl-set-row">
          <dt>Asset folders</dt>
          <dd className="tl-mono">{roots.length ? roots.map((r) => <div key={r}><Path value={r} /></div>) : <span className="tl-no">none</span>}</dd>
        </div>
        <div className="tl-set-row">
          <dt>PRD folder</dt>
          <dd className="tl-mono">{params.prdRoot ? <Path value={String(params.prdRoot)} /> : <span className="tl-no">not set</span>}</dd>
        </div>
        <div className="tl-set-row">
          <dt>Delivery folder</dt>
          <dd className="tl-mono">{params.deliveryDir ? <Path value={String(params.deliveryDir)} /> : <span className="tl-no">not set</span>}</dd>
        </div>
        <div className="tl-set-row">
          <dt>Codex CLI</dt>
          <dd className="tl-mono">{String(params.codexPath ?? "") || <span className="tl-no">not set</span>}</dd>
        </div>
      </dl>
      <div className="tl-h3">This run</div>
      <dl style={{ margin: 0 }}>
        <div className="tl-set-row">
          <dt>Budget cap</dt>
          <dd>
            {money(film?.settings.budgetUsd ?? Number(params.budgetUsd ?? 60))} · spent {money(model.budget.spentUsd)}
          </dd>
        </div>
        <div className="tl-set-row">
          <dt>Countdown</dt>
          <dd>{film?.settings.countdownMin ?? params.countdownMin ?? 30} min per stage (script → sound)</dd>
        </div>
        <div className="tl-set-row">
          <dt>Providers</dt>
          <dd>{mock ? <span style={{ color: "var(--tl-warning)", fontWeight: 600 }}>mock — no paid calls</span> : "real"}</dd>
        </div>
        <div className="tl-set-row">
          <dt>Workspace config</dt>
          <dd className="tl-mono tl-muted">.pneuma/config.json · skill .env</dd>
        </div>
      </dl>
      <p className="tl-note" style={{ margin: "8px 0 0" }}>
        To change the budget mid-run, ask the director (<span className="tl-mono">tl.mjs budget set</span>). Folders and keys apply to the next session of this workspace.
      </p>
    </div>
  );
}

export { formatSeconds };
