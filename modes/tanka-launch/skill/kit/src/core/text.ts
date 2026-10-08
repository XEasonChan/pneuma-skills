// launch-kit · bilingual text and the brand display rule.
// Every on-screen string in a scene prop is `Bi`: a plain string (used for every language) or {en, ja}. `tx(v, lang)` resolves it and
// applies the run's brand display transform (scenes.json `brand.display`, e.g. a product written in capitals on screen). The VO / TTS
// text is never touched. With no brand set, text passes through unchanged.
export type Lang = 'en' | 'ja';
/** a film language: 'en-jasub' = English picture + VO with Japanese subtitles */
export type FilmLang = 'en' | 'ja' | 'en-jasub';
export type Bi = string | {en: string; ja: string};
export type BiList = Bi[] | {en: string[]; ja: string[]};

/** the brand display rule: every whole-word spelling in `match` (case-insensitive) is shown as `display` */
export type BrandCapsRule = {display: string; match?: string[]};
let RULE: {display: string; re: RegExp} | null = null;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** set once per render by FilmProvider from scenes.json `brand` (null / no display = no transform) */
export const setBrandCaps = (rule?: BrandCapsRule | null) => {
  const d = rule?.display?.trim();
  if (!d) { RULE = null; return; }
  const words = [...new Set([d, ...(rule?.match ?? [])].map((w) => w.trim()).filter(Boolean))];
  // whole word, and not inside a domain or file name ("acme.io", "acme-logo.svg" stay as written)
  RULE = {display: d, re: new RegExp(`(?<![\\w.-])(?:${words.map(esc).join('|')})(?![\\w-]|\\.\\w)`, 'gi')};
};
/** the brand's display form on screen (identity when no brand is set) */
export const brandCaps = (s: string): string => (RULE ? s.replace(RULE.re, RULE.display) : s);

export const pickLang = <T,>(v: T | {en: T; ja: T}, lang: Lang): T =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && 'en' in (v as object) && 'ja' in (v as object) ? (v as {en: T; ja: T})[lang] : (v as T);
/** resolve a Bi to the language, with the brand display rule */
export const tx = (v: Bi | undefined, lang: Lang): string => (v === undefined ? '' : brandCaps(pickLang<string>(v, lang)));
export const txList = (v: BiList | undefined, lang: Lang): string[] => {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => tx(x, lang));
  return (v[lang] ?? []).map(brandCaps);
};
/** the picture language of a film language */
export const pictureLang = (l: FilmLang): Lang => (l === 'ja' ? 'ja' : 'en');
/** the caption language of a film language */
export const captionLang = (l: FilmLang): Lang => (l === 'en' ? 'en' : 'ja');
