// launch-kit · layout: scenes.json + lines.json → the resolved film (frames) and its timeline.json (contracts §5).
// Pure (no React, no Remotion): used by the compositions' calculateMetadata and written out by the run's render.mjs.
import type {Edition, ScenesDoc, SceneSpec, TransitionKind, TransitionSpec, VoLine} from './grammar';
import {getScene} from './grammar';
import {pictureLang, captionLang, type FilmLang, type Lang} from './core/text';
import {lineToCues, type CaptionCue} from './captions/Captions';
import type {GroundKind} from './ground/Ground';
import type {BrandSettings} from './brand/assistant';

export type ResolvedScene = {
  id: string; type: string; from: number; len: number; /** s */ fromS: number; lenS: number;
  props: Record<string, unknown>; transition: {kind: TransitionKind; xf: number}; spill: number; ground?: GroundKind;
  vo: {id: string; at: number; dur: number; text: string; file?: string; lang: Lang}[];
  band: 'free' | 'ui'; muteCaptions: boolean;
};
export type ResolvedFilm = {
  fps: number; frames: number; lang: Lang; subLang: Lang; filmLang: FilmLang; edition: Edition;
  scenes: ResolvedScene[]; captions: CaptionCue[]; brand?: BrandSettings;
};
export type TimelineJson = {
  /** every from / len / dur / t below is in frames at `fps` (contracts §5; the viewer and common/timeline.py read this field) */
  units: 'frames';
  fps: number;
  /** keyed by the version key `<format>-<lang>` (= the composition id, e.g. short-16x9-en); `format` + `lang` repeat it */
  formats: Record<string, {width: number; height: number; frames: number; format: string; lang: string; comp: string; scale?: number}>;
  scenes: {id: string; type: string; from: number; len: number}[];
  tracks: {vo: {from: number; dur: number; id: string; lang: string; file?: string}[]; bgm: {from: number; dur: number; file: string}[]; sfx: {t: number; id: string; group: string}[]; captions: {from: number; dur: number; text: string; lang: string}[]};
};

const XF_DEFAULT: Record<TransitionKind, number> = {cut: 0, carry: 0.5, slide: 1.3, handoff: 0};
const trans = (t: TransitionSpec | undefined): {kind: TransitionKind; xf: number} => {
  if (!t) return {kind: 'carry', xf: XF_DEFAULT.carry};
  if (typeof t === 'string') return {kind: t, xf: XF_DEFAULT[t]};
  return {kind: t.kind, xf: t.xf ?? XF_DEFAULT[t.kind]};
};
const lenOf = (s: SceneSpec, lang: Lang, fallback: number) => (typeof s.len === 'number' ? s.len : s.len?.[lang] ?? fallback);
/** placeholder VO duration from text (EN ~2.7 words/s, JA ~7.5 chars/s) */
export const estimateVo = (text: string, lang: Lang) => (lang === 'ja' ? text.replace(/[\s、。「」]/g, '').length / 7.5 + text.split(/[、。]/).length * 0.2 : text.split(/\s+/).filter(Boolean).length / 2.7);

/** scenes.json with `"units": "frames"` → seconds (the grammar's own unit; `"units": "seconds"` or no field = seconds) */
export const inSeconds = (doc: ScenesDoc, fps: number): ScenesDoc => {
  if (doc.units !== 'frames') return doc;
  const k = (v: number) => v / fps;
  return {...doc, units: 'seconds', scenes: doc.scenes.map((s) => ({...s, ...(s.from !== undefined ? {from: k(s.from)} : {}),
    len: typeof s.len === 'number' ? k(s.len) : s.len ? {en: k(s.len.en), ja: k(s.len.ja)} : s.len}))};
};

