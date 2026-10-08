// launch-kit · SceneRenderer: a resolved film (layout.ts) → the picture.
//   ONE ground (FilmGround on the film clock; a scene's ground kind cross-fades only the ground) · each scene a plate in its own
//   <Sequence> · the hand-offs between plates (carry = depth/carry, slide = lateral pane, cut / handoff = the scenes draw their own
//   continuous hand-off) · captions (band rules) · VO audio.
// Rules: continuous element-to-element transitions, no gradient/layer seams (plates carry no ground of their own), no double-exposure
// dissolves (a carry blurs the outgoing plate back while the incoming settles from depth), frame-deterministic (every value is a
// function of the frame).
import React from 'react';
import {AbsoluteFill, Audio, Sequence, useCurrentFrame, useVideoConfig} from 'remotion';
import {FilmProvider, useFilm} from './core/film';
import {getScene, withDefaults, type SceneCtx} from './grammar';
import type {ResolvedFilm, ResolvedScene} from './layout';
import {FilmGround, type GroundCue, type GroundKind} from './ground/Ground';
import {Captions, type BandSpan} from './captions/Captions';
import {EASE, EL, c01} from './core/motion';
import {runFile} from './assets';

/** frames a scene is drawn before its start (the previous scene's transition) and after its end (its own) */
const preOf = (prev: ResolvedScene | undefined, fps: number) => (prev ? Math.round((prev.transition.kind === 'handoff' ? prev.transition.xf : prev.transition.xf / 2) * fps) : 0);
const postOf = (s: ResolvedScene, fps: number) => (s.transition.kind === 'handoff' ? 0 : Math.round((s.transition.xf * fps) / 2));

const Plate: React.FC<{s: ResolvedScene; prev?: ResolvedScene; fps: number; children: React.ReactNode}> = ({s, prev, fps, children}) => {
  const frame = useCurrentFrame(); // local to the Sequence
  const {width} = useVideoConfig();
  const pre = preOf(prev, fps);
  const t = (frame - pre) / fps; // scene seconds
  const out = s.transition, xo = out.xf;
  let style: React.CSSProperties = {};
  // incoming
  if (prev && prev.transition.kind === 'carry' && prev.transition.xf > 0) {
    const e = EASE.soft(c01((t + prev.transition.xf / 2) / prev.transition.xf));
    if (e < 1) style = {opacity: e, transform: `scale(${(1.04 - 0.04 * e).toFixed(5)})`, filter: `blur(${(8 * (1 - e)).toFixed(2)}px)`};
  }
  if (prev && prev.transition.kind === 'slide' && prev.transition.xf > 0) {
    const e = EASE.glide(c01((t + prev.transition.xf / 2) / prev.transition.xf));
    if (e < 1) style = {transform: `translateX(${((1 - e) * width).toFixed(1)}px)`};
  }
  // outgoing
  if (xo > 0 && t > s.lenS - xo / 2) {
    const k = (t - (s.lenS - xo / 2)) / xo;
    if (out.kind === 'carry') {
      const e = EL.enter(c01(k));
      style = {opacity: 1 - EASE.leave(c01(k * 1.15)), transform: `scale(${(1 - 0.05 * e).toFixed(5)})`, filter: `blur(${(14 * e).toFixed(2)}px)`};
    } else if (out.kind === 'slide') {
      const e = EASE.glide(c01(k));
      style = {transform: `translateX(${(-e * width).toFixed(1)}px)`};
    }
  }
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
};

const SceneBody: React.FC<{s: ResolvedScene; prev?: ResolvedScene; next?: ResolvedScene}> = ({s, prev, next}) => {
  const frame = useCurrentFrame();
  const f = useFilm();
  const def = getScene(s.type);
  const pre = preOf(prev, f.fps);
  if (!def) return <AbsoluteFill style={{display: 'grid', placeItems: 'center', color: '#c00', fontSize: 40}}>unknown scene type “{s.type}”</AbsoluteFill>;
  const p = withDefaults(def.defaults, s.props);
  const c: SceneCtx = {id: s.id, type: s.type, t: (frame - pre) / f.fps, len: s.lenS, from: s.fromS, lang: f.lang, subLang: f.subLang, aspect: f.aspect, portrait: f.portrait, W: f.W, H: f.H, fps: f.fps,
    vo: s.vo.map((v) => ({id: v.id, at: v.at, dur: v.dur, text: v.text})), prev: prev ? {id: prev.id, type: prev.type, props: prev.props} : undefined, next: next ? {id: next.id, type: next.type, props: next.props} : undefined, leadIn: pre / f.fps};
  const C = def.component;
  return <C p={p} c={c} />;
};

export type SceneRendererProps = {film: ResolvedFilm; ground?: GroundKind; audio?: boolean; captions?: boolean; captionBottom?: number};
export const SceneRenderer: React.FC<SceneRendererProps> = ({film, ground = 'soft', audio = true, captions = true, captionBottom}) => (
  <FilmProvider lang={film.filmLang} brand={film.brand}>
    <FilmBody film={film} ground={ground} audio={audio} captions={captions} captionBottom={captionBottom} />
  </FilmProvider>
);

const FilmBody: React.FC<Required<Omit<SceneRendererProps, 'captionBottom'>> & {captionBottom?: number}> = ({film, ground, audio, captions, captionBottom}) => {
  const f = useFilm();
  const S = film.scenes;
  const cues: GroundCue[] = S.map((s) => ({at: s.fromS, kind: s.ground ?? ground, fade: 0.9}));
  const dedup = cues.filter((c, i) => i === 0 || c.kind !== cues[i - 1].kind);
  const bands: BandSpan[] = S.map((s) => ({from: s.fromS - 0.3, to: s.fromS + s.lenS, band: s.band}));
  const mute: [number, number][] = film.subLang === film.lang ? S.filter((s) => s.muteCaptions).map((s) => [s.fromS - 0.2, s.fromS + s.lenS + 0.1]) : [];
  return (
    <AbsoluteFill style={{background: '#EEF1F5'}}>
      <FilmGround cues={dedup} />
      {S.map((s, i) => {
        const prev = S[i - 1], next = S[i + 1];
        const pre = preOf(prev, f.fps);
        const post = postOf(s, f.fps) + Math.round(s.spill * f.fps);
        return (
          <Sequence key={s.id} name={`${s.id} · ${s.type}`} from={s.from - pre} durationInFrames={s.len + pre + post} style={{zIndex: s.spill > 0 ? 5 : s.transition.kind === 'handoff' ? 4 : 1 + (i % 2)}}>
            <Plate s={s} prev={prev} fps={f.fps}><SceneBody s={s} prev={prev} next={next} /></Plate>
          </Sequence>
        );
      })}
      {captions ? <Captions cues={film.captions} aspect={f.aspect} lang={film.subLang} bands={bands} mute={mute} bottom={captionBottom} /> : null}
      {audio ? S.flatMap((s) => s.vo.filter((v) => v.file).map((v) => (
        <Sequence key={'vo-' + s.id + v.id} from={s.from + Math.round(v.at * f.fps)} name={`VO ${v.id}`}>
          <Audio src={runFile(v.file!)} />
        </Sequence>
      ))) : null}
    </AbsoluteFill>
  );
};
