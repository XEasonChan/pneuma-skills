/**
 * Small shared pieces: status and countdown chips, the audio and video
 * players (custom controls — no native chrome), and two hooks.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";

import { formatCountdown } from "../skill/scripts/lib/stage-state.mjs";
import { formatSeconds, type Status } from "./model.js";
import { CheckIcon, ClockIcon, LockIcon, PauseIcon, PlayIcon } from "./icons.js";

// ── Hooks ───────────────────────────────────────────────────────────────────

/** The current time, re-rendered every `ms` while `enabled`. */
export function useNow(ms: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms, enabled]);
  return now;
}

const existsCache = new Map<string, boolean>();

/**
 * Whether a workspace file is served — a HEAD on `/content/…`. Media is not
 * watched, so this is how a version node knows its MP4 exists. `url` carries
 * the film revision, so a new render is probed again.
 */
export function useExists(url: string | null): boolean | null {
  const [state, setState] = useState<boolean | null>(() => (url ? existsCache.get(url) ?? null : false));
  useEffect(() => {
    if (!url) {
      setState(false);
      return;
    }
    if (existsCache.has(url)) {
      setState(existsCache.get(url)!);
      return;
    }
    let alive = true;
    setState(null);
    fetch(url, { method: "HEAD" })
      .then((r) => {
        existsCache.set(url, r.ok);
        if (alive) setState(r.ok);
      })
      .catch(() => {
        if (alive) setState(false);
      });
    return () => {
      alive = false;
    };
  }, [url]);
  return state;
}

// ── Chips ───────────────────────────────────────────────────────────────────

const STATUS_TEXT: Record<Status, string> = {
  locked: "locked",
  empty: "not started",
  working: "working",
  awaiting: "awaiting",
  confirmed: "confirmed",
  changed: "changed",
  stale: "stale",
  done: "done",
};

export function StatusChip({ status, title }: { status: Status; title?: string }) {
  return (
    <span className={`tl-chip tl-st-${status}`} title={title}>
      {status === "locked" ? <LockIcon /> : status === "confirmed" || status === "done" ? <CheckIcon /> : <i className="tl-dot" />}
      {STATUS_TEXT[status]}
    </span>
  );
}

/** Time left on a stage's countdown; ticks every second. */
export function CountdownChip({ deadlineMs, prefix }: { deadlineMs: number; prefix?: string }) {
  const now = useNow(1000);
  const left = deadlineMs - now;
  const urgent = left < 5 * 60_000;
  return (
    <span className={`tl-chip tl-countdown${urgent ? " tl-urgent" : ""}`} title={`Auto-picks the recommended option at ${new Date(deadlineMs).toLocaleTimeString()}`}>
      <ClockIcon />
      {prefix ? `${prefix} ` : ""}
      {left > 0 ? formatCountdown(left) : "due"}
    </span>
  );
}

// ── Audio ───────────────────────────────────────────────────────────────────

const PLAY_EVENT = "tl-media-play";

function announcePlay(el: HTMLMediaElement) {
  window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: el }));
}

function useExclusive(ref: RefObject<HTMLMediaElement | null>) {
  useEffect(() => {
    const onOther = (e: Event) => {
      const el = ref.current;
      if (el && (e as CustomEvent).detail !== el && !el.paused) el.pause();
    };
    window.addEventListener(PLAY_EVENT, onOther);
    return () => window.removeEventListener(PLAY_EVENT, onOther);
  }, [ref]);
}

function Scrub({ value, max, onSeek }: { value: number; max: number; onSeek: (t: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const seekAt = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || max <= 0) return;
    onSeek(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * max);
  };
  return (
    <div
      ref={ref}
      className="tl-scrub"
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        seekAt(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) seekAt(e.clientX);
      }}
    >
      <i style={{ width: `${pct}%` }} />
      <b style={{ left: `${pct}%` }} />
    </div>
  );
}

export function AudioPlayer({ src, label, sub }: { src: string | null; label: string; sub?: ReactNode }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [error, setError] = useState(false);
  useExclusive(ref);

  useEffect(() => {
    setError(false);
    setT(0);
    setDur(0);
    setPlaying(false);
  }, [src]);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      announcePlay(el);
      el.play().catch(() => setError(true));
    } else el.pause();
  };

  return (
    <div className="tl-audio" onPointerDown={(e) => e.stopPropagation()}>
      <button className="tl-play" onClick={toggle} disabled={!src || error} aria-label={playing ? "Pause" : "Play"}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="tl-audio-main">
        <div className="tl-audio-top">
          <span title={label}>{label}</span>
          <span>{error || !src ? "—" : `${formatSeconds(t)} / ${formatSeconds(dur)}`}</span>
        </div>
        {error || !src ? (
          <div className="tl-audio-err">{src ? "Not rendered yet" : "No file"}</div>
        ) : (
          <Scrub
            value={t}
            max={dur}
            onSeek={(s) => {
              if (ref.current) ref.current.currentTime = s;
            }}
          />
        )}
        {sub ? <div className="tl-audio-err">{sub}</div> : null}
      </div>
      {src ? (
        <audio
          ref={ref}
          src={src}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
          onError={() => setError(true)}
        />
      ) : null}
    </div>
  );
}

