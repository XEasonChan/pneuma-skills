/**
 * Node cards and column headers on the canvas. A node is a glance: what the
 * option is, whether it is the pick, and — for media — a peek. Its page
 * (StagePage / VersionPage) is where the medium is played in full.
 */

import { memo } from "react";

import {
  brand,
  contentUrl,
  formatLabel,
  langLabel,
  optionDoc,
  optionMedia,
  parseJson,
  pickedByLabel,
  resolveRef,
  stageMeta,
  type DerivedStage,
  type RunModel,
  type StageOption,
} from "./model.js";
import { HEAD_H, versionAspect, type LayoutColumn, type LayoutNode } from "./layout.js";
import { BpmSpark, CountdownChip, Density, StatusChip, VideoPoster, useExists } from "./ui.js";
import { CheckIcon, GateIcon, LockIcon, MediumIcon, StarIcon } from "./icons.js";

interface NodeProps {
  node: LayoutNode;
  model: RunModel;
  base: string;
  selected: boolean;
  pending: boolean;
  onOpen: (node: LayoutNode) => void;
}

function scriptStats(doc: Record<string, unknown> | null) {
  const scenes = Array.isArray(doc?.scenes) ? (doc!.scenes as Array<Record<string, unknown>>) : [];
  const seconds = scenes.reduce((s, sc) => s + (Number(sc.durationS) || 0), 0);
  const info = scenes.length ? scenes.reduce((s, sc) => s + (Number((sc.density as Record<string, unknown>)?.info) || 0), 0) / scenes.length : 0;
  return { count: scenes.length, seconds, info };
}

function OptionBody({ node, model, base, stage }: { node: LayoutNode; model: RunModel; base: string; stage: DerivedStage }) {
  const option = node.option as StageOption;
  const medium = stage.medium;
  if (medium === "script") {
    const doc = optionDoc(model, option, (d) => !!d && typeof d === "object" && Array.isArray((d as Record<string, unknown>).scenes));
    const st = scriptStats(doc);
    const logline = (doc?.logline as string) ?? option.summary;
    return (
      <>
        <div className="tl-node-title">{brand(option.title)}</div>
        {logline ? <div className="tl-node-sum">{brand(logline)}</div> : null}
        <div className="tl-node-meta">
          {st.count ? <span>{st.count} scenes</span> : null}
          {st.seconds ? <span>· {Math.round(st.seconds)} s</span> : null}
          {st.count ? (
            <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
              · info <Density value={st.info} />
            </span>
          ) : null}
        </div>
      </>
    );
  }
  if (medium === "music") {
    const doc = optionDoc(model, option, (d) => !!d && typeof d === "object" && "bed" in (d as object));
    const bed = (doc?.bed ?? {}) as Record<string, unknown>;
    const map = Array.isArray(bed.bpmMap) ? (bed.bpmMap as Array<{ from: number; to: number; bpm: number }>) : [];
    const bpms = map.map((m) => Number(m.bpm)).filter(Number.isFinite);
    return (
      <>
        <div className="tl-node-title">{brand(option.title)}</div>
        <BpmSpark points={map} />
        <div className="tl-node-meta">
          {bpms.length ? <span>{Math.min(...bpms) === Math.max(...bpms) ? `${bpms[0]} BPM` : `${Math.min(...bpms)}–${Math.max(...bpms)} BPM`}</span> : null}
          {bed.key ? <span>· {String(bed.key)}</span> : null}
          {doc?.sfxSet ? <span>· SFX {String(doc.sfxSet)}</span> : null}
          {bed.source ? <span>· {String(bed.source)}</span> : null}
        </div>
      </>
    );
  }
  if (medium === "voice") {
    const langs = option.files.map((f) => /\/(ja|en|en-jasub)-[^/]+\.json$/.exec(f)?.[1]).filter(Boolean) as string[];
    const names = option.files
      .map((f) => {
        const d = parseJson<Record<string, unknown>>(model.texts[f]);
        return d?.name ? `${String(d.lang ?? "").toUpperCase()} ${d.name}` : null;
      })
      .filter(Boolean);
    return (
      <>
        <div className="tl-node-title">{brand(option.title)}</div>
        <div className="tl-node-sum">{names.length ? names.join(" · ") : option.summary ?? ""}</div>
        <div className="tl-node-meta">{langs.length ? <span>{[...new Set(langs)].map(langLabel).join(" · ")}</span> : null}</div>
      </>
    );
  }
  if (medium === "vo") {
    const lines = voLines(model, option);
    const ids = new Set(lines.map((l) => `${l.sceneId}|${l.lang}|${l.id}`));
    return (
      <>
        <div className="tl-node-title">{brand(option.title)}</div>
        {option.summary ? <div className="tl-node-sum">{brand(option.summary)}</div> : null}
        <div className="tl-node-meta">{lines.length ? <span>{ids.size} lines · {lines.length} takes</span> : null}</div>
      </>
    );
  }
  if (medium === "assets") {
    const items = assetItems(model, option);
    const thumbs = items.filter((i) => i.file && /\.(png|jpe?g|webp|gif|avif)$/i.test(i.file)).slice(0, 3);
    const gaps = items.filter((i) => i.status === "gap").length;
    return (
      <>
        <div className="tl-node-title">{brand(option.title)}</div>
        <div className="tl-thumb-row">
          {(thumbs.length ? thumbs : [null, null, null]).map((t, i) => (
            <div key={i} style={t?.file ? { backgroundImage: `url("${contentUrl(base, t.file, model.rev)}")` } : undefined} />
          ))}
        </div>
        <div className="tl-node-meta">
          <span>{items.length} items</span>
          {gaps ? <span>· {gaps} to generate</span> : <span>· library first</span>}
        </div>
      </>
    );
  }
  // Video stages (picture, sound, rough cut): a poster of the preview.
  const video = option.preview && /\.(mp4|mov|webm)$/i.test(option.preview) ? option.preview : optionMedia(option, "video")[0];
  return (
    <>
      <VideoPoster src={video ? contentUrl(base, video, model.rev) : null} aspect="16 / 9" height={112} empty="No preview yet" />
      <div className="tl-node-title">{brand(option.title)}</div>
    </>
  );
}

