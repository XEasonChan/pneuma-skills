// launch-kit · the Preview gallery: every registered scene type on its own (defaults + its preview props), in 16:9 and 9:16,
// plus one gallery film that plays them all back to back (Kit-Gallery-16x9 / -9x16). Register with <KitPreviewCompositions />.
import React from 'react';
import {Composition, Folder} from 'remotion';
import {allScenes, type ScenesDoc} from './grammar';
import {FilmComposition, calcFilm, type FilmCompProps} from './compositions';
import './scenes';

const one = (type: string, len: number, props: Record<string, unknown>): ScenesDoc => ({fps: 30, scenes: [{id: type, type, len, props}]});
export const galleryDoc = (): ScenesDoc => ({fps: 30, title: 'launch-kit gallery', scenes: allScenes().map((d) => ({id: d.type, type: d.type, len: d.defaultLen, props: {...(d.preview ?? {})}}))});

export const KitPreviewCompositions: React.FC = () => (
  <Folder name="launch-kit">
    {(['16x9', '9x16'] as const).map((aspect) => (
      <Composition key={'gal' + aspect} id={`Kit-Gallery-${aspect}`} component={FilmComposition} width={aspect === '16x9' ? 1920 : 1080} height={aspect === '16x9' ? 1080 : 1920} fps={30} durationInFrames={300}
        defaultProps={{scenes: galleryDoc(), filmLang: 'en', edition: 'short', aspect, lines: null}} calculateMetadata={calcFilm} />
    ))}
    {allScenes().flatMap((d) => (['16x9', '9x16'] as const).flatMap((aspect) => (['en', 'ja'] as const).map((lang) => (
      <Composition key={d.type + aspect + lang} id={`Kit-${d.type}-${aspect}-${lang}`} component={FilmComposition} width={aspect === '16x9' ? 1920 : 1080} height={aspect === '16x9' ? 1080 : 1920} fps={30} durationInFrames={300}
        defaultProps={{scenes: one(d.type, d.defaultLen, {...(d.preview ?? {})}), filmLang: lang, edition: 'short', aspect, lines: null}} calculateMetadata={calcFilm} />
    ))))}
  </Folder>
);
