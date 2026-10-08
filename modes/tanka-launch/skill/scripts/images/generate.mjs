#!/usr/bin/env node
// Stage 6 · generate ONE image: Codex GPT Image (default) or the OpenRouter GPT Image fallback. Budget-gated, timed out, mockable.
//
//   node images/generate.mjs --prompt "…" | --prompt-file p.txt  --out assets/images/<name>.png
//        [--ref a.png]… [--provider codex|openrouter] [--aspect 16:9] [--quality high] [--timeout 420] [--ws DIR] [--dry-run]
//
// codex:      `codex exec --skip-git-repo-check --ephemeral -s workspace-write -m <TL_CODEX_MODEL|gpt-5.5> -C <tmpdir> [-i ref]… -`
//             with the prompt on STDIN (`-i` swallows positional args). Codex 0.144.6 has the image_generation feature (stable, on);
//             the configured default model needs a newer CLI, hence -m gpt-5.5. One image per call; a 420 s watchdog kills a hung
//             call (a batch once hung ~80 min). The image is taken from the temp dir (Codex is asked to save it there) or, failing
//             that, from ~/.codex/generated_images (newest file since the call started). Runs on the ChatGPT plan: ledger $0.
// openrouter: POST https://openrouter.ai/api/v1/images (openai/gpt-image-2.5-sunburst; -flare with --ref), OPENROUTER_API_KEY,
//             one request, no retries (a lost response may still be billed). Ledger estimate: $0.05 / 0.12 / 0.25 (low/medium/high).
// Mock (TL_MOCK=1 or film.json settings.mock): a gradient placeholder of the right aspect. Rules: stylised characters only (Seedance
// rejects photoreal faces later), real product UI is never generated (use the component library / Figma exports).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve, basename, extname } from 'node:path';
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { Paid, PRICES, wsRoot, key, guardNetwork, fail, diskGuard, skillEnv } from '../common/paid.mjs';

const { values: a } = parseArgs({ options: {
  prompt: { type: 'string' }, 'prompt-file': { type: 'string' }, out: { type: 'string' }, ref: { type: 'string', multiple: true, default: [] },
  provider: { type: 'string', default: 'codex' }, aspect: { type: 'string', default: '16:9' }, quality: { type: 'string', default: 'high' },
  timeout: { type: 'string', default: '420' }, ws: { type: 'string' }, 'dry-run': { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' },
} });
if (a.help || (!a.prompt && !a['prompt-file']) || !a.out) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); process.exit(a.help ? 0 : 2);
}
const ws = wsRoot(a.ws); const rp = (p) => (p.startsWith('/') ? p : join(ws, p));
const out = rp(a.out); const refs = a.ref.map(rp); const prompt = a.prompt ?? readFileSync(rp(a['prompt-file']), 'utf8');
const SIZES = { '16:9': [1536, 864], '9:16': [864, 1536], '1:1': [1024, 1024], '4:3': [1536, 1152], '3:4': [1152, 1536] };
const [W, H] = SIZES[a.aspect] || SIZES['16:9'];
// the Codex CLI: $TL_CODEX, else the mode's codexPath setting (TL_CODEX_PATH), else `codex` on PATH, else Homebrew's (macOS).
// A setting that is a bare name is looked up on PATH; a path that does not exist is skipped (e.g. /opt/homebrew/… on Linux).
const findBin = (x) => !x ? null : x.includes('/') ? (existsSync(x) ? x : null)
  : spawnSync('sh', ['-c', 'command -v "$1"', 'sh', x], { encoding: 'utf8' }).stdout.trim() || null;
const codexBin = findBin(process.env.TL_CODEX) || findBin(skillEnv('TL_CODEX_PATH')) || findBin('codex')
  || (process.platform === 'darwin' && existsSync('/opt/homebrew/bin/codex') ? '/opt/homebrew/bin/codex' : 'codex');
const codexModel = process.env.TL_CODEX_MODEL || 'gpt-5.5';
const est = a.provider === 'codex' ? PRICES.codex.image_usd_per_call : (PRICES.openrouter.gpt_image_usd_per_image[a.quality] ?? 0.25);
const paid = new Paid(ws, 'assets');
diskGuard(ws, 'the image');

function verify(p) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', p], { encoding: 'utf8' });
  const s = JSON.parse(r.stdout || '{}').streams?.[0]; if (!s?.width) throw new Error(`not an image: ${p}`); return { width: s.width, height: s.height };
}
function newest(dir, since) {
  if (!existsSync(dir)) return null; let best = null;
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); const st = statSync(p);
    if (st.isDirectory()) walk(p); else if (/\.(png|jpe?g|webp)$/i.test(f) && st.mtimeMs >= since && (!best || st.mtimeMs > best.t)) best = { p, t: st.mtimeMs }; } };
  walk(dir); return best?.p ?? null;
}
function codexArgs(dir) {
  return ['exec', '--skip-git-repo-check', '--ephemeral', '-s', 'workspace-write', '-m', codexModel, '-C', dir, ...refs.flatMap((r) => ['-i', join(dir, basename(r))]), '-'];
}
const codexPrompt = `${prompt.trim()}\n\nUse your image generation tool to create exactly ONE image (${a.aspect}, about ${W}x${H}). Save the final image as out.png in the current directory. Do not create or edit any other file. Reply with the file name only.`;