export interface VoLine {
  id: string;
  sceneId: string;
  lang: string;
  text: string;
  take: number | string;
  file: string | null;
  durS: number | null;
  picked: boolean;
  check?: string;
}

/** VO lines: the option's own JSON arrays, else stages/vo/lines.json. */
export function voLines(model: RunModel, option?: StageOption): VoLine[] {
  const sources: Array<{ path: string; text: string }> = [];
  for (const f of option?.files ?? []) if (model.texts[f]) sources.push({ path: f, text: model.texts[f] });
  if (!sources.some((s) => s.text.trim().startsWith("["))) {
    const path = "stages/vo/lines.json";
    if (model.texts[path]) sources.push({ path, text: model.texts[path] });
  }
  const out: VoLine[] = [];
  for (const s of sources) {
    let doc: unknown;
    try {
      doc = JSON.parse(s.text);
    } catch {
      continue;
    }
    const list = Array.isArray(doc) ? doc : Array.isArray((doc as Record<string, unknown>)?.lines) ? ((doc as Record<string, unknown>).lines as unknown[]) : [];
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const l = raw as Record<string, unknown>;
      out.push({
        id: String(l.id ?? ""),
        sceneId: String(l.sceneId ?? ""),
        lang: String(l.lang ?? ""),
        text: String(l.text ?? ""),
        take: (l.take as number | string) ?? 1,
        file: resolveRef(s.path, l.file as string),
        durS: Number.isFinite(Number(l.durS)) ? Number(l.durS) : null,
        picked: l.picked === true || l.selected === true || l.best === true,
        check: typeof l.check === "string" ? l.check : typeof l.readCheck === "string" ? l.readCheck : undefined,
      });
    }
  }
  return out;
}

export interface AssetItem {
  sceneId: string;
  kind: string;
  file: string | null;
  source: string;
  status: string;
  note?: string;
  label?: string;
}

