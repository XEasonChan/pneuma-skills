/**
 * An infinite canvas: pan, zoom, fit. Written here rather than pulled in —
 * the host ABI shares only React, and a transform on one world layer is all
 * the node graph needs.
 *
 *   drag the background (or hold Space, or middle-drag) — pan
 *   wheel / two-finger scroll — pan;  ⌘/Ctrl + wheel or pinch — zoom at the cursor
 *   Shift+1 — fit;  + / − — zoom;  Esc — handled by the owner
 *
 * A wheel over something that scrolls (`data-tl-scroll`) scrolls it instead.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

import { FitIcon, MinusIcon, PlusIcon } from "./icons.js";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface View {
  x: number;
  y: number;
  k: number;
}
export interface CanvasHandle {
  fit(rect: Rect, opts?: { padding?: number; maxK?: number; animate?: boolean }): void;
  focus(rect: Rect, opts?: { padding?: number; maxK?: number; minK?: number; animate?: boolean; align?: "center" | "top" }): void;
  zoomBy(factor: number): void;
  /** Frame the home rect (the stages around the one the run waits on). */
  home(): void;
  view(): View;
  size(): { w: number; h: number };
}

const MIN_K = 0.12;
const MAX_K = 2;
const clampK = (k: number) => Math.max(MIN_K, Math.min(MAX_K, k));

