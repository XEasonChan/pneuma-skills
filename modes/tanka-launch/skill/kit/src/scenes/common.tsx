// launch-kit · shared helpers for the scene components.
import React from 'react';
import {AbsoluteFill} from 'remotion';
import type {SceneCtx} from '../grammar';

/** a 1920 × 1080 design stage placed in any frame.
 *  fit 'contain' (letterbox-free: scaled to width, centred on `focusY`), 'cover' (fills; crops around `focus`), or a number (scale). */
export const Stage16: React.FC<{c: Pick<SceneCtx, 'W' | 'H'>; fit?: 'contain' | 'cover' | number; focus?: [number, number]; at?: [number, number]; children: React.ReactNode; style?: React.CSSProperties}> = ({c, fit = 'contain', focus = [960, 540], at, children, style}) => {
  const s = typeof fit === 'number' ? fit : fit === 'cover' ? Math.max(c.W / 1920, c.H / 1080) : Math.min(c.W / 1920, c.H / 1080);
  const [fx, fy] = focus;
  const [ax, ay] = at ?? [c.W / 2, c.H / 2];
  return (
    <AbsoluteFill style={{overflow: 'hidden', ...style}}>
      <div style={{position: 'absolute', left: ax - fx * s, top: ay - fy * s, width: 1920, height: 1080, transform: `scale(${s})`, transformOrigin: '0 0'}}>{children}</div>
    </AbsoluteFill>
  );
};
/** shift a layer drawn for a 1920 × 1080 centre (960, 540) onto the frame's centre (portrait: (540, 960)) */
export const Recentre: React.FC<{c: Pick<SceneCtx, 'W' | 'H'>; dy?: number; children: React.ReactNode}> = ({c, dy = 0, children}) => (
  <AbsoluteFill style={{transform: `translate(${c.W / 2 - 960}px, ${c.H / 2 - 540 + dy}px)`}}>{children}</AbsoluteFill>
);
/** a white card in the film's card language (radius 30, deep soft shadow) */
export const FilmCard: React.FC<{x: number; y: number; w: number; h: number; r?: number; o?: number; s?: number; blur?: number; origin?: string; children?: React.ReactNode; bg?: string; shadow?: string}> = ({x, y, w, h, r = 30, o = 1, s = 1, blur = 0, origin = '50% 50%', children, bg = '#fff', shadow = '0 40px 90px rgba(15,23,42,.2)'}) =>
  o <= 0.002 ? null : (
    <div style={{position: 'absolute', left: x, top: y, width: w, height: h, borderRadius: r, overflow: 'hidden', background: bg, boxShadow: shadow, opacity: o,
      transform: s !== 1 ? `scale(${s.toFixed(5)})` : undefined, transformOrigin: origin, filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined}}>{children}</div>
  );
/** the VO line of the scene at index i (or a fallback window) */
export const voWin = (c: SceneCtx, i = 0, fb: [number, number] = [0.3, 2]): [number, number] => {
  const v = c.vo[i];
  return v ? [v.at, v.dur] : fb;
};