/** Asset items: `{ items: [...] }` in the option's JSON, else its image files. */
export function assetItems(model: RunModel, option?: StageOption): AssetItem[] {
  if (!option) return [];
  const out: AssetItem[] = [];
  for (const f of option.files) {
    const text = model.texts[f];
    if (!text) continue;
    try {
      const doc = JSON.parse(text) as Record<string, unknown>;
      const items = Array.isArray(doc.items) ? doc.items : Array.isArray(doc.assets) ? doc.assets : [];
      for (const raw of items as Array<Record<string, unknown>>) {
        out.push({
          sceneId: String(raw.sceneId ?? raw.scene ?? ""),
          kind: String(raw.kind ?? "image"),
          file: resolveRef(f, (raw.file ?? raw.thumb) as string),
          source: String(raw.source ?? "library"),
          status: String(raw.status ?? (raw.file ? "matched" : "gap")),
          note: typeof raw.note === "string" ? raw.note : undefined,
          label: typeof raw.label === "string" ? raw.label : undefined,
        });
      }
    } catch {
      /* not an asset list */
    }
  }
  if (out.length === 0) {
    for (const f of [...optionMedia(option, "image"), ...optionMedia(option, "video")]) {
      out.push({ sceneId: "", kind: /\.(mp4|mov|webm)$/i.test(f) ? "footage" : "image", file: f, source: "", status: "matched" });
    }
  }
  return out;
}

function OptionBadges({ node, stage, pending }: { node: LayoutNode; stage: DerivedStage; pending: boolean }) {
  const option = node.option as StageOption;
  if (pending) return <span className="tl-chip tl-pending">sent</span>;
  if (node.picked) {
    if (stage.status === "confirmed" || stage.status === "done") {
      return (
        <span className={`tl-chip tl-st-${stage.status}`} title={`Confirmed ${pickedByLabel(stage)}`}>
          <CheckIcon />
          {stage.pickedBy === "producer" ? "The producer" : stage.pickedBy === "auto-timeout" ? "countdown" : stage.pickedBy === "auto-run" ? "auto-run" : "picked"}
        </span>
      );
    }
    return <StatusChip status={stage.status} title={stage.reason ?? undefined} />;
  }
  if (stage.status === "awaiting" && option.recommended) {
    return (
      <span className="tl-chip tl-rec" title="Taken when the countdown runs out">
        <StarIcon /> recommended
      </span>
    );
  }
  return null;
}