// ── Video ───────────────────────────────────────────────────────────────────

export interface VideoHandle {
  seek(t: number): void;
  play(): void;
  pause(): void;
  getTime(): number;
  element(): HTMLVideoElement | null;
}

export const VideoPlayer = forwardRef<
  VideoHandle,
  {
    src: string | null;
    aspect: string;
    maxHeight?: number;
    onTime?: (t: number) => void;
    onDuration?: (d: number) => void;
    emptyText?: string;
    style?: CSSProperties;
  }
>(function VideoPlayer({ src, aspect, maxHeight, onTime, onDuration, emptyText, style }, handle) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [error, setError] = useState(false);
  const raf = useRef<number | null>(null);
  useExclusive(ref);

  useEffect(() => {
    setError(false);
    setT(0);
    setPlaying(false);
  }, [src]);

  // A playhead that moves every frame while playing (timeupdate is ~4 Hz).
  const loop = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setT(el.currentTime);
    onTime?.(el.currentTime);
    raf.current = requestAnimationFrame(loop);
  }, [onTime]);
  useEffect(() => {
    if (playing) raf.current = requestAnimationFrame(loop);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [playing, loop]);

  useImperativeHandle(
    handle,
    () => ({
      seek(s: number) {
        const el = ref.current;
        if (!el) return;
        el.currentTime = Math.max(0, s);
        setT(el.currentTime);
        onTime?.(el.currentTime);
      },
      play() {
        const el = ref.current;
        if (el) {
          announcePlay(el);
          el.play().catch(() => undefined);
        }
      },
      pause() {
        ref.current?.pause();
      },
      getTime() {
        return ref.current?.currentTime ?? 0;
      },
      element() {
        return ref.current;
      },
    }),
    [onTime],
  );

  const toggle = () => {
    const el = ref.current;
    if (!el || error) return;
    if (el.paused) {
      announcePlay(el);
      el.play().catch(() => setError(true));
    } else el.pause();
  };

  return (
    <div style={style} onPointerDown={(e) => e.stopPropagation()}>
      <div className="tl-video" style={{ aspectRatio: aspect, maxHeight, margin: "0 auto" }}>
        {src && !error ? (
          <video
            ref={ref}
            src={src}
            preload="metadata"
            playsInline
            onClick={toggle}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onTimeUpdate={(e) => {
              if (!playing) {
                setT(e.currentTarget.currentTime);
                onTime?.(e.currentTarget.currentTime);
              }
            }}
            onLoadedMetadata={(e) => {
              setDur(e.currentTarget.duration || 0);
              onDuration?.(e.currentTarget.duration || 0);
            }}
            onError={() => setError(true)}
          />
        ) : (
          <div className="tl-video-empty">{emptyText ?? "Not rendered yet"}</div>
        )}
      </div>
      <div className="tl-video-bar">
        <button className="tl-btn tl-icon" onClick={toggle} disabled={!src || error} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <Scrub
          value={t}
          max={dur}
          onSeek={(s) => {
            if (ref.current) {
              ref.current.currentTime = s;
              setT(s);
              onTime?.(s);
            }
          }}
        />
        <span className="tl-mono tl-muted">
          {formatSeconds(t)} / {formatSeconds(dur)}
        </span>
      </div>
    </div>
  );
});

/** A poster frame of a video for node thumbnails: ~48 % in for a film (the product on screen, not the half-typed first line), 0.8 s
 *  for a short clip. */
export function VideoPoster({ src, aspect, height, empty }: { src: string | null; aspect: string; height?: number; empty?: string }) {
  const exists = useExists(src);
  return (
    <div className="tl-poster" style={height ? { aspectRatio: aspect, height } : { aspectRatio: aspect, width: "100%" }}>
      {src && exists ? (
        <video src={`${src}#t=0.8`} preload="metadata" muted playsInline
          onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.duration > 6) v.currentTime = v.duration * 0.48; }} />
      ) : (
        <div className="tl-poster-empty">{exists === null ? "…" : empty ?? "Not rendered yet"}</div>
      )}
    </div>
  );
}

/** A tiny BPM-over-time sparkline for node cards. */
export function BpmSpark({ points }: { points: Array<{ from: number; to: number; bpm: number }> }) {
  if (points.length === 0) return null;
  const end = Math.max(...points.map((p) => p.to));
  const lo = Math.min(...points.map((p) => p.bpm)) - 6;
  const hi = Math.max(...points.map((p) => p.bpm)) + 6;
  const x = (s: number) => (end > 0 ? (s / end) * 100 : 0);
  const y = (b: number) => 30 - ((b - lo) / Math.max(1, hi - lo)) * 26;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.from).toFixed(2)},${y(p.bpm).toFixed(2)} L${x(p.to).toFixed(2)},${y(p.bpm).toFixed(2)}`).join(" ");
  return (
    <svg className="tl-spark" viewBox="0 0 100 34" preserveAspectRatio="none">
      <path d={d} fill="none" stroke="var(--tl-primary)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Info/animation density as two small bars (0–5). */
export function Density({ value }: { value: number }) {
  const v = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span className="tl-dens" title={`${v}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={i <= v ? "tl-on" : ""} />
      ))}
    </span>
  );
}
