// launch-kit · the scene grammar (contracts §6): scenes.json → typed scenes → one composition per format × language.
//
//   remotion/scenes.json  { fps, formats, languages, ground?, scenes: [{ id, type, from?, len, props, transitionOut?, vo?, editions? }] }
//   stages/vo/lines.json  [{ id, sceneId, lang, text, take, file, durS, words, at? }]      (optional; contracts §5)
//
// Timing rules (music-locked is the default: `len` = the scene's window on the music grid and the VO lines sit inside it; the growth rule
// below is the VO-locked fallback and only fires when a line overflows its window):
//   · `len` is seconds (a number, or {en, ja} when the Japanese read runs longer). `from` is optional: scenes run back to back; a
//     given `from` is honoured only when it is not before the previous scene's end (the grammar never overlaps plates except in a
//     transition's `xf`).
//   · a scene is stretched (never shrunk) to hold its VO lines: len ≥ last line end + `vo.tail` (default 0.35 s).
//   · VO lines of a scene start at `vo.at` (default 0.3 s) and follow each other with `vo.gap` (default 0.35 s), or at their own `at`.
//   · with no lines.json, a scene's `vo: {en, ja}` text gets a placeholder timing (EN 2.7 words/s, JA 7.5 chars/s) for captions.
import type React from 'react';
import type {Bi, Lang, FilmLang} from './core/text';
import type {Aspect} from './core/film';
import type {GroundKind} from './ground/Ground';
import type {BrandSettings} from './brand/assistant';

export type Edition = 'short' | 'full';
/** cut · carry (depth/carry, centred on the boundary) · slide (lateral pane) · handoff (the next scene starts `xf` early UNDER this one,
 *  which draws its own exit, e.g. the send → circular reveal; nothing fades) */
export type TransitionKind = 'cut' | 'carry' | 'slide' | 'handoff';
export type TransitionSpec = TransitionKind | {kind: TransitionKind; xf?: number};
export type SceneSpec = {
  id: string; type: string;
  from?: number; len: number | {en: number; ja: number};
  props?: Record<string, unknown>;
  /** the hand-off into the next scene (default: the scene type's own default) */ transitionOut?: TransitionSpec;
  /** the ground under this scene (default: the scene type's, else the film's) */ ground?: GroundKind;
  /** placeholder VO / VO placement: text per language (used when lines.json has no line for this scene) */
  vo?: {en?: string; ja?: string; at?: number; gap?: number; tail?: number};
  /** on-screen text (informational; scenes read their text from props) */ onScreen?: {en?: string; ja?: string};
  /** which editions include the scene (default both). SHORT = FULL ending earlier. */ editions?: Edition[];
  notes?: string;
};
export type ScenesDoc = {
  /** unit of every scene `from` / `len`: "seconds" (default) or "frames" at `fps`. VO `at` / `gap` / `tail` are always seconds. */
  units?: 'seconds' | 'frames';
  fps?: number; title?: string; formats?: string[]; languages?: FilmLang[]; ground?: GroundKind;
  captions?: {bottom?: number};
  /** run-level brand settings: {display: "ACME", match: ["Acme"], assistantName: "Ava" | {en, ja}} (default: no transform, "your assistant") */ brand?: BrandSettings;
  scenes: SceneSpec[];
};
export type VoLine = {id: string; sceneId: string; lang: Lang; text: string; take?: number; file?: string; durS?: number; words?: {text: string; start: number; end: number}[]; at?: number};

/** what a scene component receives besides its props */
export type SceneCtx = {
  id: string; type: string;
  /** seconds since the scene's start (can run past len while its transition / spill plays) */ t: number;
  /** the scene's length, s */ len: number;
  /** the film second of the scene's start */ from: number;
  lang: Lang; subLang: Lang; aspect: Aspect; portrait: boolean; W: number; H: number; fps: number;
  /** this scene's VO lines, placed (s, local) */ vo: {id: string; at: number; dur: number; text: string}[];
  /** the neighbouring scenes: their id, type and raw props (so a scene can continue its neighbour's element, e.g. a logo the
   *  previous scene left on screen) */
  prev?: {id: string; type: string; props?: Record<string, unknown>}; next?: {id: string; type: string; props?: Record<string, unknown>};
  /** seconds this scene is already drawn before its start (a 'handoff' from the previous scene: it draws under the previous plate) */ leadIn: number;
};
export type SceneDef<P> = {
  type: string;
  title: string;
  description: string;
  /** props with every field defaulted (the scene renders with {}) */ defaults: P;
  /** default length, s */ defaultLen: number;
  /** caption band while this scene is on screen: 'ui' = app UI fills the frame (24 px band), 'free' = 80 px (or a function of the props,
   *  e.g. a card that sits on a chat page in one mode and floats in another) */ band: 'free' | 'ui' | ((p: P) => 'free' | 'ui');
  /** the full-screen type is the picture: captions are muted over it (except en-jasub) */ muteCaptions?: boolean;
  ground?: GroundKind;
  /** the hand-off into the next scene (or a function of the props, e.g. a scene whose 'ask' mode hands off) */ transitionOut?: TransitionSpec | ((p: P) => TransitionSpec);
  /** seconds the scene keeps drawing into the next one (e.g. a floating video card), read from its props */
  spill?: (p: P) => number;
  component: React.FC<{p: P; c: SceneCtx}>;
  /** extra props for the Preview gallery */ preview?: Partial<P>;
};

const REG = new Map<string, SceneDef<any>>();
/** declare a scene type (the kit's own, or a run's custom scene in remotion/src/custom/) and register it */
export function defineScene<P>(def: SceneDef<P>): SceneDef<P> {
  REG.set(def.type, def as SceneDef<any>);
  return def;
}
export const getScene = (type: string): SceneDef<any> | undefined => REG.get(type);
export const sceneTypes = (): string[] => [...REG.keys()];
export const allScenes = (): SceneDef<any>[] => [...REG.values()];

/** merge defaults deeply one level (objects), so a scenes.json can override a single field */
export const withDefaults = <P,>(defaults: P, props: Record<string, unknown> | undefined): P => {
  const out: Record<string, unknown> = {...(defaults as Record<string, unknown>)};
  for (const [k, v] of Object.entries(props ?? {})) {
    const d = out[k];
    out[k] = d && v && typeof d === 'object' && typeof v === 'object' && !Array.isArray(d) && !Array.isArray(v) && !('en' in (v as object) && 'ja' in (v as object)) ? {...(d as object), ...(v as object)} : v;
  }
  return out as P;
};
export type {Bi};
