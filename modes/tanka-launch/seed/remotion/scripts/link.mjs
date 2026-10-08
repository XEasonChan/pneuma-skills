// Make the run's Remotion project complete (idempotent):
//   kit/              a copy of the mode's launch-kit (from the installed skill: <run>/.claude/skills/<skill>/kit or
//                     <run>/.agents/skills/<skill>/kit, or $TL_KIT_DIR). A copy, not a link: the kit imports `remotion` and `react`,
//                     which must resolve from this project's node_modules, and a run keeps rendering the kit it was built with.
//                     Imported as `launch-kit` through a webpack alias (kitAlias) and the tsconfig `paths` entry.
//   node_modules      this project's own `npm install` (remotion, @remotion/cli, react). With $TL_NODE_MODULES set to an existing
//                     install, node_modules becomes a link to it instead (several runs can share one install).
//   public/kit        → kit/assets (the kit's neutral placeholders)
//   public/run/assets → ../../assets  ·  public/run/stages → ../../stages   (the run's footage, images, logo, VO takes)
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_DIR = path.resolve(HERE, '..');
export const KIT_DIR = path.join(HERE, 'kit');

const isKit = (d) => {
  try { return JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).name === 'launch-kit' && fs.existsSync(path.join(d, 'src', 'index.ts')); } catch { return false; }
};
/** the kit to copy from: $TL_KIT_DIR, else the installed skill's kit/ in the run workspace */
export const findKitSource = () => {
  if (process.env.TL_KIT_DIR) return isKit(process.env.TL_KIT_DIR) ? path.resolve(process.env.TL_KIT_DIR) : null;
  for (const root of ['.claude/skills', '.agents/skills']) {
    const dir = path.join(RUN_DIR, root);
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names.sort()) if (isKit(path.join(dir, n, 'kit'))) return path.join(dir, n, 'kit');
  }
  return null;
};

const inside = (p, dir) => p === dir || p.startsWith(dir + path.sep);
const link = (target, at) => {
  fs.mkdirSync(path.dirname(at), {recursive: true});
  try { const cur = fs.readlinkSync(at); if (path.resolve(path.dirname(at), cur) === path.resolve(target) && fs.existsSync(at)) return false; fs.unlinkSync(at); } catch { if (fs.existsSync(at)) return false; }
  // links inside the run workspace are relative (the run can move); a link to a shared install is absolute
  fs.symlinkSync(inside(path.resolve(target), RUN_DIR) ? path.relative(path.dirname(at), target) || '.' : path.resolve(target), at);
  return true;
};

/** webpack alias so `import … from 'launch-kit'` resolves to this run's kit copy (bundle({webpackOverride}) and remotion.config.ts) */
export const kitAlias = (config) => ({
  ...config,
  resolve: {...config.resolve, alias: {...(config.resolve?.alias ?? {}), 'launch-kit$': path.join(KIT_DIR, 'src', 'index.ts'), 'launch-kit/preview$': path.join(KIT_DIR, 'src', 'Preview.tsx'), 'launch-kit': path.join(KIT_DIR, 'src')}},
});

export const ensureLinks = ({quiet = false} = {}) => {
  // The mode's seed must stay link-free: Pneuma copies it into every new run.
  if (/[\\/]seed[\\/]remotion$/.test(HERE) && !fs.existsSync(path.join(RUN_DIR, 'film.json'))) throw new Error('this is the mode seed, not a run: create a run workspace and render there');
  const log = (...a) => { if (!quiet) console.log('[link]', ...a); };
  // 1. the kit copy
  const src = findKitSource();
  if (src) {
    fs.rmSync(KIT_DIR, {recursive: true, force: true});
    fs.cpSync(src, KIT_DIR, {recursive: true, filter: (p) => !/[\\/](node_modules|\.DS_Store)$/.test(p)});
    log('kit ←', src);
  } else if (!isKit(KIT_DIR)) throw new Error('launch-kit not found: install the mode skill into this workspace (Pneuma does) or set TL_KIT_DIR to <mode>/skill/kit');
  // 2. node_modules
  const nm = path.join(HERE, 'node_modules');
  if (!fs.existsSync(path.join(nm, 'remotion'))) {
    const shared = process.env.TL_NODE_MODULES;
    if (shared && fs.existsSync(path.join(shared, 'remotion'))) { if (link(shared, nm)) log('node_modules →', shared); }
    else throw new Error(`remotion is not installed: run \`npm install\` in ${HERE} (or set TL_NODE_MODULES to an existing install)`);
  }
  // 3. public/kit
  if (link(path.join(KIT_DIR, 'assets'), path.join(HERE, 'public', 'kit'))) log('public/kit →', path.join(KIT_DIR, 'assets'));
  // 4. public/run/{assets,stages} (only the dirs that exist in the run workspace)
  for (const d of ['assets', 'stages']) {
    const target = path.join(RUN_DIR, d);
    if (fs.existsSync(target) && link(target, path.join(HERE, 'public', 'run', d))) log(`public/run/${d} →`, target);
  }
  return {kitDir: KIT_DIR, nodeModules: fs.realpathSync(nm)};
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) ensureLinks();
