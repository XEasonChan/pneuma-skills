/**
 * The viewer's stylesheet, injected once.
 *
 * An external mode bundle cannot rely on the host's Tailwind build (classes
 * only exist if the host's own sources used them), so the canvas carries its
 * own CSS. Colours come from the shell's `--color-cc-*` tokens so it follows
 * Pneuma's light and dark themes; the few canvas-specific surfaces switch
 * with the same class the shell flips on its session root (`.cc-theme-light`),
 * so the canvas can never disagree with the chrome around it.
 */

export const STYLE_ID = "tanka-launch-styles";

export const CSS = String.raw`
.tl-root {
  --tl-bg: var(--color-cc-bg, #09090b);
  --tl-fg: var(--color-cc-fg, #fafafa);
  --tl-muted: var(--color-cc-muted, #a1a1aa);
  --tl-border: var(--color-cc-border, #ffffff14);
  --tl-hover: var(--color-cc-hover, #ffffff0d);
  --tl-primary: var(--color-cc-primary, #f97316);
  --tl-primary-soft: var(--color-cc-primary-muted, #f9731626);
  --tl-success: var(--color-cc-success, #4ade80);
  --tl-warning: var(--color-cc-warning, #facc15);
  --tl-error: var(--color-cc-error, #f87171);
  --tl-info: #60a5fa;
  --tl-stale: #a78bfa;
  --tl-card: #131316;
  --tl-card-2: #1b1b20;
  --tl-card-3: #232329;
  --tl-grid: #ffffff12;
  --tl-edge: #ffffff26;
  --tl-shadow: 0 1px 0 #ffffff08 inset, 0 8px 24px -12px #000000cc;
  --tl-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--tl-bg);
  color: var(--tl-fg);
  font-size: 13px;
  line-height: 1.45;
  font-feature-settings: "tnum" 1;
  -webkit-font-smoothing: antialiased;
}
.cc-theme-light .tl-root {
  --tl-card: #ffffff;
  --tl-card-2: #f6f4f1;
  --tl-card-3: #ece9e4;
  --tl-grid: #8c786433;
  --tl-edge: #8c786459;
  --tl-info: #2563eb;
  --tl-stale: #7c3aed;
  --tl-shadow: 0 1px 2px #1c140a14, 0 10px 28px -16px #1c140a40;
}
.tl-root *, .tl-root *::before, .tl-root *::after { box-sizing: border-box; }
.tl-root button { font: inherit; color: inherit; }
.tl-caps { text-transform: uppercase; letter-spacing: .08em; font-size: 10.5px; font-weight: 600; }
.tl-muted { color: var(--tl-muted); }
.tl-mono { font-family: var(--tl-mono); font-size: 11.5px; }

/* ── Buttons ─────────────────────────────────────────────────────────── */
.tl-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 28px; padding: 0 11px; border-radius: 7px;
  border: 1px solid var(--tl-border); background: var(--tl-card-2);
  cursor: pointer; white-space: nowrap; font-size: 12.5px; font-weight: 500;
  transition: background .12s, border-color .12s, opacity .12s;
}
.tl-btn:hover:not(:disabled) { background: var(--tl-card-3); }
.tl-btn:disabled { opacity: .45; cursor: not-allowed; }
.tl-btn.tl-primary { background: var(--tl-primary); border-color: transparent; color: #fff; }
.tl-btn.tl-primary:hover:not(:disabled) { filter: brightness(1.08); background: var(--tl-primary); }
.tl-btn.tl-ghost { background: transparent; border-color: transparent; }
.tl-btn.tl-ghost:hover:not(:disabled) { background: var(--tl-hover); }
.tl-btn.tl-icon { width: 28px; padding: 0; justify-content: center; }
.tl-btn svg { width: 14px; height: 14px; flex: none; }

/* ── Chips ───────────────────────────────────────────────────────────── */
.tl-chip {
  display: inline-flex; align-items: center; gap: 5px;
  height: 20px; padding: 0 7px; border-radius: 999px;
  font-size: 11px; font-weight: 550; white-space: nowrap;
  border: 1px solid transparent; background: var(--tl-card-3); color: var(--tl-muted);
}
.tl-chip svg { width: 11px; height: 11px; }
.tl-chip .tl-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.tl-st-locked { color: var(--tl-muted); background: transparent; border-color: var(--tl-border); }
.tl-st-empty { color: var(--tl-muted); background: transparent; border-color: var(--tl-border); border-style: dashed; }
.tl-st-working { color: var(--tl-info); background: color-mix(in oklab, var(--tl-info) 14%, transparent); }
.tl-st-awaiting { color: var(--tl-warning); background: color-mix(in oklab, var(--tl-warning) 15%, transparent); }
.tl-st-confirmed, .tl-st-done { color: var(--tl-success); background: color-mix(in oklab, var(--tl-success) 14%, transparent); }
.tl-st-changed { color: var(--tl-error); background: color-mix(in oklab, var(--tl-error) 14%, transparent); }
.tl-st-stale { color: var(--tl-stale); background: color-mix(in oklab, var(--tl-stale) 14%, transparent); }
.cc-theme-light .tl-root .tl-st-awaiting { color: #a16207; }
.cc-theme-light .tl-root .tl-st-confirmed, .cc-theme-light .tl-root .tl-st-done { color: #15803d; }
.tl-chip.tl-countdown { font-family: var(--tl-mono); font-size: 11px; color: var(--tl-warning); background: color-mix(in oklab, var(--tl-warning) 12%, transparent); border-color: color-mix(in oklab, var(--tl-warning) 30%, transparent); }
.cc-theme-light .tl-root .tl-chip.tl-countdown { color: #a16207; }
.tl-chip.tl-countdown.tl-urgent { color: var(--tl-error); background: color-mix(in oklab, var(--tl-error) 12%, transparent); border-color: color-mix(in oklab, var(--tl-error) 30%, transparent); }
.tl-chip.tl-rec { color: var(--tl-primary); background: var(--tl-primary-soft); }
.tl-chip.tl-pending { color: var(--tl-info); background: color-mix(in oklab, var(--tl-info) 12%, transparent); }
.tl-chip.tl-gate { color: var(--tl-primary); background: transparent; border-color: color-mix(in oklab, var(--tl-primary) 45%, transparent); }

/* ── Top bar ─────────────────────────────────────────────────────────── */
.tl-top { flex: none; border-bottom: 1px solid var(--tl-border); background: var(--tl-bg); position: relative; z-index: 5; }
.tl-top-row { display: flex; align-items: center; gap: 12px; padding: 8px 12px 6px; min-width: 0; }
.tl-title { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex: 1; }
.tl-title h1 { margin: 0; font-size: 14px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tl-title .tl-runid { font-family: var(--tl-mono); font-size: 11px; color: var(--tl-muted); white-space: nowrap; }
.tl-mark { font-weight: 800; letter-spacing: .12em; font-size: 11px; color: var(--tl-primary); flex: none; }
.tl-budget { display: flex; flex-direction: column; gap: 3px; width: 150px; flex: none; }
.tl-budget-label { display: flex; justify-content: space-between; font-size: 11px; color: var(--tl-muted); }
.tl-budget-label b { color: var(--tl-fg); font-weight: 600; }
.tl-meter { height: 4px; border-radius: 3px; background: var(--tl-card-3); overflow: hidden; }
.tl-meter > i { display: block; height: 100%; border-radius: 3px; background: var(--tl-success); transition: width .3s; }
.tl-meter.tl-warn > i { background: var(--tl-warning); }
.tl-meter.tl-over > i { background: var(--tl-error); }
.tl-rail { display: flex; gap: 3px; padding: 0 12px 8px; overflow-x: auto; scrollbar-width: none; }
.tl-rail::-webkit-scrollbar { display: none; }
.tl-rail-item {
  flex: 1 1 0; min-width: 58px; display: flex; flex-direction: column; gap: 4px;
  padding: 5px 7px 6px; border-radius: 7px; border: 1px solid transparent; background: transparent;
  cursor: pointer; text-align: left;
}
.tl-rail-item:hover { background: var(--tl-hover); }
.tl-rail-item.tl-on { background: var(--tl-card-2); border-color: var(--tl-border); }
.tl-rail-bar { height: 3px; border-radius: 2px; background: var(--tl-card-3); }
.tl-rail-item[data-status="confirmed"] .tl-rail-bar, .tl-rail-item[data-status="done"] .tl-rail-bar { background: var(--tl-success); }
.tl-rail-item[data-status="awaiting"] .tl-rail-bar { background: var(--tl-warning); }
.tl-rail-item[data-status="working"] .tl-rail-bar { background: var(--tl-info); animation: tl-pulse 1.6s ease-in-out infinite; }
.tl-rail-item[data-status="changed"] .tl-rail-bar { background: var(--tl-error); }
.tl-rail-item[data-status="stale"] .tl-rail-bar { background: repeating-linear-gradient(90deg, var(--tl-stale) 0 4px, transparent 4px 7px); }
.tl-rail-item[data-gate="true"] .tl-rail-label { color: var(--tl-primary); }
.tl-rail-label { display: flex; justify-content: space-between; gap: 4px; font-size: 11px; font-weight: 550; white-space: nowrap; overflow: hidden; }
.tl-rail-label span:first-child { overflow: hidden; text-overflow: ellipsis; }
.tl-rail-sub { font-size: 10px; color: var(--tl-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: var(--tl-mono); }
@keyframes tl-pulse { 50% { opacity: .45; } }

/* ── Canvas ──────────────────────────────────────────────────────────── */
.tl-canvas { position: relative; flex: 1; min-height: 0; overflow: hidden; cursor: default; touch-action: none; }
.tl-canvas.tl-panning { cursor: grabbing; }
.tl-grid { position: absolute; inset: 0; pointer-events: none; background-image: radial-gradient(circle, var(--tl-grid) 1px, transparent 1.2px); }
.tl-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
.tl-world.tl-animate { transition: transform .32s cubic-bezier(.2,.8,.2,1); }
.tl-edges { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.tl-edge { fill: none; stroke: var(--tl-edge); stroke-width: 1.5; }
.tl-edge.tl-dim { opacity: .55; }
.tl-edge.tl-lit { stroke: var(--tl-primary); stroke-width: 2.25; }
.tl-edge.tl-ghost { stroke-dasharray: 4 5; opacity: .6; }
.tl-edge.tl-stale { stroke: var(--tl-stale); stroke-width: 2; stroke-dasharray: 6 5; }
.tl-colhead { position: absolute; display: flex; align-items: center; gap: 7px; height: 26px; padding: 0 2px; cursor: pointer; white-space: nowrap; }
.tl-colhead .tl-n { font-family: var(--tl-mono); font-size: 11px; color: var(--tl-muted); }
.tl-colhead .tl-lbl { font-size: 12.5px; font-weight: 650; }
.tl-colhead:hover .tl-lbl { color: var(--tl-primary); }

/* Nodes */
.tl-node {
  position: absolute; display: flex; flex-direction: column;
  border-radius: 12px; background: var(--tl-card); border: 1px solid var(--tl-border);
  box-shadow: var(--tl-shadow); cursor: pointer; overflow: hidden;
  transition: border-color .15s, box-shadow .15s, opacity .15s;
}
.tl-node:hover { border-color: color-mix(in oklab, var(--tl-fg) 22%, transparent); }
.tl-node.tl-picked { border-color: var(--tl-primary); box-shadow: 0 0 0 1px var(--tl-primary), var(--tl-shadow); }
.tl-node.tl-unpicked { opacity: .62; }
.tl-node.tl-unpicked:hover { opacity: .9; }
.tl-node.tl-selected { box-shadow: 0 0 0 2px color-mix(in oklab, var(--tl-primary) 55%, transparent), var(--tl-shadow); }
.tl-node.tl-placeholder { background: transparent; border-style: dashed; box-shadow: none; cursor: default; color: var(--tl-muted); }
.tl-node.tl-placeholder:hover { border-color: var(--tl-border); }
.tl-node-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px 0; min-height: 26px; }
.tl-node-kind { white-space: nowrap; display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--tl-muted); }
.tl-node-kind svg { width: 12px; height: 12px; }
.tl-node-id { font-family: var(--tl-mono); font-size: 11px; font-weight: 600; padding: 0 5px; border-radius: 4px; background: var(--tl-card-3); color: var(--tl-fg); }
.tl-node-head .tl-spacer { flex: 1; }
.tl-node-body { padding: 6px 10px 10px; display: flex; flex-direction: column; gap: 6px; min-height: 0; flex: 1; }
.tl-node-title { flex-shrink: 0; font-size: 13px; font-weight: 620; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.tl-node-sum { flex-shrink: 0; font-size: 12px; color: var(--tl-muted); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.tl-node-meta { margin-top: auto; display: flex; flex-wrap: wrap; row-gap: 4px; gap: 5px; align-items: center; font-size: 11px; color: var(--tl-muted); }
.tl-port { position: absolute; top: 50%; width: 9px; height: 9px; margin-top: -4.5px; border-radius: 50%; background: var(--tl-card); border: 2px solid var(--tl-edge); }
.tl-port.tl-in { left: -5px; }
.tl-port.tl-out { right: -5px; }
.tl-node.tl-picked .tl-port { border-color: var(--tl-primary); }
.tl-thumb-row { display: flex; gap: 4px; }
.tl-thumb-row > div { flex: 1; aspect-ratio: 16/10; border-radius: 5px; background: var(--tl-card-3) center/cover no-repeat; }
.tl-poster { position: relative; border-radius: 7px; overflow: hidden; background: var(--tl-card-3); flex: none; }
.tl-poster video, .tl-poster img { display: block; width: 100%; height: 100%; object-fit: cover; }
.tl-poster .tl-poster-empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--tl-muted); font-size: 11px; }
.tl-spark { display: block; width: 100%; height: 34px; }

/* Expanded pages on the canvas */
.tl-page {
  position: absolute; display: flex; flex-direction: column;
  border-radius: 14px; background: var(--tl-card); border: 1px solid var(--tl-border);
  box-shadow: 0 0 0 1px color-mix(in oklab, var(--tl-primary) 30%, transparent), var(--tl-shadow);
  cursor: default; overflow: hidden;
}
.tl-page-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px 10px; border-bottom: 1px solid var(--tl-border); }
.tl-page-head h2 { margin: 0; font-size: 15px; font-weight: 680; }
.tl-page-head .tl-n { font-family: var(--tl-mono); color: var(--tl-muted); font-size: 12px; }
.tl-page-head .tl-spacer { flex: 1; }
.tl-voice { display: flex; gap: 12px; align-items: center; padding: 6px 8px; border: 1px solid var(--tl-border); border-radius: 10px; }
.tl-voice.tl-on { border-color: var(--tl-primary); background: var(--tl-primary-soft); }
.tl-tabs { display: flex; gap: 6px; padding: 10px 14px 0; flex-wrap: wrap; }
.tl-tab {
  display: flex; align-items: center; gap: 7px; padding: 7px 10px; border-radius: 9px;
  border: 1px solid var(--tl-border); background: var(--tl-card-2); cursor: pointer; max-width: 260px; text-align: left;
}
.tl-tab:hover { background: var(--tl-card-3); }
.tl-tab.tl-on { border-color: var(--tl-primary); background: var(--tl-primary-soft); }
.tl-tab .tl-node-id { flex: none; }
.tl-tab-title { font-size: 12.5px; font-weight: 580; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tl-page-body { padding: 12px 14px 14px; overflow: auto; min-height: 0; flex: 1; }
.tl-page-foot { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--tl-border); background: var(--tl-card-2); flex-wrap: wrap; }
.tl-page-foot .tl-spacer { flex: 1; }
.tl-note { font-size: 12px; color: var(--tl-muted); }
.tl-note b { color: var(--tl-fg); font-weight: 600; }
.tl-lead { font-size: 13px; color: var(--tl-muted); margin: 0 0 10px; max-width: 70ch; }
.tl-h3 { margin: 14px 0 8px; font-size: 11px; font-weight: 650; letter-spacing: .07em; text-transform: uppercase; color: var(--tl-muted); }
.tl-h3:first-child { margin-top: 0; }
.tl-more { display: flex; gap: 8px; align-items: flex-start; width: 100%; }
.tl-more textarea {
  flex: 1; min-height: 56px; resize: vertical; padding: 8px 10px; border-radius: 8px;
  border: 1px solid var(--tl-border); background: var(--tl-card); color: var(--tl-fg); font: inherit; font-size: 12.5px; outline: none;
}
.tl-more textarea:focus { border-color: var(--tl-primary); }

/* Tables (script) */
.tl-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12.5px; }
.tl-table th { text-align: left; font-weight: 600; font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--tl-muted); padding: 6px 8px; border-bottom: 1px solid var(--tl-border); position: sticky; top: -12px; background: var(--tl-card); }
.tl-table td { vertical-align: top; padding: 8px; border-bottom: 1px solid var(--tl-border); }
.tl-table tr:last-child td { border-bottom: 0; }
.tl-table .tl-sid { font-family: var(--tl-mono); font-size: 11px; color: var(--tl-muted); white-space: nowrap; }
.tl-table .tl-ja { font-size: 12.5px; }
.tl-table .tl-en { color: var(--tl-muted); font-size: 12px; margin-top: 3px; }
.tl-table .tl-ost { font-weight: 600; }
.tl-dens { display: inline-flex; gap: 2px; }
.tl-dens i { width: 5px; height: 10px; border-radius: 1.5px; background: var(--tl-card-3); }
.tl-dens i.tl-on { background: var(--tl-primary); }

/* Players */
.tl-audio { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border-radius: 9px; background: var(--tl-card-2); border: 1px solid var(--tl-border); min-width: 0; }
.tl-audio .tl-play { width: 28px; height: 28px; border-radius: 50%; border: 0; background: var(--tl-fg); color: var(--tl-bg); display: grid; place-items: center; cursor: pointer; flex: none; }
.tl-audio .tl-play svg { width: 12px; height: 12px; }
.tl-audio .tl-play:disabled { opacity: .35; cursor: not-allowed; }
.tl-audio-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.tl-audio-top { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; }
.tl-audio-top span:first-child { font-weight: 580; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tl-audio-top span:last-child { font-family: var(--tl-mono); font-size: 11px; color: var(--tl-muted); flex: none; }
.tl-scrub { position: relative; height: 16px; cursor: pointer; }
.tl-scrub::before { content: ""; position: absolute; left: 0; right: 0; top: 7px; height: 2px; border-radius: 2px; background: var(--tl-card-3); }
.tl-scrub > i { position: absolute; left: 0; top: 7px; height: 2px; border-radius: 2px; background: var(--tl-primary); }
.tl-scrub > b { position: absolute; top: 4px; width: 8px; height: 8px; margin-left: -4px; border-radius: 50%; background: var(--tl-primary); }
.tl-audio-err { font-size: 11px; color: var(--tl-muted); }
.tl-grid2 { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 8px; }
.tl-video { position: relative; background: #000; border-radius: 10px; overflow: hidden; }
.tl-video video { display: block; width: 100%; height: 100%; object-fit: contain; background: #000; }
.tl-video-bar { display: flex; align-items: center; gap: 10px; padding: 8px 2px 0; }
.tl-video-bar .tl-scrub { flex: 1; }
.tl-video-empty { display: grid; place-items: center; text-align: center; color: #a1a1aa; font-size: 12px; padding: 16px; position: absolute; inset: 0; }

/* BPM graph */
.tl-bpm { width: 100%; height: 150px; display: block; }
.tl-bpm .tl-bpm-line { fill: none; stroke: var(--tl-primary); stroke-width: 2; }
.tl-bpm .tl-bpm-fill { fill: var(--tl-primary-soft); }
.tl-bpm .tl-bpm-axis { stroke: var(--tl-border); stroke-width: 1; }
.tl-bpm text { fill: var(--tl-muted); font-size: 10px; font-family: var(--tl-mono); }
.tl-bpm .tl-bpm-scene { stroke: var(--tl-border); stroke-dasharray: 2 3; }

/* Kv blocks */
.tl-kv { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; font-size: 12.5px; }
.tl-kv dt { color: var(--tl-muted); }
.tl-kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.tl-pills { display: flex; flex-wrap: wrap; gap: 5px; }
.tl-pill { padding: 2px 8px; border-radius: 999px; background: var(--tl-card-3); font-size: 12px; }
.tl-idea { font-size: 17px; line-height: 1.45; font-weight: 560; margin: 0 0 14px; max-width: 60ch; }

/* Assets */
.tl-assets { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.tl-asset { display: flex; flex-direction: column; gap: 5px; }
.tl-asset-img { aspect-ratio: 16/10; border-radius: 8px; background: var(--tl-card-3) center/cover no-repeat; border: 1px solid var(--tl-border); display: grid; place-items: center; color: var(--tl-muted); font-size: 11px; overflow: hidden; }
.tl-asset-img video { width: 100%; height: 100%; object-fit: cover; }
.tl-asset-cap { font-size: 11.5px; display: flex; gap: 5px; align-items: center; min-width: 0; }
.tl-asset-cap span:last-child { color: var(--tl-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Version page */
.tl-story { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
.tl-story-frame { flex: none; display: flex; flex-direction: column; gap: 4px; cursor: pointer; }
.tl-story-frame > div { border-radius: 6px; background: var(--tl-card-3) center/cover no-repeat; border: 1px solid var(--tl-border); }
.tl-story-frame.tl-on > div { border-color: var(--tl-primary); box-shadow: 0 0 0 1px var(--tl-primary); }
.tl-story-frame span { font-family: var(--tl-mono); font-size: 10.5px; color: var(--tl-muted); }
.tl-vsplit { display: grid; gap: 14px; }

/* Timeline */
.tl-tl { border: 1px solid var(--tl-border); border-radius: 10px; overflow: hidden; background: var(--tl-card-2); }
.tl-tl-head { display: flex; align-items: center; gap: 8px; padding: 7px 10px; cursor: pointer; user-select: none; }
.tl-tl-head svg { width: 12px; height: 12px; transition: transform .15s; }
.tl-tl-head.tl-open svg { transform: rotate(90deg); }
.tl-tl-body { position: relative; border-top: 1px solid var(--tl-border); }
.tl-track { display: grid; grid-template-columns: 92px 1fr; border-bottom: 1px solid var(--tl-border); }
.tl-track:last-child { border-bottom: 0; }
.tl-track-name { display: flex; align-items: center; gap: 5px; padding: 0 8px; font-size: 11px; font-weight: 600; color: var(--tl-muted); cursor: pointer; user-select: none; border-right: 1px solid var(--tl-border); }
.tl-track-name svg { width: 10px; height: 10px; transition: transform .15s; }
.tl-track.tl-open .tl-track-name svg { transform: rotate(90deg); }
.tl-lane { position: relative; height: 22px; cursor: pointer; }
.tl-track.tl-open .tl-lane { height: 40px; }
.tl-clip { position: absolute; top: 3px; bottom: 3px; border-radius: 4px; padding: 0 5px; font-size: 10.5px; line-height: 16px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--tl-fg); }
.tl-track.tl-open .tl-clip { line-height: 1.3; padding-top: 3px; white-space: normal; }
.tl-clip.tl-k-scenes { background: color-mix(in oklab, var(--tl-fg) 12%, transparent); border: 1px solid var(--tl-border); }
.tl-clip.tl-k-vo { background: color-mix(in oklab, #2dd4bf 30%, transparent); }
.tl-clip.tl-k-bgm { background: color-mix(in oklab, var(--tl-primary) 28%, transparent); }
.tl-clip.tl-k-captions { background: color-mix(in oklab, var(--tl-info) 26%, transparent); }
.tl-tick { position: absolute; top: 5px; bottom: 5px; width: 2px; margin-left: -1px; border-radius: 1px; background: #f472b6; }
.tl-playhead { position: absolute; top: 0; bottom: 0; width: 1.5px; background: var(--tl-primary); pointer-events: none; }
.tl-playhead::before { content: ""; position: absolute; top: 0; left: -4px; border: 5px solid transparent; border-top-color: var(--tl-primary); }
.tl-ruler { position: relative; height: 18px; border-bottom: 1px solid var(--tl-border); margin-left: 92px; }
.tl-ruler span { position: absolute; top: 2px; font-family: var(--tl-mono); font-size: 9.5px; color: var(--tl-muted); transform: translateX(-50%); }

/* Zoom controls, toasts, overlays */
.tl-zoom { position: absolute; right: 12px; bottom: 12px; display: flex; gap: 2px; padding: 3px; border-radius: 10px; background: var(--tl-card); border: 1px solid var(--tl-border); box-shadow: var(--tl-shadow); z-index: 4; align-items: center; }
.tl-zoom .tl-pct { width: 46px; text-align: center; font-family: var(--tl-mono); font-size: 11px; color: var(--tl-muted); }
.tl-legend { position: absolute; left: 12px; bottom: 12px; display: flex; gap: 10px; padding: 6px 10px; border-radius: 10px; background: var(--tl-card); border: 1px solid var(--tl-border); z-index: 4; font-size: 11px; color: var(--tl-muted); align-items: center; }
.tl-legend span { display: inline-flex; align-items: center; gap: 5px; }
.tl-legend i { width: 8px; height: 8px; border-radius: 50%; }
.tl-banner { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); z-index: 4; display: flex; gap: 8px; align-items: center; padding: 6px 8px 6px 12px; border-radius: 10px; background: var(--tl-card); border: 1px solid var(--tl-border); box-shadow: var(--tl-shadow); font-size: 12px; max-width: calc(100% - 24px); }
.tl-banner.tl-warnb { border-color: color-mix(in oklab, var(--tl-warning) 45%, transparent); }
.tl-banner.tl-errb { border-color: color-mix(in oklab, var(--tl-error) 45%, transparent); }
.tl-pop { position: absolute; right: 10px; top: 44px; width: 380px; max-width: calc(100% - 20px); max-height: calc(100% - 56px); overflow: auto; z-index: 20; border-radius: 12px; background: var(--tl-card); border: 1px solid var(--tl-border); box-shadow: var(--tl-shadow), 0 20px 50px -20px #0009; padding: 14px; }
.tl-pop h3 { margin: 0 0 10px; font-size: 13px; font-weight: 650; }
.tl-set-row { display: grid; grid-template-columns: 140px 1fr; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--tl-border); font-size: 12.5px; align-items: baseline; }
.tl-set-row:last-child { border-bottom: 0; }
.tl-set-row dt { color: var(--tl-muted); }
.tl-set-row dd { margin: 0; overflow-wrap: anywhere; }
.tl-yes { color: var(--tl-success); font-weight: 600; }
.tl-no { color: var(--tl-muted); }
.tl-empty { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px; z-index: 3; pointer-events: none; }
.tl-empty-card { pointer-events: auto; max-width: 520px; padding: 22px 24px; border-radius: 16px; background: var(--tl-card); border: 1px solid var(--tl-border); box-shadow: var(--tl-shadow); }
.tl-empty-card h2 { margin: 0 0 8px; font-size: 18px; font-weight: 700; letter-spacing: -.01em; }
.tl-empty-card p { margin: 0 0 12px; color: var(--tl-muted); font-size: 13px; }
.tl-steps { display: flex; flex-wrap: wrap; gap: 4px; margin: 14px 0 4px; }
.tl-steps span { font-size: 11px; padding: 3px 8px; border-radius: 999px; background: var(--tl-card-3); color: var(--tl-muted); }
.tl-steps span.tl-gate { color: var(--tl-primary); background: var(--tl-primary-soft); }
`;
