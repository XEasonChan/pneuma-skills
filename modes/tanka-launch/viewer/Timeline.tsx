/**
 * The multi-track timeline of a version, drawn from timeline.json:
 * scenes, VO, BGM, SFX and captions on one clock. The whole panel folds, and
 * each track folds on its own (a thin strip of blocks vs. a lane with text).
 * The playhead follows the player; clicking a lane seeks it.
 */

import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { brand, secondsOf, type Timeline } from "./model.js";
import { ChevronIcon } from "./icons.js";

type TrackKey = "scenes" | "vo" | "bgm" | "sfx" | "captions";
const TRACKS: Array<{ key: TrackKey; label: string }> = [
  { key: "scenes", label: "Scenes" },
  { key: "vo", label: "VO" },
  { key: "bgm", label: "BGM" },
  { key: "sfx", label: "SFX" },
  { key: "captions", label: "Captions" },
];

interface Clip {
  from: number;
  dur: number;
  text: string;
}

export function TimelinePanel({
  timeline,
  duration,
  time,
  onSeek,
}: {
  timeline: Timeline | null;
  duration: number;
  time: number;
  onSeek: (t: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const [folded, setFolded] = useState<Record<TrackKey, boolean>>({ scenes: false, vo: false, bgm: false, sfx: false, captions: true });
  const lanes = useRef<HTMLDivElement>(null);

  const clips = useMemo(() => {
    const out: Record<TrackKey, Clip[]> = { scenes: [], vo: [], bgm: [], sfx: [], captions: [] };
    if (!timeline) return out;
    const s = (v: number) => secondsOf(timeline, v);
    out.scenes = timeline.scenes.map((c) => ({ from: s(c.from), dur: s(c.len), text: c.label ?? c.id }));
    out.vo = timeline.tracks.vo.map((c) => ({ from: s(c.from), dur: s(c.dur), text: c.text ?? c.id ?? "" }));
    out.bgm = timeline.tracks.bgm.map((c) => ({ from: s(c.from), dur: s(c.dur), text: c.label ?? (c.file ? c.file.split("/").pop() ?? "" : "bed") }));
    out.sfx = timeline.tracks.sfx.map((c) => ({ from: s(c.t), dur: 0, text: c.id ?? c.group ?? "" }));
    out.captions = timeline.tracks.captions.map((c) => ({ from: s(c.from), dur: s(c.dur), text: c.text ?? "" }));
    return out;
  }, [timeline]);

  const total = Math.max(duration, 0.001);
  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / total) * 100))}%`;
  const ticks = useMemo(() => {
    const step = total > 90 ? 10 : total > 30 ? 5 : total > 10 ? 2 : 1;
    const out: number[] = [];
    for (let t = 0; t <= total + 1e-6; t += step) out.push(t);
    return out;
  }, [total]);

  const seekFromEvent = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total);
  };

  const counts = TRACKS.map((t) => `${clips[t.key].length} ${t.label.toLowerCase()}`).join(" · ");

  return (
    <div className="tl-tl" onPointerDown={(e) => e.stopPropagation()}>
      <div className={`tl-tl-head${open ? " tl-open" : ""}`} onClick={() => setOpen(!open)}>
        <ChevronIcon />
        <span className="tl-caps">Timeline</span>
        <span className="tl-muted" style={{ fontSize: 11.5 }}>
          {timeline ? `${timeline.fps} fps · ${total.toFixed(1)} s · ${counts}` : "no timeline.json yet — it is written after picture and sound"}
        </span>
      </div>
      {open && timeline ? (
        <div className="tl-tl-body">
          <div className="tl-ruler">
            {ticks.map((t) => (
              <span key={t} style={{ left: pct(t) }}>
                {t}s
              </span>
            ))}
          </div>
          <div ref={lanes} style={{ position: "relative" }}>
            {TRACKS.map((track) => {
              const isOpen = !folded[track.key];
              return (
                <div key={track.key} className={`tl-track${isOpen ? " tl-open" : ""}`}>
                  <div className="tl-track-name" onClick={() => setFolded({ ...folded, [track.key]: isOpen })} title={isOpen ? "Fold track" : "Unfold track"}>
                    <ChevronIcon />
                    {track.label}
                    <span style={{ marginLeft: "auto", fontWeight: 500 }}>{clips[track.key].length || ""}</span>
                  </div>
                  <div className="tl-lane" onPointerDown={seekFromEvent}>
                    {track.key === "sfx"
                      ? clips.sfx.map((c, i) => <span key={i} className="tl-tick" style={{ left: pct(c.from) }} title={`${c.text} @ ${c.from.toFixed(2)} s`} />)
                      : clips[track.key].map((c, i) => (
                          <span
                            key={i}
                            className={`tl-clip tl-k-${track.key}`}
                            style={{ left: pct(c.from), width: `calc(${pct(c.dur)} - 2px)` }}
                            title={`${brand(c.text)} · ${c.from.toFixed(2)}–${(c.from + c.dur).toFixed(2)} s`}
                          >
                            {isOpen ? brand(c.text) : ""}
                          </span>
                        ))}
                    <span className="tl-playhead" style={{ left: pct(time) }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
