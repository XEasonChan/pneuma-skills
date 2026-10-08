#!/usr/bin/env node
// Render the run's picture (the VO-only master):  node render.mjs <comp>[,<comp>…] [--scale 0.5] [--frames 0-89] [--stills 0,45,3s] [--crf 20]
//                                                  [--no-audio] [--cache] [--out <file>]
//   <comp> = <format>-<lang> = short-16x9-en | short-16x9-ja | short-16x9-en-jasub | short-9x16-… | full-16x9-…  (`--list` lists them).
//   Several comps in one call share ONE bundle (faster, one bundle on disk).
// NAMING RULE (one rule for every script and the viewer): a version is `<format>-<lang>` (format = <edition>-<aspect>, lang = ja|en|en-jasub);
//   its files are out/picture/<key>.mp4 (this script: VO + the render's own audio, no music), out/roughcut/<key>.mp4 (mix/mix.py),
//   out/final/<key>.mp4, out/qc/<roughcut|final>-<key>.json. The render scale is NOT in the name: it is recorded in the sidecar
//   out/picture/<key>.json ({comp, format, lang, scale, width, height, compWidth, compHeight, frames, fps, durationS}).
// Also writes timelines/<key>.json (this version's clock, contracts §5, "units": "frames") and ../timeline.json (formats of every rendered
//   version, keyed by <key>; scenes/tracks = the lead version: the brief's first format × first language, else the last render). The music
//   and SFX tracks are filled in later by mix/mix.py. Verifies every file with ffprobe (frames, size = comp × scale, audio when VO).
// Inputs: ./scenes.json ("units": "seconds" default | "frames"), ../stages/vo/lines.json (optional). Frame-deterministic; no network.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {ensureLinks, kitAlias, HERE} from './scripts/link.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes(name);
const compArg = args.find((a, i) => !a.startsWith('--') && !['--scale', '--frames', '--crf', '--out', '--concurrency', '--stills'].includes(args[i - 1]));
const comps = compArg ? compArg.split(',').filter(Boolean) : [];

// Never render inside the mode's seed: links and a bundle there would be copied into every new run (or refused by the seed copier).
if (/\/seed\/remotion\/?$/.test(HERE) && !fs.existsSync(path.join(HERE, '..', 'film.json'))) { console.error('this is the mode seed, not a run: create a run workspace (Pneuma → New run) and render there'); process.exit(2); }

const {nodeModules} = ensureLinks({quiet: true});
const req = async (m) => import(path.join(nodeModules, m, 'dist', 'index.js'));
const {bundle} = await req('@remotion/bundler');
const {selectComposition, renderMedia, renderStill, getCompositions, openBrowser} = await req('@remotion/renderer');

const RUN = path.resolve(HERE, '..');
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const scenes = readJson(path.join(HERE, 'scenes.json'));
if (!scenes) { console.error('scenes.json missing or invalid'); process.exit(2); }
const lines = readJson(path.join(RUN, 'stages', 'vo', 'lines.json'));

const df = () => { try { return execFileSync('df', ['-k', HERE]).toString().trim().split('\n').pop().split(/\s+/)[3] * 1024; } catch { return Infinity; } };
const GB = (b) => (b / 1e9).toFixed(1) + ' GB';
if (df() < 1.5e9) { console.error(`only ${GB(df())} free: free some disk before rendering`); process.exit(3); }

// one bundle dir per project (reused; the public dir is symlinked, so the bundle stays small)
const outDir = path.join(HERE, '.bundle');
const film = readJson(path.join(RUN, 'film.json'));
const brief = film?.run?.brief ?? {};
const leadKey = brief.formats?.[0] && brief.languages?.[0] ? `${brief.formats[0]}-${brief.languages[0]}` : null;
const KEY_RE = /^(short|full)-(16x9|9x16)-(en-jasub|ja|en)$/;
fs.rmSync(outDir, {recursive: true, force: true}); // (our own bundle dir: the public dir's symlinks cannot be re-created in place)
console.log('[render] bundling …');
const serveUrl = await bundle({entryPoint: path.join(HERE, 'src', 'index.ts'), outDir, publicDir: path.join(HERE, 'public'), enableCaching: flag('--cache'), webpackOverride: kitAlias, onProgress: () => {}});
const inputProps = {lines: Array.isArray(lines) ? lines : null};

