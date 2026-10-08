// launch-kit · asset resolver.
// Kit assets (the neutral placeholders in kit/assets/) are served to Remotion under `public/kit/` of the run's project (a symlink made by
// render.mjs / `node scripts/link.mjs`). The run's own files (footage, VO, images, its logo) are served under `public/run/`.
// A path that starts with `run/` or an absolute URL passes through untouched.
import {staticFile} from 'remotion';

export const KIT_PREFIX = 'kit';
export const kitFile = (p: string): string => {
  if (/^(https?:|data:|blob:)/.test(p)) return p;
  const clean = p.replace(/^\/+/, '');
  if (clean.startsWith('run/') || clean.startsWith(KIT_PREFIX + '/')) return staticFile(clean);
  return staticFile(`${KIT_PREFIX}/${clean}`);
};
/** the run's own files (footage, VO mp3s, generated images): `runFile('assets/footage/x.mp4')` → public/run/assets/footage/x.mp4 */
export const runFile = (p: string): string => (/^(https?:|data:|blob:)/.test(p) ? p : staticFile(`run/${p.replace(/^\/+/, '').replace(/^run\//, '')}`));
/** a scene prop that may be a kit path ('kit:avatars/x.png'), a run path ('run:assets/x.mp4' or a bare path) or a URL */
export const assetSrc = (p: string): string => (p.startsWith('kit:') ? kitFile(p.slice(4)) : p.startsWith('run:') ? runFile(p.slice(4)) : /^(https?:|data:|blob:)/.test(p) ? p : runFile(p));