export const layoutFilm = (docIn: ScenesDoc, o: {filmLang: FilmLang; edition?: Edition; lines?: VoLine[] | null; fps?: number}): ResolvedFilm => {
  const fps = o.fps ?? docIn.fps ?? 30;
  const doc = inSeconds(docIn, fps);
  const edition = o.edition ?? 'short';
  const lang = pictureLang(o.filmLang), subLang = captionLang(o.filmLang);
  const voLang: Lang = lang; // en-jasub = English VO
  const list = doc.scenes.filter((s) => !s.editions || s.editions.includes(edition));
  const lines = (o.lines ?? []).filter((l) => l.lang === voLang);
  const subLines = (o.lines ?? []).filter((l) => l.lang === subLang);
  const out: ResolvedScene[] = [];
  const captions: CaptionCue[] = [];
  let cursor = 0;
  list.forEach((s, i) => {
    const def = getScene(s.type);
    const dt = def?.transitionOut;
    const tr = trans(s.transitionOut ?? (typeof dt === 'function' ? dt({...(def?.defaults ?? {}), ...(s.props ?? {})} as never) : dt));
    // VO lines of the scene (lines.json), else the placeholder text
    const mine = lines.filter((l) => l.sceneId === s.id);
    const at0 = s.vo?.at ?? 0.3, gap = s.vo?.gap ?? 0.35, tail = s.vo?.tail ?? 0.35;
    const vo: ResolvedScene['vo'] = [];
    let cur = at0;
    if (mine.length) {
      for (const l of mine) {
        const at = l.at ?? cur;
        const dur = l.durS ?? estimateVo(l.text, voLang);
        vo.push({id: l.id, at, dur, text: l.text, file: l.file, lang: voLang});
        cur = at + dur + gap;
      }
    } else {
      const text = s.vo?.[voLang];
      if (text) { const dur = estimateVo(text, voLang); vo.push({id: `${s.id}-vo`, at: at0, dur, text, lang: voLang}); }
    }
    const voEnd = vo.reduce((a, v) => Math.max(a, v.at + v.dur), 0);
    let lenS = lenOf(s, lang, def?.defaultLen ?? 4);
    if (vo.length) lenS = Math.max(lenS, voEnd + tail);
    const fromS = s.from !== undefined && s.from >= cursor - 1e-6 && typeof s.len === 'number' ? s.from : cursor;
    const from = Math.round(fromS * fps), len = Math.round(lenS * fps);
    cursor = (from + len) / fps;
    const props = {...(s.props ?? {})};
    const spill = def?.spill ? def.spill(props as never) : 0;
    out.push({id: s.id, type: s.type, from, len, fromS: from / fps, lenS: len / fps, props, transition: i === list.length - 1 ? {kind: 'cut', xf: 0} : tr, spill, ground: s.ground ?? def?.ground, vo, band: typeof def?.band === 'function' ? def.band({...(def.defaults ?? {}), ...props} as never) : def?.band ?? 'free', muteCaptions: !!def?.muteCaptions});
    // captions: the heard line (EN / JA film), or the Japanese line on the English timing (en-jasub)
    vo.forEach((v, k) => {
      const t0 = from / fps + v.at;
      if (subLang === voLang) captions.push(...lineToCues(v.text, voLang, t0, v.dur, mine[k]?.words));
      else {
        const ja = subLines.find((l) => l.sceneId === s.id && (l.id === v.id || l.id.replace(/-ja$/, '') === v.id.replace(/-en$/, ''))) ?? subLines.filter((l) => l.sceneId === s.id)[k];
        const text = ja?.text ?? s.vo?.ja;
        if (text) captions.push(...lineToCues(text, subLang, t0, v.dur));
      }
    });
    // en-jasub: the type screens are subtitled too (their on-screen EN line gets its JA line)
    if (subLang !== voLang && def?.muteCaptions && s.onScreen?.ja && !vo.length) captions.push({from: from / fps + 0.3, dur: Math.max(1, lenS - 0.6), text: s.onScreen.ja, lang: subLang});
  });
  const last = out[out.length - 1];
  const frames = last ? last.from + last.len : fps;
  return {fps, frames, lang, subLang, filmLang: o.filmLang, edition, scenes: out, captions, brand: doc.brand};
};

/** the contracts §5 timeline.json for one rendered format (merge into an existing file with mergeTimeline) */
export const timelineOf = (film: ResolvedFilm, format: string, size: {width: number; height: number}, comp?: string): TimelineJson => ({
  units: 'frames',
  fps: film.fps,
  formats: {[comp ?? `${format}-${film.filmLang}`]: {width: size.width, height: size.height, frames: film.frames, format, lang: film.filmLang, comp: comp ?? `${format}-${film.filmLang}`}},
  scenes: film.scenes.map((s) => ({id: s.id, type: s.type, from: s.from, len: s.len})),
  tracks: {
    vo: film.scenes.flatMap((s) => s.vo.map((v) => ({from: s.from + Math.round(v.at * film.fps), dur: Math.round(v.dur * film.fps), id: v.id, lang: v.lang, ...(v.file ? {file: v.file} : {})}))),
    bgm: [], sfx: [],
    captions: film.captions.map((c) => ({from: Math.round(c.from * film.fps), dur: Math.round(c.dur * film.fps), text: c.text, lang: c.lang})),
  },
});