async function runCodex() {
  const dir = join(dirname(out), `.codex-${Date.now()}`); mkdirSync(dir, { recursive: true });
  for (const r of refs) copyFileSync(r, join(dir, basename(r)));
  const t0 = Date.now(); const ms = Number(a.timeout) * 1000;
  const code = await new Promise((res) => {
    const p = spawn(codexBin, codexArgs(dir), { stdio: ['pipe', 'pipe', 'pipe'] }); let killed = false;
    const timer = setTimeout(() => { killed = true; p.kill('SIGTERM'); setTimeout(() => p.kill('SIGKILL'), 5000); }, ms);
    p.stdout.on('data', () => {}); p.stderr.on('data', () => {});
    p.on('close', (c) => { clearTimeout(timer); res(killed ? 'timeout' : c); }); p.stdin.end(codexPrompt);
  });
  if (code === 'timeout') throw new Error(`codex exec timed out after ${a.timeout} s (watchdog); nothing was saved`);
  const img = newest(dir, t0) || newest(join(homedir(), '.codex', 'generated_images'), t0);
  if (!img) throw new Error(`codex exec exited ${code} without an image (is image_generation enabled? codex features list)`);
  mkdirSync(dirname(out), { recursive: true }); copyFileSync(img, out); rmSync(dir, { recursive: true, force: true });
  return { requestId: `codex-exec-${t0}`, source: img.includes('.codex') && !img.startsWith(dirname(out)) ? 'codex generated_images' : 'codex cwd' };
}
async function runOpenRouter() {
  guardNetwork('openrouter'); const k = key('openrouter');
  const model = refs.length ? 'openai/gpt-image-2.5-flare' : 'openai/gpt-image-2.5-sunburst';
  const body = { model, prompt, n: 1, quality: a.quality, output_format: 'png', aspect_ratio: a.aspect };
  if (refs.length) body.input_references = refs.map((r) => ({ type: 'image_url', image_url: { url: `data:image/${extname(r).slice(1).replace('jpg', 'jpeg')};base64,${readFileSync(r).toString('base64')}` } }));
  const res = await fetch('https://openrouter.ai/api/v1/images', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(Number(a.timeout) * 1000) });
  if (!res.ok) { const e = new Error(`OpenRouter Images API ${res.status}: ${(await res.text()).slice(0, 300)}`); e.status = res.status; throw e; }
  const j = await res.json(); const b64 = j.data?.[0]?.b64_json; if (!b64) throw new Error('OpenRouter returned no image');
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, Buffer.from(b64, 'base64'));
  return { requestId: j.id || res.headers.get('x-request-id') || res.headers.get('x-generation-id'), model, usage: j.usage };
}

try {
  if (a['dry-run']) {
    const cmd = a.provider === 'codex' ? { bin: codexBin, args: codexArgs('<tmpdir>'), stdin: codexPrompt } : { url: 'https://openrouter.ai/api/v1/images', model: refs.length ? 'openai/gpt-image-2.5-flare' : 'openai/gpt-image-2.5-sunburst', refs: refs.length };
    console.log(JSON.stringify({ dryRun: true, provider: a.provider, out, estimateUsd: est, request: cmd }, null, 1)); process.exit(0);
  }
  let info;
  if (paid.mock) {
    mkdirSync(dirname(out), { recursive: true });
    const vf = "geq=r='128+100*sin(X/W*3.14)':g='128+90*sin(Y/H*3.14)':b='190-60*sin((X+Y)/(W+H)*3.14)'";
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=gray:s=${W}x${H}:d=1`, '-vf', vf, '-frames:v', '1', out], { stdio: 'inherit' });
    paid.mockRecord(`image ${basename(out)} (${a.provider} placeholder)`); info = { requestId: 'mock', mock: true };
  } else {
    if (a.provider === 'codex' && !existsSync(codexBin)) throw new Error(`codex CLI not found (${codexBin}); use --provider openrouter`);
    guardNetwork(a.provider); if (a.provider === 'openrouter') key('openrouter');          // fail BEFORE reserving
    const id = paid.reserve(a.provider, `image ${basename(out)} ${a.aspect} ${a.quality}`, est);
    try { info = a.provider === 'codex' ? await runCodex() : await runOpenRouter(); }
    catch (e) { paid.commit(id, (e.status && e.status < 500) ? 0 : est, null, 'failed'); throw e; }
    paid.commit(id, est, info.requestId, 'done');
  }
  const dims = verify(out);
  writeFileSync(out.replace(/\.[a-z]+$/i, '.json'), JSON.stringify({ file: out, prompt, refs, provider: a.provider, model: a.provider === 'codex' ? codexModel : info.model, aspect: a.aspect, ...dims, ...info }, null, 1));
  console.log(JSON.stringify({ out, ...dims, provider: a.provider, requestId: info.requestId, mock: !!info.mock }));
} catch (e) { fail(e); }
