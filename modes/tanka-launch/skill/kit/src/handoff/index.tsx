// launch-kit · hand-off primitives (continuous element-to-element transitions):
//   CardToChip      a card shrinks, loses its body and lands as a chip at a target rect
//   SendReveal      press → breath → a circle grows from a send button and uncovers what is under the page
//   SharedMorph     one element's rect / radius / opacity interpolated between two scenes' rects (the shared-element morph)
//   FloatingVideoCard  footage in a rounded card that glides from a full / montage rect to a floating top-left PiP and folds away
//                   (shrink + fade + blur)
//   DepthCarry      a plate that recedes (scale, blur) while the next settles from depth
// All are pure functions of the time you pass (seconds); none dissolves two sharp pictures into each other.
import React from 'react';
import {AbsoluteFill, OffthreadVideo, Img} from 'remotion';
import {c01, kk, lerp, lerpRect, expoOut, bell, EL, EASE, type Rect} from '../core/motion';
import {SHADOW} from '../brand/tokens';

export type HandoffRect = Rect & {r?: number};

/** a card (children) at `from` that becomes a chip (label) at `to` over [at, at + dur] */
export const CardToChip: React.FC<{t: number; at: number; dur?: number; from: HandoffRect; to: HandoffRect; card: React.ReactNode; chip: React.ReactNode; shadow?: string}> = ({t, at, dur = 0.7, from, to, card, chip, shadow = SHADOW.card}) => {
  const k = EL.morph(c01((t - at) / dur));
  const R = lerpRect(from, to, k), r = lerp(from.r ?? 24, to.r ?? to.h / 2, k);
  const bodyO = 1 - c01(k * 2.2), chipO = c01((k - 0.45) / 0.4);
  return (
    <div style={{position: 'absolute', left: R.x, top: R.y, width: R.w, height: R.h, borderRadius: r, overflow: 'hidden', background: '#fff', boxShadow: k < 1 ? shadow : '0 2px 8px rgba(15,23,42,.08)'}}>
      {bodyO > 0.01 ? <div style={{position: 'absolute', left: 0, top: 0, width: from.w, height: from.h, transformOrigin: '0 0', transform: `scale(${(R.w / from.w).toFixed(5)}, ${(R.h / from.h).toFixed(5)})`, opacity: bodyO}}>{card}</div> : null}
      {chipO > 0.01 ? <div style={{position: 'absolute', inset: 0, opacity: chipO, display: 'flex', alignItems: 'center'}}>{chip}</div> : null}
    </div>
  );
};

