// launch-kit · captions: ONE subtitle style for the whole film (no animated overlay captions), with
//   · the brand display rule on every chunk (scenes.json `brand.display`)
//   · the band rules: the plate's bottom 80 px above the frame's bottom; over app UI 24 px. 9:16 = 240 / 220 px (clear of the
//     platform UI). See brand/tokens CAPTION_BAND.
//   · mute ranges: full-screen type screens are the picture, so their line is not subtitled (the en-jasub film subtitles them too).
// Chunking: a VO line is split at sentence / clause punctuation into ≤ 2-line chunks, timed by the line's word times when present
// (stages/vo/lines.json words[]) or by character share. Captions are verbatim: the chunks are the VO text, never a paraphrase.
import React from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig} from 'remotion';
import {CAPTION_BAND, fontFor} from '../brand/tokens';
import {brandCaps, type Lang} from '../core/text';
import {c01} from '../core/motion';
import type {Aspect} from '../core/film';

export type CaptionCue = {from: number; dur: number; text: string; lang: Lang};
export type BandSpan = {from: number; to: number; band: 'free' | 'ui'};
export type WordT = {text: string; start: number; end: number};
export type SubChunk = {text: string; from: number; to: number};

const MAX = {en: 64, ja: 30};
/** split a line into caption chunks (≤ MAX chars per chunk where punctuation allows) */
export const splitCaption = (text: string, lang: Lang): string[] => {
  const t = text.trim();
  if (!t) return [];
  const lim = MAX[lang];
  if (t.length <= lim) return [t];
  const parts = lang === 'ja' ? t.split(/(?<=[。！？])/) : t.split(/(?<=[.!?;:])\s+/);
  const out: string[] = [];
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    if (p.length <= lim) { out.push(p); continue; }
    const sub = lang === 'ja' ? p.split(/(?<=、)/) : p.split(/(?<=,)\s+/);
    let cur = '';
    for (const s of sub) {
      if ((cur + (lang === 'ja' ? '' : ' ') + s).trim().length > lim && cur) { out.push(cur.trim()); cur = s; } else cur = cur ? cur + (lang === 'ja' ? '' : ' ') + s : s;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
};
/** caption cues of one VO line (film seconds) */
export const lineToCues = (text: string, lang: Lang, from: number, dur: number, words?: WordT[]): CaptionCue[] => {
  const chunks = splitCaption(text, lang);
  if (!chunks.length) return [];
  const total = chunks.reduce((a, c) => a + c.length, 0);
  let acc = 0;
  return chunks.map((c, i) => {
    let a = from + (acc / total) * dur, b = from + ((acc + c.length) / total) * dur;
    if (words && words.length && lang === 'en') {
      // word-timed: the chunk starts on its first word, ends on its last word
      const n0 = text.slice(0, text.indexOf(c)).split(/\s+/).filter(Boolean).length, n1 = n0 + c.split(/\s+/).filter(Boolean).length - 1;
      if (words[n0] && words[Math.min(n1, words.length - 1)]) { a = from + words[n0].start; b = from + words[Math.min(n1, words.length - 1)].end; }
    }
    acc += c.length;
    return {from: a, dur: Math.max(0.6, b - a + (i === chunks.length - 1 ? 0.25 : 0.05)), text: c, lang};
  });
};

/** the subtitle plate: white text on a soft dark plate, centred, a 0.12 s fade at each end; muted inside `mute` ranges */
export const FilmSubtitle: React.FC<{caps: SubChunk[]; lang: Lang; bottom: number; size: number; maxW: number; mute?: [number, number][]}> = ({caps, lang, bottom, size, maxW, mute}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const cur = caps.find((c) => t >= c.from && t < c.to);
  if (!cur || (mute ?? []).some(([a, b]) => t >= a && t < b)) return null;
  const o = Math.min(c01((t - cur.from) / 0.12), c01((cur.to - t) / 0.12));
  return (
    <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', pointerEvents: 'none'}}>
      <div style={{marginBottom: bottom, maxWidth: maxW, padding: '10px 22px', borderRadius: 12, background: 'rgba(10,14,24,.62)', color: '#fff', opacity: o,
        fontFamily: fontFor(lang), fontSize: size, fontWeight: 500, lineHeight: 1.35, textAlign: 'center', textWrap: 'balance' as React.CSSProperties['textWrap']}}>{cur.text}</div>
    </AbsoluteFill>
  );
};

export const Captions: React.FC<{cues: CaptionCue[]; aspect: Aspect; lang: Lang; bands?: BandSpan[]; mute?: [number, number][]; bottom?: number}> = ({cues, aspect, lang, bands = [], mute, bottom}) => {
  const B = CAPTION_BAND[aspect];
  const bottomOf = (t: number) => bottom ?? (bands.find((b) => t >= b.from && t < b.to)?.band === 'ui' ? B.ui : B.bottom);
  const caps: (SubChunk & {bt: number})[] = cues.filter((c) => c.lang === lang).map((c) => ({text: brandCaps(c.text), from: c.from, to: c.from + c.dur, bt: bottomOf(c.from)}));
  const groups = [...new Set(caps.map((c) => c.bt))];
  return (
    <>
      {groups.map((bt) => (
        <Sequence key={'sub' + bt} name={`captions ${bt}px`} style={{zIndex: 30}}>
          <FilmSubtitle caps={caps.filter((c) => c.bt === bt)} lang={lang} bottom={bt} size={B.size[lang]} maxW={B.maxW} mute={mute} />
        </Sequence>
      ))}
    </>
  );
};
