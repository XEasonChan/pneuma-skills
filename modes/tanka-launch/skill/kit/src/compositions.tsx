// launch-kit · generic film compositions: one per edition × aspect × language, all rendered from scenes.json (+ lines.json).
// Ids: `<edition>-<aspect>-<lang>` = short-16x9-en · short-16x9-ja · short-16x9-en-jasub · short-9x16-… · full-16x9-… = the version key of
// the naming rule (out/picture|roughcut|final/<key>.mp4, timelines/<key>.json, with format = `<edition>-<aspect>`).
import React from 'react';
import {Composition, staticFile, type CalculateMetadataFunction} from 'remotion';
import {SceneRenderer} from './SceneRenderer';
import {layoutFilm, timelineOf, type ResolvedFilm, type TimelineJson} from './layout';
import type {Edition, ScenesDoc, VoLine} from './grammar';
import type {FilmLang} from './core/text';
import {FORMATS} from './core/film';
import type {GroundKind} from './ground/Ground';

export type FilmCompProps = {
  scenes: ScenesDoc; lines?: VoLine[] | null; filmLang: FilmLang; edition: Edition; aspect: '16x9' | '9x16';
  /** filled by calculateMetadata */ film?: ResolvedFilm; timeline?: TimelineJson;
  audio?: boolean; captions?: boolean;
  /** where calculateMetadata looks for lines.json when `lines` is not passed (public path; default run/stages/vo/lines.json) */ linesPath?: string;
};

export const FilmComposition: React.FC<FilmCompProps> = (p) => {
  const film = p.film ?? layoutFilm(p.scenes, {filmLang: p.filmLang, edition: p.edition, lines: p.lines ?? null});
  return <SceneRenderer film={film} ground={(p.scenes.ground ?? 'soft') as GroundKind} audio={p.audio !== false} captions={p.captions !== false} captionBottom={p.scenes.captions?.bottom} />;
};

const tryLines = async (path: string): Promise<VoLine[] | null> => {
  try {
    const r = await fetch(staticFile(path));
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) ? (j as VoLine[]) : null;
  } catch { return null; }
};

export const calcFilm: CalculateMetadataFunction<FilmCompProps> = async ({props}) => {
  const lines = props.lines !== undefined ? props.lines : await tryLines(props.linesPath ?? 'run/stages/vo/lines.json');
  const film = layoutFilm(props.scenes, {filmLang: props.filmLang, edition: props.edition, lines});
  const size = FORMATS[`${props.edition}-${props.aspect}` as keyof typeof FORMATS];
  const comp = `${props.edition}-${props.aspect}-${props.filmLang}`;
  return {durationInFrames: Math.max(1, film.frames), fps: film.fps, width: size.width, height: size.height,
    props: {...props, lines, film, timeline: timelineOf(film, `${props.edition}-${props.aspect}`, size, comp)}};
};

/** the <Composition> set for a run (Root.tsx: `<>{filmCompositions({scenes})}</>`) */
export const filmCompositions = (o: {scenes: ScenesDoc; editions?: Edition[]; aspects?: ('16x9' | '9x16')[]; langs?: FilmLang[]; fullAspects?: ('16x9' | '9x16')[]}) => {
  const langs = o.langs ?? o.scenes.languages ?? ['en', 'ja', 'en-jasub'];
  const out: React.ReactElement[] = [];
  for (const edition of o.editions ?? ['short', 'full']) {
    const aspects = edition === 'full' ? o.fullAspects ?? ['16x9'] : o.aspects ?? ['16x9', '9x16'];
    for (const aspect of aspects) for (const filmLang of langs) {
      const id = `${edition}-${aspect}-${filmLang}`;
      const size = FORMATS[`${edition}-${aspect}` as keyof typeof FORMATS];
      out.push(<Composition key={id} id={id} component={FilmComposition} width={size.width} height={size.height} fps={o.scenes.fps ?? 30} durationInFrames={300}
        defaultProps={{scenes: o.scenes, filmLang, edition, aspect}} calculateMetadata={calcFilm} />);
    }
  }
  return out;
};