/** the send hand-off: `click` = the press frame (s). Returns the button scale / fill and the reveal radius; draw the mask with RevealMask */
export const sendReveal = (t: number, click: number, o: {breath?: number; wait?: number; dur?: number; r0?: number; rMax: number}) => {
  const press = kk(t, click, 0.05) * (1 - kk(t, click + 0.08, 0.1));
  const breath = bell((t - (click + 0.12)) / (o.breath ?? 0.35));
  const scale = (1 - 0.06 * press) * (1 + 0.12 * breath);
  const r0 = click + (o.wait ?? 0.47);
  const e = expoOut((t - r0) / (o.dur ?? 0.8));
  const radius = lerp((o.r0 ?? 18) * (1 + 0.12 * breath), o.rMax, e);
  return {press, breath, scale, revealStart: r0, revealK: e, radius, open: t >= r0};
};
/** the page above the reveal: masked by a soft-edged circle at (cx, cy) with `radius` (the page is erased inside the circle) */
export const RevealMask: React.FC<{W: number; H: number; cx: number; cy: number; radius: number; open: boolean; children: React.ReactNode}> = ({W, H, cx, cy, radius, open, children}) => {
  if (!open) return <AbsoluteFill>{children}</AbsoluteFill>;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}'><defs><filter id='b' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='6'/></filter><mask id='m'><rect width='${W}' height='${H}' fill='white'/><circle cx='${cx.toFixed(1)}' cy='${cy.toFixed(1)}' r='${radius.toFixed(1)}' fill='black' filter='url(#b)'/></mask></defs><rect width='${W}' height='${H}' fill='black' mask='url(#m)'/></svg>`;
  const m = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
  return <AbsoluteFill style={{WebkitMaskImage: m, maskImage: m, WebkitMaskSize: `${W}px ${H}px`, maskSize: `${W}px ${H}px`, WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat'} as React.CSSProperties}>{children}</AbsoluteFill>;
};

/** one element between two rects (a shared element): k 0 → 1 */
export const SharedMorph: React.FC<{k: number; from: HandoffRect; to: HandoffRect; children: React.ReactNode; style?: React.CSSProperties; shadowK?: number}> = ({k, from, to, children, style, shadowK = 1}) => {
  const R = lerpRect(from, to, k);
  return <div style={{position: 'absolute', left: R.x, top: R.y, width: R.w, height: R.h, borderRadius: lerp(from.r ?? 0, to.r ?? 0, k), overflow: 'hidden', boxShadow: shadowK > 0 ? SHADOW.float : undefined, ...style}}>{children}</div>;
};

/** footage in a card: rect `from` → `to` (glide) from `moveAt` for `moveDur`, folds away from `foldAt` (0.6 s). src = a resolved URL. */
export const FloatingVideoCard: React.FC<{t: number; src: string; from: HandoffRect; to?: HandoffRect; moveAt?: number; moveDur?: number; foldAt?: number; still?: boolean; playbackRate?: number; startFrom?: number; label?: React.ReactNode}> = ({t, src, from, to, moveAt = 0, moveDur = 0.8, foldAt, still, playbackRate = 1, startFrom = 0, label}) => {
  const kM = to ? EASE.glide(c01((t - moveAt) / moveDur)) : 0;
  const kF = foldAt !== undefined ? EASE.glide(c01((t - foldAt) / 0.6)) : 0;
  if (kF >= 1) return null;
  const R = to ? lerpRect(from, to, kM) : from;
  const r = to ? lerp(from.r ?? 30, to.r ?? 26, kM) : from.r ?? 30;
  const video = /\.(png|jpe?g|webp|svg)$/i.test(src) || still;
  return (
    <div style={{position: 'absolute', left: R.x, top: R.y, width: R.w, height: R.h, borderRadius: r, overflow: 'hidden', boxShadow: SHADOW.card, background: '#dfe5ee',
      opacity: 1 - kF, transformOrigin: '0 0', transform: kF > 0 ? `scale(${lerp(1, 0.86, kF).toFixed(4)})` : undefined, filter: kF > 0.02 ? `blur(${(6 * kF).toFixed(2)}px)` : undefined}}>
      {video ? <Img src={src} style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : <OffthreadVideo src={src} muted playbackRate={playbackRate} startFrom={startFrom} style={{width: '100%', height: '100%', objectFit: 'cover'}} />}
      {label}
    </div>
  );
};

/** a plate receding into depth (k 0 → 1) or arriving from depth (k 1 → 0 reversed with `arrive`) */
export const DepthCarry: React.FC<{k: number; arrive?: boolean; origin?: [number, number]; children: React.ReactNode}> = ({k, arrive, origin = [50, 50], children}) => {
  const e = arrive ? 1 - EASE.soft(c01(k)) : EL.enter(c01(k));
  const s = arrive ? 1 + 0.04 * e : 1 - 0.06 * e;
  const o = arrive ? 1 - e : 1 - EASE.leave(c01(k * 1.1));
  return <AbsoluteFill style={{opacity: o, transform: `scale(${s.toFixed(5)})`, transformOrigin: `${origin[0]}% ${origin[1]}%`, filter: e > 0.01 ? `blur(${((arrive ? 8 : 14) * e).toFixed(2)}px)` : undefined}}>{children}</AbsoluteFill>;
};
