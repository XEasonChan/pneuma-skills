// The run's Remotion project (a copy of the mode's seed/remotion). `launch-kit` resolves to ./kit (copied from the installed skill by
// scripts/link.mjs); public/kit → kit/assets, public/run/{assets,stages} → the run workspace. Rendering goes through render.mjs, which
// applies the same alias; this file is for `remotion studio`.
import {Config} from '@remotion/cli/config';
import path from 'node:path';

Config.setVideoImageFormat('jpeg');
// 'angle' on macOS (the GPU); 'swangle' (SwiftShader) on a GPU-less Linux server; $REMOTION_GL overrides (same rule as render.mjs)
Config.setChromiumOpenGlRenderer((process.env.REMOTION_GL as 'angle' | 'swangle' | undefined) || (process.platform === 'darwin' ? 'angle' : 'swangle'));
Config.setConcurrency(4);
const KIT = path.join(process.cwd(), 'kit', 'src');
Config.overrideWebpackConfig((c) => ({...c, resolve: {...c.resolve, alias: {...(c.resolve?.alias ?? {}), 'launch-kit$': path.join(KIT, 'index.ts'), 'launch-kit/preview$': path.join(KIT, 'Preview.tsx'), 'launch-kit': KIT}}}));