export const NodeCard = memo(function NodeCard({ node, model, base, selected, pending, onOpen }: NodeProps) {
  const stage = model.byId[node.stage];
  const meta = stageMeta(node.stage);
  const cls = ["tl-node"];
  if (node.picked) cls.push("tl-picked");
  if (node.kind === "option" && !node.picked && stage.pick) cls.push("tl-unpicked");
  if (selected) cls.push("tl-selected");
  if (node.kind === "placeholder") cls.push("tl-placeholder");
  const style = { left: node.x, top: node.y, width: node.w, height: node.h };

  if (node.kind === "placeholder") {
    const upstream = stage.reason?.replace(/^waiting for /, "") ?? "";
    const upLabel = upstream && model.byId[upstream as keyof typeof model.byId] ? stageMeta(upstream as never).label : upstream;
    return (
      <div className={cls.join(" ")} style={style} data-tl-node="">
        <div className="tl-node-head">
          <span className="tl-node-kind">
            {stage.status === "locked" ? <LockIcon /> : <MediumIcon medium={meta.medium} />}
            {node.stage === "finals" ? "Versions" : meta.label}
          </span>
        </div>
        <div className="tl-node-body">
          <div className="tl-node-sum">
            {stage.status === "locked"
              ? `Waiting for ${upLabel}`
              : node.stage === "finals"
                ? "A version per format × language appears here."
                : stage.status === "working"
                  ? stage.blocked
                    ? `Blocked — ${stage.notes || "see chat"}`
                    : "The director is working on it…"
                  : "Not started"}
          </div>
        </div>
        <span className="tl-port tl-in" />
      </div>
    );
  }

  const open = () => onOpen(node);

  if (node.kind === "idea") {
    const brief = model.film?.run.brief;
    return (
      <div className={cls.join(" ")} style={style} data-tl-node="" onClick={open}>
        <div className="tl-node-head">
          <span className="tl-node-kind">
            <MediumIcon medium="brief" />
            Idea
          </span>
          <span className="tl-spacer" />
          <StatusChip status={stage.status} />
        </div>
        <div className="tl-node-body">
          <div className="tl-node-title" style={{ WebkitLineClamp: 3 }}>
            {brief?.idea ? brand(brief.idea) : "Type the idea in the chat"}
          </div>
          <div className="tl-node-meta">
            {brief ? (
              <>
                <span>{brief.market === "both" ? "US + JP" : brief.market.toUpperCase()}</span>
                <span>· {brief.formats.length} formats × {brief.languages.length} languages</span>
              </>
            ) : null}
          </div>
        </div>
        <span className="tl-port tl-out" />
      </div>
    );
  }

  if (node.kind === "version") {
    return <VersionCard node={node} model={model} base={base} selected={selected} onOpen={onOpen} />;
  }

  if (node.kind === "deliver") {
    return (
      <div className={cls.join(" ")} style={style} data-tl-node="" onClick={open}>
        <div className="tl-node-head">
          <span className="tl-node-kind">
            <MediumIcon medium="deliver" />
            Deliver
          </span>
          <span className="tl-spacer" />
          <StatusChip status={stage.status} />
        </div>
        <div className="tl-node-body">
          <div className="tl-node-sum">Copied to the delivery folder / {model.film?.run.id ?? "<run>"} (settings.deliveryDir, else ~/LaunchStudio/deliveries), with a reminder note, after the final OK.</div>
        </div>
        <span className="tl-port tl-in" />
      </div>
    );
  }

  if (node.kind === "stage") {
    const firstRough = model.versions[0]?.roughcut;
    const video =
      node.stage === "roughcut" && firstRough
        ? firstRough
        : node.stage === "picture" || node.stage === "sound"
          ? `stages/${node.stage}/preview.mp4`
          : null;
    const ready = model.versions.filter((v) => v.qcRoughcut).length;
    return (
      <div className={cls.join(" ")} style={style} data-tl-node="" onClick={open}>
        <div className="tl-node-head">
          <span className="tl-node-kind">
            {node.stage === "roughcut" ? <GateIcon /> : <MediumIcon medium={meta.medium} />}
            {meta.label}
          </span>
          <span className="tl-spacer" />
          <StatusChip status={stage.status} />
        </div>
        <div className="tl-node-body">
          {video ? <VideoPoster src={contentUrl(base, video, model.rev)} aspect="16 / 9" height={112} empty="Not rendered yet" /> : null}
          <div className="tl-node-sum">
            {node.stage === "roughcut"
              ? stage.status === "confirmed"
                ? "Approved by the producer — finals may run"
                : `${ready}/${model.versions.length} rough cuts checked · the producer approves`
              : stage.notes || (stage.status === "working" ? "The director is working on it…" : "")}
          </div>
        </div>
        <span className="tl-port tl-in" />
        <span className="tl-port tl-out" />
      </div>
    );
  }

  // Option node.
  const kindLabel = meta.label === "Music & rhythm" ? "Music" : meta.label;
  const showCountdown = stage.status === "awaiting" && node.option?.recommended && stage.deadlineMs !== null && !stage.pick;
  return (
    <div className={cls.join(" ")} style={style} data-tl-node="" onClick={open}>
      <div className="tl-node-head">
        <span className="tl-node-kind">
          <MediumIcon medium={meta.medium} />
          {kindLabel}
        </span>
        <span className="tl-node-id">{node.option?.id}</span>
        <span className="tl-spacer" />
        <OptionBadges node={node} stage={stage} pending={pending} />
      </div>
      <div className="tl-node-body">
        <OptionBody node={node} model={model} base={base} stage={stage} />
        {showCountdown ? (
          <div className="tl-node-meta" style={{ marginTop: 0 }}>
            <CountdownChip deadlineMs={stage.deadlineMs!} prefix="auto-picks in" />
          </div>
        ) : null}
      </div>
      <span className="tl-port tl-in" />
      <span className="tl-port tl-out" />
    </div>
  );
});

/** a poster second ≈ 48 % into the version (its own clock when known), else 0.8 s */
function posterT(model: RunModel, key: string): string {
  try {
    const tl = JSON.parse(model.texts[`timelines/${key}.json`] ?? "null");
    const f = tl?.formats?.[key]?.frames, fps = tl?.fps ?? 30;
    if (f) return ((f / fps) * 0.48).toFixed(1);
  } catch { /* no clock yet */ }
  return "0.8";
}

