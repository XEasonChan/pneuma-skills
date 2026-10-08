// launch-kit · the run's brand settings (scenes.json `brand`), applied once per render by FilmProvider:
//   display        the brand's on-screen form, e.g. "ACME" (every whole-word spelling in `match` is shown this way; VO untouched)
//   match          other spellings to normalise ("Acme", "acme")
//   assistantName  the name a product's assistant goes by on screen, when a custom scene shows one. Always the producer's
//                  choice (a run setting), never hard-coded; neutral default "your assistant" / 「あなたのアシスタント」
// Nothing here is company-specific: with no `brand` block, text renders exactly as written.
import type {Bi, Lang} from '../core/text';
import {setBrandCaps} from '../core/text';

export const DEFAULT_ASSISTANT_NAME = {en: 'your assistant', ja: 'あなたのアシスタント'} as const;
let NAME: {en: string; ja: string} = {...DEFAULT_ASSISTANT_NAME};
export type BrandSettings = {display?: string; match?: string[]; assistantName?: Bi};
export const setBrand = (b?: BrandSettings | null) => {
  const n = b?.assistantName;
  NAME = n === undefined ? {...DEFAULT_ASSISTANT_NAME} : typeof n === 'string' ? {en: n, ja: n} : {en: n.en, ja: n.ja};
  setBrandCaps(b?.display ? {display: b.display, match: b.match} : null);
};
/** the assistant's display name in a language */
export const assistantName = (lang: Lang = 'en'): string => NAME[lang];
