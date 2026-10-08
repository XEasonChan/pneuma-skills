// launch-kit — the reusable Remotion kit of the Pneuma mode `tanka-launch` (Launch Studio): a scene grammar (scenes.json → typed
// scenes → one composition per format × language), the renderer, captions, a neutral ground, hand-off primitives and a few generic
// scene types. A run adds its own scenes (its product UI, its story) in remotion/src/custom/. See README.md.

// core
export * from './core/text';
export * from './core/motion';
export * from './core/film';
export * from './assets';
// theme + brand settings
export * from './brand/tokens';
export * from './brand/assistant';
// ground, captions, hand-offs
export * from './ground/Ground';
export * from './captions/Captions';
export * from './handoff';
// grammar + renderer
export * from './grammar';
export * from './layout';
export {SceneRenderer, type SceneRendererProps} from './SceneRenderer';
export {FilmComposition, filmCompositions, type FilmCompProps} from './compositions';
// scenes (importing registers them) + shared scene helpers for custom scenes
export * from './scenes';
export * from './scenes/common';
// QC helpers
export {lintNames, formatNameWarnings, type NameWarning} from './lint/names';