function VersionCard({ node, model, base, selected, onOpen }: { node: LayoutNode; model: RunModel; base: string; selected: boolean; onOpen: (n: LayoutNode) => void }) {
  const v = node.version!;
  // Probe only what can exist: a final once finals are open, a rough cut once
  // one was recorded or registered. A 404 per empty version is noise.
  const finalsOpen = model.byId.finals.status !== "locked" || !!v.qcFinal;
  const roughOpen = !!v.qcRoughcut || model.byId.roughcut.options.length > 0;
  const finalUrl = finalsOpen ? contentUrl(base, v.final, model.rev) : null;
  const roughUrl = roughOpen ? contentUrl(base, v.roughcut, model.rev) : null;
  const hasFinal = useExists(finalUrl);
  const hasRough = useExists(roughUrl);
  // before its mix exists a version shows its VO-only picture (render.mjs), as the version page does (contract: final, else the rough
  // cut, else the picture). A rendered 9:16 picture used to read "Not rendered" on the canvas.
  const pictureOpen = model.byId.picture.options.length > 0 || !!model.texts[`timelines/${v.key}.json`];
  const pictureUrl = pictureOpen && hasFinal === false && hasRough === false ? contentUrl(base, v.picture, model.rev) : null;
  const hasPicture = useExists(pictureUrl);
  const src = hasFinal ? finalUrl : hasRough ? roughUrl : hasPicture ? pictureUrl : null;
  const which = hasFinal ? "final" : hasRough ? "rough cut" : hasPicture ? "picture · VO only" : null;
  const qc = (hasFinal ? v.qcFinal : v.qcRoughcut) as Record<string, unknown> | null;
  const aspect = versionAspect(v.format);
  const cls = ["tl-node"];
  if (selected) cls.push("tl-selected");
  if (hasFinal) cls.push("tl-picked");
  const pending = hasFinal === null || hasRough === null || (pictureUrl !== null && hasPicture === null);
  return (
    <div className={cls.join(" ")} style={{ left: node.x, top: node.y, width: node.w, height: node.h }} data-tl-node="" onClick={() => onOpen(node)}>
      <div className="tl-node-head">
        <span className="tl-node-kind">
          <MediumIcon medium="video" />
          {formatLabel(v.format)}
        </span>
        <span className="tl-spacer" />
        <span className="tl-chip">{langLabel(v.lang)}</span>
      </div>
      <div className="tl-node-body" style={{ gap: 7 }}>
        <div className="tl-poster" style={{ height: 112, display: "grid", placeItems: "center", background: "var(--tl-card-3)" }}>
          {src ? (
            // the poster frame: well into the film (the product on screen), not the opening type still being typed
            <video src={`${src}#t=${posterT(model, v.key)}`} preload="metadata" muted playsInline style={{ height: "100%", width: "auto", aspectRatio: aspect, objectFit: "cover" }} />
          ) : (
            <div className="tl-poster-empty">{pending ? "…" : "Not rendered"}</div>
          )}
        </div>
        <div className="tl-node-meta" style={{ marginTop: 0 }}>
          {which ? <span className={`tl-chip ${hasFinal ? "tl-st-done" : "tl-st-awaiting"}`}>{which}</span> : <span className="tl-chip tl-st-empty">not rendered</span>}
          {qc && Array.isArray(qc.checks) && (qc.checks as Array<Record<string, unknown>>).some((c) => c.status === "fail") ? (
            <span className="tl-chip tl-st-changed">QC fail</span>
          ) : qc?.pass !== undefined ? (
            <span className={`tl-chip ${qc.pass ? "tl-st-confirmed" : "tl-st-changed"}`}>QC {qc.pass ? "pass" : "fail"}</span>
          ) : null}
          {qc?.lufs !== undefined ? <span>{String(qc.lufs)} LUFS</span> : null}
        </div>
      </div>
      <span className="tl-port tl-in" />
      <span className="tl-port tl-out" />
    </div>
  );
}

export function ColumnHead({ col, model, onOpen }: { col: LayoutColumn; model: RunModel; onOpen: (col: LayoutColumn) => void }) {
  const stage = model.byId[col.stage];
  const meta = stageMeta(col.stage);
  const label = col.key === "versions" ? "Finals · versions" : meta.label;
  return (
    <div className="tl-colhead" style={{ left: col.x, top: col.top - HEAD_H, maxWidth: Math.max(col.w, 260) }} data-tl-node="" onClick={() => onOpen(col)}>
      <span className="tl-n">{meta.n}</span>
      <span className="tl-lbl">{label}</span>
      {col.stage === "roughcut" ? <span className="tl-chip tl-gate">hard gate</span> : null}
      {!col.page ? <StatusChip status={stage.status} title={stage.reason ?? undefined} /> : null}
      {!col.page && stage.status === "awaiting" && stage.deadlineMs !== null ? <CountdownChip deadlineMs={stage.deadlineMs} /> : null}
    </div>
  );
}
