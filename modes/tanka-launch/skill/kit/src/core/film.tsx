// launch-kit · the film context: language, aspect and stage size every scene reads. FilmProvider also applies the run's brand settings
// (scenes.json `brand`) once per render, so every frame reads the same values (deterministic).
import React from 'react';
import {useVideoConfig} from 'remotion';
import {pictureLang, captionLang, type FilmLang, type Lang} from './text';
import {setBrand, type BrandSettings} from '../brand/assistant';

export type Aspect = '16x9' | '9x16';
export type FilmCtx = {
  filmLang: FilmLang; lang: Lang; subLang: Lang; aspect: Aspect; W: number; H: number; fps: number; portrait: boolean;
};
const Ctx = React.createContext<FilmCtx | null>(null);

export const aspectOf = (w: number, h: number): Aspect => (h > w ? '9x16' : '16x9');

export const FilmProvider: React.FC<{lang: FilmLang; brand?: BrandSettings; children: React.ReactNode}> = ({lang, brand, children}) => {
  const {width, height, fps} = useVideoConfig();
  const aspect = aspectOf(width, height);
  const L = pictureLang(lang);
  setBrand(brand); // brand display rule + assistant name (scenes.json `brand`), the same value every frame
  const v = React.useMemo<FilmCtx>(() => ({filmLang: lang, lang: L, subLang: captionLang(lang), aspect, W: width, H: height, fps, portrait: aspect === '9x16'}), [lang, L, aspect, width, height, fps]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
};
/** the film context (outside a FilmProvider: English, from the video config) */
export const useFilm = (): FilmCtx => {
  const c = React.useContext(Ctx);
  const {width, height, fps} = useVideoConfig();
  if (c) return c;
  const aspect = aspectOf(width, height);
  return {filmLang: 'en', lang: 'en', subLang: 'en', aspect, W: width, H: height, fps, portrait: aspect === '9x16'};
};
/** the standard formats (contracts §5 timeline.json `formats`) */
export const FORMATS = {
  'short-16x9': {width: 1920, height: 1080},
  'short-9x16': {width: 1080, height: 1920},
  'full-16x9': {width: 1920, height: 1080},
  'full-9x16': {width: 1080, height: 1920},
} as const;
export type FormatId = keyof typeof FORMATS;
