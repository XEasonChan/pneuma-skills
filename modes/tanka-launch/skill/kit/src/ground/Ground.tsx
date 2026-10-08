// launch-kit · the ONE continuous ground under a film ("foreground-only plates on one continuous ground": no second gradient inside a
// card, no seams at scene boundaries). The SceneRenderer draws it once on the film clock; scenes are plates on top. The grounds are
// plain CSS gradients that drift slowly with film time (deterministic: a function of the frame only).
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {BRAND} from '../brand/tokens';

export type GroundKind = 'soft' | 'night' | 'dawn' | 'deep' | 'indigo' | 'paper' | 'none';
export const INDIGO_GROUND = 'radial-gradient(70% 60% at 50% 46%, #1E2A5A 0%, #121A3D 45%, #080C1E 100%)';

const FIELD: Record<Exclude<GroundKind, 'none' | 'indigo' | 'paper'>, {base: string; a: string; b: string}> = {
  soft: {base: '#EEF1F6', a: 'rgba(123,140,255,.28)', b: 'rgba(120,200,255,.22)'},
  dawn: {base: BRAND.dawn, a: 'rgba(255,190,150,.30)', b: 'rgba(255,230,200,.35)'},
  night: {base: BRAND.night, a: 'rgba(80,100,220,.30)', b: 'rgba(40,60,140,.35)'},
  deep: {base: BRAND.deep, a: 'rgba(90,120,255,.26)', b: 'rgba(30,160,200,.20)'},
};

/** one ground layer; `t` = film seconds (default: the frame clock) */
export const GroundLayer: React.FC<{kind: GroundKind; t?: number; opacity?: number}> = ({kind, t, opacity = 1}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const sec = t ?? frame / fps;
  if (kind === 'none' || opacity <= 0) return null;
  if (kind === 'indigo') return <AbsoluteFill style={{background: INDIGO_GROUND, opacity}} />;
  if (kind === 'paper') return <AbsoluteFill style={{background: BRAND.canvas, opacity}} />;
  const f = FIELD[kind];
  // two soft blooms orbiting slowly (one revolution per ~40 s)
  const ax = 30 + 12 * Math.sin(sec * 0.16), ay = 35 + 10 * Math.cos(sec * 0.13);
  const bx = 70 + 10 * Math.cos(sec * 0.11), by = 65 + 12 * Math.sin(sec * 0.15);
  return (
    <AbsoluteFill style={{opacity, background: `radial-gradient(45% 55% at ${ax.toFixed(2)}% ${ay.toFixed(2)}%, ${f.a} 0%, transparent 70%), radial-gradient(50% 50% at ${bx.toFixed(2)}% ${by.toFixed(2)}%, ${f.b} 0%, transparent 70%), ${f.base}`}} />
  );
};

/** a film ground that changes kind over time, cross-fading ONLY the ground (never the plates): [{at, kind, fade}] */
export type GroundCue = {at: number; kind: GroundKind; fade?: number};
export const FilmGround: React.FC<{cues: GroundCue[]}> = ({cues}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const list = [...cues].sort((a, b) => a.at - b.at);
  let i = 0;
  for (let j = 0; j < list.length; j++) if (t >= list[j].at) i = j;
  const cur = list[i] ?? {at: 0, kind: 'soft' as GroundKind};
  const prev = i > 0 ? list[i - 1] : null;
  const fade = cur.fade ?? 0.8;
  const k = prev ? Math.max(0, Math.min(1, (t - cur.at) / fade)) : 1;
  const dark = cur.kind === 'night' || cur.kind === 'indigo' || cur.kind === 'deep';
  return (
    <AbsoluteFill style={{background: dark ? BRAND.night : '#EEF1F5'}}>
      {prev && k < 1 ? <GroundLayer kind={prev.kind} /> : null}
      <GroundLayer kind={cur.kind} opacity={k} />
    </AbsoluteFill>
  );
};