function canScroll(el: Element, dx: number, dy: number): boolean {
  const h = el as HTMLElement;
  if (dy !== 0 && h.scrollHeight > h.clientHeight + 1) {
    if (dy > 0 && h.scrollTop + h.clientHeight < h.scrollHeight - 1) return true;
    if (dy < 0 && h.scrollTop > 0) return true;
  }
  if (dx !== 0 && h.scrollWidth > h.clientWidth + 1) {
    if (dx > 0 && h.scrollLeft + h.clientWidth < h.scrollWidth - 1) return true;
    if (dx < 0 && h.scrollLeft > 0) return true;
  }
  return false;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export const Canvas = forwardRef<
  CanvasHandle,
  {
    bounds: Rect;
    children: ReactNode;
    overlay?: ReactNode;
    onBackgroundClick?: () => void;
    onEscape?: () => void;
    onViewChange?: (v: View) => void;
    /** Keep the home rect fitted on resize until the user pans or zooms. */
    autoFit?: boolean;
    /** What the first view (and auto-fit) frames; defaults to `bounds`. */
    home?: Rect;
  }
>(function Canvas({ bounds, children, overlay, onBackgroundClick, onEscape, onViewChange, autoFit = false, home }, handle) {
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setViewState] = useState<View>({ x: 40, y: 200, k: 0.6 });
  const viewRef = useRef(view);
  const [animate, setAnimate] = useState(false);
  const [panning, setPanning] = useState(false);
  const animTimer = useRef<number | null>(null);
  const size = useRef({ w: 0, h: 0 });
  const didInitialFit = useRef(false);
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const homeRef = useRef(home ?? bounds);
  homeRef.current = home ?? bounds;
  const space = useRef(false);
  const touched = useRef(false);
  /** What auto-fit keeps framed: the home rect, or the whole run after Fit. */
  const autoTarget = useRef<"home" | "bounds">("home");
  const autoFitRef = useRef(autoFit);
  autoFitRef.current = autoFit;

  const setView = useCallback(
    (next: View, anim = false) => {
      viewRef.current = next;
      if (anim) {
        setAnimate(true);
        if (animTimer.current) window.clearTimeout(animTimer.current);
        animTimer.current = window.setTimeout(() => setAnimate(false), 360);
      } else if (animate) {
        setAnimate(false);
      }
      setViewState(next);
      onViewChange?.(next);
    },
    [animate, onViewChange],
  );

  const fit = useCallback(
    (rect: Rect, opts: { padding?: number; maxK?: number; animate?: boolean } = {}) => {
      const { w, h } = size.current;
      if (!w || !h || rect.w <= 0 || rect.h <= 0) return;
      const pad = opts.padding ?? 48;
      const k = clampK(Math.min((w - pad * 2) / rect.w, (h - pad * 2) / rect.h, opts.maxK ?? 1));
      setView({ k, x: (w - rect.w * k) / 2 - rect.x * k, y: (h - rect.h * k) / 2 - rect.y * k }, opts.animate ?? true);
    },
    [setView],
  );

  const focus = useCallback(
    (rect: Rect, opts: { padding?: number; maxK?: number; minK?: number; animate?: boolean; align?: "center" | "top" } = {}) => {
      const { w, h } = size.current;
      if (!w || !h) return;
      const pad = opts.padding ?? 32;
      const fitK = Math.min((w - pad * 2) / rect.w, (h - pad * 2) / rect.h);
      const k = clampK(Math.max(opts.minK ?? 0, Math.min(fitK, opts.maxK ?? 1)));
      const x = (w - rect.w * k) / 2 - rect.x * k;
      const tooTall = rect.h * k > h - pad * 2;
      const y = opts.align === "top" || tooTall ? pad - rect.y * k : (h - rect.h * k) / 2 - rect.y * k;
      setView({ k, x, y }, opts.animate ?? true);
    },
    [setView],
  );

  const zoomAt = useCallback(
    (cx: number, cy: number, factor: number, anim = false) => {
      const v = viewRef.current;
      const k = clampK(v.k * factor);
      const wx = (cx - v.x) / v.k;
      const wy = (cy - v.y) / v.k;
      setView({ k, x: cx - wx * k, y: cy - wy * k }, anim);
    },
    [setView],
  );

  useImperativeHandle(
    handle,
    () => ({
      fit,
      focus,
      zoomBy: (f: number) => zoomAt(size.current.w / 2, size.current.h / 2, f, true),
      home: () => {
        autoTarget.current = "home";
        fit(homeRef.current, { maxK: 0.95 });
      },
      view: () => viewRef.current,
      size: () => size.current,
    }),
    [fit, focus, zoomAt],
  );

  // Size tracking + the first fit.
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      size.current = { w: r.width, h: r.height };
      if (r.width > 0 && r.height > 0 && boundsRef.current.w > 0) {
        if (!didInitialFit.current || (autoFitRef.current && !touched.current)) {
          didInitialFit.current = true;
          fit(autoTarget.current === "bounds" ? boundsRef.current : homeRef.current, { animate: false, maxK: autoTarget.current === "bounds" ? 0.9 : 0.95 });
        }
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  // Wheel: non-passive so the page never scrolls behind the canvas.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const zoom = e.ctrlKey || e.metaKey;
      const scroller = (e.target as Element | null)?.closest?.("[data-tl-scroll]");
      if (!zoom && scroller && canScroll(scroller, e.deltaX, e.deltaY)) return;
      e.preventDefault();
      touched.current = true;
      const r = el.getBoundingClientRect();
      if (zoom) {
        const speed = e.ctrlKey && !e.metaKey ? 0.012 : 0.0025;
        zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * speed));
      } else {
        const v = viewRef.current;
        const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY;
        setView({ ...v, x: v.x - dx, y: v.y - dy });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setView, zoomAt]);

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const el = viewport.current;
      if (!el || !el.isConnected) return;
      if (e.code === "Space" && e.type === "keydown") space.current = true;
      if (e.code === "Space" && e.type === "keyup") space.current = false;
      if (e.type !== "keydown") return;
      if (e.key === "Escape") onEscape?.();
      else if (e.shiftKey && (e.key === "!" || e.code === "Digit1")) {
        touched.current = false;
        autoTarget.current = "bounds";
        fit(boundsRef.current, { maxK: 0.9 });
      }
      else if ((e.key === "=" || e.key === "+") && !e.metaKey && !e.ctrlKey) zoomAt(size.current.w / 2, size.current.h / 2, 1.2, true);
      else if (e.key === "-" && !e.metaKey && !e.ctrlKey) zoomAt(size.current.w / 2, size.current.h / 2, 1 / 1.2, true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [fit, zoomAt, onEscape]);

  // Pointer panning.
  const drag = useRef<{ id: number; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);
  const onPointerDown = (e: ReactPointerEvent) => {
    const target = e.target as Element;
    const onNode = !!target.closest("[data-tl-node], button, a, input, textarea, video, audio, [data-tl-scroll] *");
    if (e.button === 1 || space.current || (!onNode && e.button === 0)) {
      drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y, moved: false };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) > 3) {
      d.moved = true;
      touched.current = true;
      setPanning(true);
    }
    if (d.moved) setView({ ...viewRef.current, x: d.vx + dx, y: d.vy + dy });
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setPanning(false);
    if (!d.moved) onBackgroundClick?.();
  };

  const grid = 24 * view.k;
  return (
    <div
      ref={viewport}
      className={`tl-canvas${panning ? " tl-panning" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className="tl-grid"
        style={{ backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
      />
      <div
        className={`tl-world${animate ? " tl-animate" : ""}`}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
      >
        {children}
      </div>
      {overlay}
      <div className="tl-zoom" onPointerDown={(e) => e.stopPropagation()}>
        <button className="tl-btn tl-ghost tl-icon" title="Zoom out (−)" onClick={() => (touched.current = true) && zoomAt(size.current.w / 2, size.current.h / 2, 1 / 1.25, true)}>
          <MinusIcon />
        </button>
        <span className="tl-pct">{Math.round(view.k * 100)}%</span>
        <button className="tl-btn tl-ghost tl-icon" title="Zoom in (+)" onClick={() => (touched.current = true) && zoomAt(size.current.w / 2, size.current.h / 2, 1.25, true)}>
          <PlusIcon />
        </button>
        <button
          className="tl-btn tl-ghost tl-icon"
          title="Fit to screen (Shift+1)"
          onClick={() => {
            touched.current = false;
            autoTarget.current = "bounds";
            fit(boundsRef.current, { maxK: 0.9 });
          }}
        >
          <FitIcon />
        </button>
      </div>
    </div>
  );
});