// chrome-headless-shell: $REMOTION_BROWSER, else the one `npx remotion browser ensure` put under node_modules/.remotion for this
// platform (mac-arm64 · mac-x64 · linux64 · linux-arm64, whose binary is `headless_shell`), else Remotion's own lookup.
const PLAT = process.platform === 'darwin' ? (process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64') : process.platform === 'linux' ? (process.arch === 'arm64' ? 'linux-arm64' : 'linux64') : null;
const shellIn = (nm) => PLAT && ['chrome-headless-shell', 'headless_shell'].map((b) => path.join(nm, '.remotion', 'chrome-headless-shell', PLAT, `chrome-headless-shell-${PLAT}`, b));
const browserExecutable = [process.env.REMOTION_BROWSER, ...(shellIn(nodeModules) || [])].find((p) => p && fs.existsSync(p)) ?? null;
// GL: $REMOTION_GL, else 'angle' on macOS (the GPU) and 'swangle' (SwiftShader, CPU WebGL) on a GPU-less Linux server
const chromiumOptions = {gl: process.env.REMOTION_GL || (process.platform === 'darwin' ? 'angle' : 'swangle')};

if (flag('--list') || !comps.length) {
  const all = await getCompositions(serveUrl, {inputProps, browserExecutable, chromiumOptions});
  for (const c of all) console.log(`${c.id.padEnd(28)} ${c.width}x${c.height} ${(c.durationInFrames / c.fps).toFixed(1)} s`);
  process.exit(0);
}

const scale = Number(opt('--scale', '1'));
const fr = opt('--frames');
const frameRange = fr ? fr.split('-').map(Number) : null;
if (opt('--out') && comps.length > 1) { console.error('--out takes one comp'); process.exit(1); }
let failed = 0;
for (const comp of comps) {
  if (!KEY_RE.test(comp)) console.warn(`[render] ${comp} is not a <format>-<lang> version key; its files will not appear on the canvas`);
  const composition = await selectComposition({serveUrl, id: comp, inputProps, browserExecutable, chromiumOptions});
  // --stills 0,45,90 (frames) or 1.5s,3s (seconds): JPEG stills into ../out/qc/stills/<comp>-<frame>.jpg (quick layout checks, no mp4)
  const stills = opt('--stills');
  if (stills) {
    const dir = path.join(RUN, 'out', 'qc', 'stills');
    fs.mkdirSync(dir, {recursive: true});
    const browser = await openBrowser('chrome', {browserExecutable, chromiumOptions});
    for (const x of stills.split(',')) {
      const frame = Math.min(composition.durationInFrames - 1, x.endsWith('s') ? Math.round(parseFloat(x) * composition.fps) : Number(x));
      const output = path.join(dir, `${comp}-${String(frame).padStart(5, '0')}.jpg`);
      await renderStill({serveUrl, composition, frame, output, inputProps: composition.props, scale, imageFormat: 'jpeg', jpegQuality: 85, puppeteerInstance: browser, chromiumOptions});
      console.log('[still]', path.relative(RUN, output));
    }
    await browser.close({silent: true});
    continue;
  }
  if (df() < 1.5e9) { console.error(`only ${GB(df())} free: free some disk before rendering`); process.exit(3); }
  const out = path.resolve(opt('--out', path.join(RUN, 'out', 'picture', `${comp}.mp4`)));
  fs.mkdirSync(path.dirname(out), {recursive: true});
  const hasVo = !flag('--no-audio') && (composition.props.film?.scenes ?? []).some((s) => s.vo.some((v) => v.file));
  console.log(`[render] ${comp} → ${path.relative(RUN, out)} · ${composition.width}x${composition.height} × ${scale} · ${composition.durationInFrames} f @ ${composition.fps} · ${hasVo ? 'VO' : 'no VO'} · ${GB(df())} free`);
  let last = -1;
  const t0 = Date.now();
  await renderMedia({
    serveUrl, composition, codec: 'h264', outputLocation: out, inputProps: composition.props, scale, crf: Number(opt('--crf', '20')),
    browserExecutable, chromiumOptions, concurrency: Number(opt('--concurrency', String(Math.max(2, Math.min(6, os.cpus().length - 2))))),
    frameRange: frameRange && frameRange.length === 2 ? frameRange : frameRange?.[0] ?? null, muted: !hasVo, imageFormat: 'jpeg', jpegQuality: 88,
    onProgress: ({progress}) => { const p = Math.floor(progress * 10); if (p !== last) { last = p; process.stdout.write(`\r[render] ${comp} ${Math.round(progress * 100)} %   `); } },
  });
  process.stdout.write('\n');

  // verify with ffprobe
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,nb_frames,r_frame_rate', '-of', 'json', out]).toString());
  const v = probe.streams.find((s) => s.codec_type === 'video'), a = probe.streams.find((s) => s.codec_type === 'audio');
  const frames = frameRange ? (frameRange.length === 2 ? frameRange[1] - frameRange[0] + 1 : 1) : composition.durationInFrames;
  const expW = Math.round(composition.width * scale), expH = Math.round(composition.height * scale);
  const dur = Number(probe.format.duration), expDur = frames / composition.fps;
  const problems = [];
  if (!v) problems.push('no video stream');
  else {
    if (Math.abs(v.width - expW) > 2 || Math.abs(v.height - expH) > 2) problems.push(`size ${v.width}x${v.height} ≠ ${expW}x${expH}`);
    if (v.nb_frames && Math.abs(Number(v.nb_frames) - frames) > 1) problems.push(`frames ${v.nb_frames} ≠ ${frames}`);
  }
  if (Math.abs(dur - expDur) > 2 / composition.fps + 0.05) problems.push(`duration ${dur.toFixed(3)} s ≠ ${expDur.toFixed(3)} s`);
  if (hasVo && !a) problems.push('VO expected but no audio stream');
  const size = fs.statSync(out).size;
  console.log(`[verify] ${v?.width}x${v?.height} · ${v?.nb_frames ?? '?'} frames · ${dur.toFixed(2)} s · ${a ? 'audio' : 'no audio'} · ${(size / 1e6).toFixed(1)} MB · ${((Date.now() - t0) / 1000).toFixed(0)} s · ${problems.length ? 'FAIL: ' + problems.join('; ') : 'OK'}`);
  if (problems.length) failed++;
  if (frameRange || opt('--out')) continue;          // partial / custom renders don't define the version

  // the sidecar (scale lives here, not in the name) + this version's clock + the merged timeline.json
  const [format, lang] = (() => { const m = KEY_RE.exec(comp); return m ? [`${m[1]}-${m[2]}`, m[3]] : [comp, '']; })();
  fs.writeFileSync(out.replace(/\.mp4$/, '.json'), JSON.stringify({comp, format, lang, file: path.relative(RUN, out), scale, width: v?.width, height: v?.height,
    compWidth: composition.width, compHeight: composition.height, frames, fps: composition.fps, durationS: +dur.toFixed(3), audio: !!a, verify: problems.length ? problems : 'ok',
    renderedAt: new Date().toISOString()}, null, 1));
  const tl = composition.props.timeline;
  if (tl) {
    // (no render scale in the clock: re-rendering at another scale must not change the file the rough-cut approval hashed)
    const vPath = path.join(RUN, 'timelines', `${comp}.json`);
    const prevV = readJson(vPath);
    // keep the music / SFX tracks mix.py wrote for this version when the clock did not move
    const same = prevV && prevV.formats?.[comp]?.frames === tl.formats[comp]?.frames;
    const version = {...tl, tracks: {...tl.tracks, bgm: same ? prevV.tracks?.bgm ?? [] : [], sfx: same ? prevV.tracks?.sfx ?? [] : []}};
    fs.mkdirSync(path.dirname(vPath), {recursive: true});
    fs.writeFileSync(vPath, JSON.stringify(version, null, 1));
    const tlPath = path.join(RUN, 'timeline.json');
    const prev = readJson(tlPath) ?? {};
    const lead = !leadKey || comp === leadKey || !prev.scenes || !(prev.formats ?? {})[leadKey];
    const merged = lead ? {...version, formats: {...(prev.formats ?? {}), ...version.formats}, lead: comp} : {...prev, units: 'frames', formats: {...(prev.formats ?? {}), ...version.formats}};
    fs.writeFileSync(tlPath, JSON.stringify(merged, null, 1));
    console.log(`[render] timelines/${comp}.json · ${tl.scenes.length} scenes · ${tl.tracks.vo.length} VO · ${tl.tracks.captions.length} captions${lead ? ' (lead → timeline.json)' : ''}`);
  }
}
process.exit(failed ? 1 : 0);
