// launch-kit · motion helpers. Pure functions of time (seconds); nothing reads Date / Math.random / timers.
// Curves are plain polynomial / exponential easings (no measured curves are bundled): EL for entrances and morphs, EASE for the
// plate transitions. Tune them per run in remotion/src/custom/ if a house style needs different ones.
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const c01 = clamp01;
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

const outCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const inOutCubic = (x: number) => { const k = clamp01(x); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
const outExpo = (x: number) => { const k = clamp01(x); return k >= 1 ? 1 : 1 - Math.pow(2, -10 * k); };
const inCubic = (x: number) => Math.pow(clamp01(x), 3);
const outQuad = (x: number) => 1 - Math.pow(1 - clamp01(x), 2);
const inOutQuart = (x: number) => { const k = clamp01(x); return k < 0.5 ? 8 * k ** 4 : 1 - Math.pow(-2 * k + 2, 4) / 2; };

/** entrance / morph curves */
export const EL = {enter: outCubic, morph: inOutCubic, settle: outExpo, linear: (x: number) => clamp01(x)} as const;
/** plate-transition curves: soft (arrive from depth), leave (fade out), glide (lateral pane) */
export const EASE = {soft: outQuad, leave: inCubic, glide: inOutQuart} as const;

/** 0→1 over [a, a + d] seconds with an easing (default EL.enter) */
export const kk = (t: number, a: number, d: number, e: (x: number) => number = EL.enter) => e(c01((t - a) / Math.max(1e-4, d)));
/** a 0→1→0 sine bump over x ∈ [0, 1] */
export const bell = (x: number) => (x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x));
/** expo-out, normalised to reach exactly 1 */
export const expoOut = (x: number) => { const k = c01(x); return k >= 1 ? 1 : (1 - Math.pow(2, -10 * k)) / (1 - Math.pow(2, -10)); };
export const mixN = (a: number, b: number, k: number) => a + (b - a) * k;
export type Rect = {x: number; y: number; w: number; h: number};
export const lerpRect = (a: Rect, b: Rect, k: number): Rect => ({x: mixN(a.x, b.x, k), y: mixN(a.y, b.y, k), w: mixN(a.w, b.w, k), h: mixN(a.h, b.h, k)});
/** the first `k` fraction of a string (streamed text) */
export const streamStr = (s: string, k: number) => s.slice(0, Math.floor(s.length * c01(k)));
/** typed text: characters appear over [a, a + d] */
export const typed = (s: string, t: number, a: number, d: number) => streamStr(s, (t - a) / Math.max(0.05, d));

/* ---------- living holds (launch-motion: nothing static > ~2 s, a new reveal every ~3 s, holds are 0.3–1 s "living" holds) ---------- */
/** a slow camera push that runs at a CONSTANT rate from `from` (s): a longer scene just keeps pushing (it never stretches an easing),
 *  easing into its `max` (default +4 %) asymptotically; soft onset over the first second. Returns the zoom (1 → 1 + max). */
export const slowPush = (t: number, o: {from?: number; rate?: number; max?: number} = {}) => {
  const a = Math.max(0, t - (o.from ?? 0));
  const r = a < 1 ? (a * a) / 2 : a - 0.5;
  const max = o.max ?? 0.04, rate = o.rate ?? 0.006;
  return 1 + max * (1 - Math.exp((-rate * r) / max));
};
/** idle beats for a hold that grew: times from `a` to `b` (exclusive of b − 0.6) every `every` s (default 2.6 s) */
export const idleBeats = (a: number, b: number, every = 2.6): number[] => {
  const out: number[] = [];
  for (let x = a; x < b - 0.6; x += every) out.push(x);
  return out;
};
/** the strongest 0→1→0 pulse (length `d`) of a list of beat times at t */
export const pulseAt = (t: number, beats: number[], d = 0.8) => beats.reduce((m, b) => Math.max(m, bell((t - b) / d)), 0);
/** scale about a focus point as a CSS transform (for a camera push onto an element in stage px) */
export const zoomAbout = (z: number, fx: number, fy: number, dx = 0, dy = 0) =>
  z === 1 && !dx && !dy ? undefined : `translate(${(fx * (1 - z) + dx).toFixed(2)}px, ${(fy * (1 - z) + dy).toFixed(2)}px) scale(${z.toFixed(5)})`;
