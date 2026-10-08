/**
 * A version (format × language) opened in place: the storyboard strip (one
 * frame per scene), the MP4 player, and the timeline below it on the same
 * clock. Frames come from the QC record's `storyboard[]` when the director
 * wrote one, else they are grabbed from the MP4 in the browser.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  brand,
  contentUrl,
  formatLabel,
  langLabel,
  resolveRef,
  secondsOf,
  timelineDuration,
  timelineFor,
  type RunModel,
  type Version,
} from "./model.js";
import { versionAspect, type LayoutNode } from "./layout.js";
import { TimelinePanel } from "./Timeline.js";
import { QcBlock } from "./pages/bodies.js";
import { usePageHeight } from "./StagePage.js";
import { VideoPlayer, useExists, type VideoHandle } from "./ui.js";
import { CloseIcon, FilmIcon } from "./icons.js";

type Rec = Record<string, unknown>;

interface Frame {
  id: string;
  t: number;
  src: string | null;
  /** The scene's span in seconds, when a timeline gives it. */
  from?: number;
  to?: number;
}

const frameCache = new Map<string, string>();

/** Grab frames from a same-origin MP4 at the given times (sequential seeks). */
function useGrabbedFrames(src: string | null, times: number[], width: number): Record<number, string> {
  const [frames, setFrames] = useState<Record<number, string>>({});
  const key = `${src}|${times.join(",")}|${width}`;
  useEffect(() => {
    if (!src || times.length === 0) {
      setFrames({});
      return;
    }
    const cached: Record<number, string> = {};
    let missing = false;
    for (const t of times) {
      const hit = frameCache.get(`${src}@${t.toFixed(2)}@${width}`);
      if (hit) cached[t] = hit;
      else missing = true;
    }
    setFrames(cached);
    if (!missing) return;
    let alive = true;
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = src;
    const canvas = document.createElement("canvas");
    const run = async () => {
      await new Promise<void>((res, rej) => {
        video.onloadeddata = () => res();
        video.onerror = () => rej(new Error("load"));
      });
      const ratio = video.videoHeight / Math.max(1, video.videoWidth);
      canvas.width = width;
      canvas.height = Math.round(width * ratio);
      const ctx = canvas.getContext("2d");
      for (const t of times) {
        if (!alive || !ctx) return;
        const k = `${src}@${t.toFixed(2)}@${width}`;
        if (frameCache.has(k)) continue;
        await new Promise<void>((res) => {
          const done = () => {
            video.removeEventListener("seeked", done);
            res();
          };
          video.addEventListener("seeked", done);
          video.currentTime = Math.min(Math.max(0, t), Math.max(0, (video.duration || t) - 0.05));
          window.setTimeout(done, 1500);
        });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          const url = canvas.toDataURL("image/jpeg", 0.72);
          frameCache.set(k, url);
          if (alive) setFrames((prev) => ({ ...prev, [t]: url }));
        } catch {
          return;
        }
      }
    };
    run().catch(() => undefined);
    return () => {
      alive = false;
      video.removeAttribute("src");
      video.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return frames;
}

export function VersionPage({
  node,
  model,
  base,
  onClose,
  onMeasure,
  onSwitch,
  onTime,
  seekTo,
}: {
  node: LayoutNode;
  model: RunModel;
  base: string;
  onClose: () => void;
  onMeasure: (id: string, h: number) => void;
  onSwitch: (nodeId: string) => void;
  onTime: (t: number) => void;
  seekTo: { t: number; seq: number } | null;
}) {
  const v = node.version as Version | undefined;
  const ref = usePageHeight(node.id, onMeasure);
  const player = useRef<VideoHandle>(null);
  const [time, setTime] = useState(0);
  const [videoDur, setVideoDur] = useState(0);
  const finalUrl = v ? contentUrl(base, v.final, model.rev) : null;
  const roughUrl = v ? contentUrl(base, v.roughcut, model.rev) : null;
  const pictureUrl = v ? contentUrl(base, v.picture, model.rev) : null;
  const hasFinal = useExists(finalUrl);
  const hasRough = useExists(roughUrl);
  const hasPicture = useExists(hasRough || hasFinal ? null : pictureUrl);
  const [source, setSource] = useState<"auto" | "final" | "roughcut">("auto");
  const which = source === "auto" ? (hasFinal ? "final" : "roughcut") : source;
  // before the mix exists the version plays its VO-only picture (render.mjs)
  const url = which === "final" ? (hasFinal ? finalUrl : null) : hasRough ? roughUrl : hasPicture ? pictureUrl : null;

  const timeline = useMemo(() => (v ? timelineFor(model.texts, v.format, v.lang) : null), [model.texts, v]);
  const qc = (v ? (which === "final" ? v.qcFinal : v.qcRoughcut) : null) as Rec | null;
  const duration = videoDur || (timeline ? timelineDuration(timeline, v?.format, v?.lang) : 0) || Number(qc?.durationS) || 0;

  // Scene frames: the QC record's storyboard, else grabbed from the MP4.
  const scenes: Frame[] = useMemo(() => {
    const board = Array.isArray(qc?.storyboard) ? (qc!.storyboard as Rec[]) : [];
    if (board.length) {
      return board.map((b, i) => ({
        id: String(b.sceneId ?? `s${i + 1}`),
        t: Number(b.t) || 0,
        src: resolveRef(`out/qc/x.json`, b.file as string),
      }));
    }
    if (timeline && timeline.scenes.length) {
      return timeline.scenes.map((s) => ({
        id: s.id,
        t: secondsOf(timeline, s.from + s.len / 2),
        src: null,
        from: secondsOf(timeline, s.from),
        to: secondsOf(timeline, s.from + s.len),
      }));
    }
    if (duration > 0) {
      const n = 6;
      return Array.from({ length: n }, (_, i) => ({ id: `${i + 1}`, t: ((i + 0.5) / n) * duration, src: null }));
    }
    return [];
  }, [qc, timeline, duration]);
  const grab = useGrabbedFrames(
    url,
    scenes.filter((s) => !s.src).map((s) => s.t),
    160,
  );

  const seek = useCallback((t: number) => {
    player.current?.seek(t);
    setTime(t);
    onTime(t);
  }, [onTime]);

  useEffect(() => {
    if (seekTo) seek(seekTo.t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekTo?.seq]);

  if (!v) {
    return (
      <div ref={ref} className="tl-page" style={{ left: node.x, top: node.y, width: node.w }} data-tl-node="">
        <div className="tl-page-head">
          <h2>Version not found</h2>
          <span className="tl-spacer" />
          <button className="tl-btn tl-ghost tl-icon" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
      </div>
    );
  }

  const aspect = versionAspect(v.format);
  const vertical = aspect.startsWith("9");
  const activeScene =
    scenes.find((s) => s.from !== undefined && s.to !== undefined && time >= s.from && time < s.to) ??
    scenes.reduce<Frame | null>((acc, s) => (acc === null || Math.abs(s.t - time) < Math.abs(acc.t - time) ? s : acc), null);
  const finals = model.byId.finals;
  const frameW = vertical ? 50 : 112;

  return (
    <div ref={ref} className="tl-page" style={{ left: node.x, top: node.y, width: node.w }} data-tl-node="">
      <div className="tl-page-head">
        <FilmIcon style={{ width: 16, height: 16, color: "var(--tl-muted)" }} />
        <h2>
          {formatLabel(v.format)} · {langLabel(v.lang)}
        </h2>
        <span className={`tl-chip ${which === "final" && hasFinal ? "tl-st-done" : hasRough ? "tl-st-awaiting" : "tl-st-empty"}`}>
          {which === "final" && hasFinal ? "final" : hasRough ? "rough cut" : hasPicture ? "picture (VO only)" : "not rendered"}
        </span>
        <span className="tl-chip" title={`Finals stage: ${finals.status}${finals.reason ? ` (${finals.reason})` : ""}`}>
          finals · {finals.status}
        </span>
        <span className="tl-spacer" />
        <div className="tl-pills" onPointerDown={(e) => e.stopPropagation()}>
          {(["roughcut", "final"] as const).map((s) => (
            <button
              key={s}
              className={`tl-btn${which === s ? " tl-primary" : ""}`}
              style={{ height: 24, fontSize: 11.5 }}
              disabled={s === "final" ? !hasFinal : !hasRough}
              onClick={() => setSource(s)}
            >
              {s === "final" ? "Final" : "Rough cut"}
            </button>
          ))}
        </div>
        <button className="tl-btn tl-ghost tl-icon" onClick={onClose} title="Close (Esc)">
          <CloseIcon />
        </button>
      </div>
      <div className="tl-tabs" onPointerDown={(e) => e.stopPropagation()}>
        {model.versions.map((x) => (
          <button key={x.nodeId} className={`tl-tab${x.nodeId === v.nodeId ? " tl-on" : ""}`} onClick={() => onSwitch(x.nodeId)}>
            <span className="tl-tab-title">
              {formatLabel(x.format)} · {langLabel(x.lang)}
            </span>
          </button>
        ))}
      </div>
      <div className="tl-page-body" data-tl-scroll="" style={{ maxHeight: 720 }}>
        <div className="tl-h3">Storyboard</div>
        <div className="tl-story" data-tl-scroll="" onPointerDown={(e) => e.stopPropagation()}>
          {scenes.length === 0 ? <span className="tl-note">No scenes yet — the storyboard appears when the rough cut renders.</span> : null}
          {scenes.map((s) => {
            const img = s.src ? contentUrl(base, s.src, model.rev) : grab[s.t];
            return (
              <div key={`${s.id}-${s.t}`} className={`tl-story-frame${activeScene?.id === s.id ? " tl-on" : ""}`} onClick={() => seek(s.t)} title={`${s.id} @ ${s.t.toFixed(1)} s`}>
                <div style={{ width: frameW, aspectRatio: aspect, backgroundImage: img ? `url("${img}")` : undefined }} />
                <span>{s.id}</span>
              </div>
            );
          })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: vertical ? "280px 1fr" : "minmax(0, 1fr) 300px", gap: 16, marginTop: 12 }}>
          <div style={{ minWidth: 0 }}>
            <VideoPlayer
              ref={player}
              src={url}
              aspect={aspect}
              maxHeight={vertical ? 440 : 300}
              onTime={(t) => {
                setTime(t);
                onTime(t);
              }}
              onDuration={setVideoDur}
              emptyText={`${which === "final" ? v.final : v.roughcut} is not rendered yet`}
            />
            {/* the timeline sits under the player: the QC list can be long, the lanes must stay in view */}
            {vertical ? null : (
              <div style={{ marginTop: 12 }}>
                <TimelinePanel timeline={timeline} duration={duration} time={time} onSeek={seek} />
              </div>
            )}
          </div>
          <div data-tl-scroll="" style={{ maxHeight: 560, overflowY: "auto" }}>
            <div className="tl-h3">QC · {which === "final" ? "final" : "rough cut"}</div>
            <QcBlock qc={qc} />
            {activeScene ? (
              <p className="tl-note" style={{ marginTop: 12 }}>
                At <b>{time.toFixed(1)} s</b> · scene <b>{activeScene.id}</b>
              </p>
            ) : null}
            {qc?.notes ? <p className="tl-note">{brand(String(qc.notes))}</p> : null}
          </div>
        </div>
        {vertical ? (
          <div style={{ marginTop: 14 }}>
            <TimelinePanel timeline={timeline} duration={duration} time={time} onSeek={seek} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
