#!/usr/bin/env node
// Stage 6 · one Seedance clip via fal's queue: cost estimate first, submit ONCE, record the request id, poll, download, QC sheet.
//
//   node footage/seedance.mjs --prompt "…" --out assets/footage/<id>.mp4 [--endpoint text|image|reference] [--ref-image a.jpg]…
//        [--image first.jpg] [--duration 4] [--resolution 720p] [--aspect 16:9] [--seed 424242] [--model bytedance/seedance-2.5]
//        [--audio] [--timeout 900] [--ws DIR] [--dry-run] [--resume assets/footage/<id>.mp4.request.json] [--no-qc]
//
// Model ids that worked: bytedance/seedance-2.5/reference-to-video and bytedance/seedance-2.5/text-to-video; 720p, duration "4",
// 16:9, generate_audio false, a fixed seed per run for consistency. Default model: Seedance 2.5 (pass --model bytedance/seedance-2.0
// for 2.0; that id is not verified here).
// Likeness policy: photoreal reference images of people are REJECTED; @Image1 = a stylised character reference the run supplies,
// humans are text-only descriptions + a fixed seed. Expect roughly 1 usable clip in 3: the QC sheet + checklist
// (qc/qc.py footage) runs after every download — reversed screens, clay/CG humans, wrong scale, extra people.
// Cost (fal's formula, prices.json): tokens = W x H x seconds x 24 / 1024, $0.0214 per 1k at 480p/720p ($0.0234 at 1080p):
// 4 s 720p 16:9 ~ $1.85. Reserved BEFORE the submit; committed with the delivered clip's measured cost and the request id.
// The submit is never retried once fal accepted it (a second submit is a second bill): if polling times out, re-run with --resume.
// Mock: a placeholder clip of the requested length / size (or --mock-from an existing clip). FAL_KEY from env, never printed.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, basename, extname } from 'node:path';
import { parseArgs } from 'node:util';
import { Paid, PRICES, wsRoot, key, guardNetwork, fail, diskGuard, SCRIPTS } from '../common/paid.mjs';

const { values: a } = parseArgs({ options: {
  prompt: { type: 'string' }, out: { type: 'string' }, endpoint: { type: 'string' }, 'ref-image': { type: 'string', multiple: true, default: [] },
  image: { type: 'string' }, duration: { type: 'string', default: '4' }, resolution: { type: 'string', default: '720p' }, aspect: { type: 'string', default: '16:9' },
  seed: { type: 'string' }, model: { type: 'string', default: 'bytedance/seedance-2.5' }, audio: { type: 'boolean', default: false },
  timeout: { type: 'string', default: '900' }, ws: { type: 'string' }, 'dry-run': { type: 'boolean', default: false }, resume: { type: 'string' },
  'mock-from': { type: 'string' }, 'no-qc': { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' },
} });
if (a.help || (!a.resume && (!a.prompt || !a.out))) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); process.exit(a.help ? 0 : 2);
}
const ws = wsRoot(a.ws); const rp = (p) => (p.startsWith('/') ? p : join(ws, p));
const PX = { '480p': 480, '720p': 720, '1080p': 1080 };
function dims(res, aspect) {
  const h = PX[res] || 720; const [x, y] = (aspect === 'auto' ? '16:9' : aspect).split(':').map(Number);
  return x >= y ? [Math.round(h * x / y / 2) * 2, h] : [h, Math.round(h * y / x / 2) * 2];
}
const costOf = (w, h, s, res) => Math.round((w * h * s * 24 / 1024) / 1000 * (PRICES.fal.seedance_2_5_usd_per_1k_tokens[res] ?? 0.0234) * 10000) / 10000;
const dataUri = (p) => `data:image/${extname(p).slice(1).replace('jpg', 'jpeg')};base64,${readFileSync(rp(p)).toString('base64')}`;
function probe(p) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=width,height,nb_read_frames:format=duration', '-of', 'json', p], { encoding: 'utf8' });
  const j = JSON.parse(r.stdout || '{}'); const s = j.streams?.[0] || {};
  return { width: s.width, height: s.height, frames: Number(s.nb_read_frames), duration: Number(j.format?.duration) };
}
function qc(clip) {
  if (a['no-qc']) return null;
  const r = spawnSync(join(SCRIPTS, 'py'), ['qc/qc.py', 'footage', '--ws', ws, '--clip', clip], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout.trim().split('\n').pop()) : `qc failed: ${(r.stderr || '').slice(-200)}`;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll(req, k, deadline) {
  for (;;) {
    const s = await (await fetch(req.status_url, { headers: { Authorization: `Key ${k}` } })).json();
    if (s.status === 'COMPLETED') return (await (await fetch(req.response_url, { headers: { Authorization: `Key ${k}` } })).json());
    if (s.status === 'FAILED' || s.error) throw Object.assign(new Error(`fal job failed: ${JSON.stringify(s).slice(0, 300)}`), { failedJob: true });
    if (Date.now() > deadline) throw Object.assign(new Error(`still ${s.status} after the timeout; resume later with --resume ${req.file}`), { pending: true });
    await sleep(10000);
  }
}

try {
  const paid = new Paid(ws, 'assets');
  diskGuard(ws, 'the clip');
  if (a.resume) {
    const req = JSON.parse(readFileSync(rp(a.resume), 'utf8')); guardNetwork('fal'); const k = key('fal');
    const r = await poll({ ...req, file: a.resume }, k, Date.now() + Number(a.timeout) * 1000);
    const out = req.out; const buf = Buffer.from(await (await fetch(r.video.url)).arrayBuffer()); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, buf);
    const p = probe(out); const usd = costOf(p.width, p.height, p.duration, req.resolution); paid.commit(req.ledgerId, usd, req.request_id, 'done');
    console.log(JSON.stringify({ out, ...p, usd, requestId: req.request_id, qc: qc(out) })); process.exit(0);
  }
  const out = rp(a.out); const endpoint = a.endpoint || (a['ref-image'].length ? 'reference' : (a.image ? 'image' : 'text'));
  const secs = Number(a.duration); if (!(secs >= 4 && secs <= 30)) throw new Error('--duration must be 4-30 s');
  const [w, h] = dims(a.resolution, a.aspect); const est = costOf(w, h, secs, a.resolution);
  const body = { prompt: a.prompt, resolution: a.resolution, duration: String(secs), generate_audio: !!a.audio };
  if (endpoint !== 'image') body.aspect_ratio = a.aspect;
  if (endpoint === 'reference') body.image_urls = a['ref-image'].map(dataUri);
  if (endpoint === 'image') body.image_url = dataUri(a.image);
  if (a.seed) body.seed = Number(a.seed);
  const url = `https://queue.fal.run/${a.model}/${endpoint}-to-video`;
  if (!/seedance-2\.(5|0)/.test(a.model)) throw new Error(`Seedance must be 2.5 (at worst 2.0); got ${a.model}`);
  if (a['dry-run']) { console.log(JSON.stringify({ dryRun: true, url, estimateUsd: est, size: [w, h], seconds: secs, body: { ...body, image_urls: body.image_urls?.map((u) => u.slice(0, 40) + '…'), image_url: body.image_url?.slice(0, 40) } }, null, 1)); process.exit(0); }
  if (paid.mock) {
    mkdirSync(dirname(out), { recursive: true });
    if (a['mock-from']) copyFileSync(rp(a['mock-from']), out);
    else spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}:r=24:d=${secs}`, '-vf', 'hue=s=0.35', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-an', out], { stdio: 'inherit' });
    paid.mockRecord(`seedance ${basename(out)} ${endpoint} ${secs}s ${a.resolution} (est $${est})`);
    const p = probe(out); console.log(JSON.stringify({ out, ...p, mock: true, estimateUsd: est, qc: qc(out) })); process.exit(0);
  }
  guardNetwork('fal'); const k = key('fal');
  const id = paid.reserve('fal', `seedance ${basename(out)} ${endpoint} ${secs}s ${a.resolution} ${a.aspect}`, est);
  let req;
  try {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `Key ${k}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    const j = await r.json(); if (!r.ok || !j.request_id) { paid.commit(id, 0, null, 'failed'); throw new Error(`fal rejected the job (${r.status}): ${JSON.stringify(j).slice(0, 300)}`); }
    req = { request_id: j.request_id, status_url: j.status_url, response_url: j.response_url, model: a.model, endpoint, resolution: a.resolution, out, ledgerId: id, submitted: new Date().toISOString(), prompt: a.prompt, seed: body.seed ?? null };
    mkdirSync(dirname(out), { recursive: true }); writeFileSync(out + '.request.json', JSON.stringify(req, null, 1));
  } catch (e) { if (!req) { if (!String(e.message).startsWith('fal rejected')) paid.commit(id, est, null, 'failed'); } throw e; }
  let r;
  try { r = await poll({ ...req, file: out + '.request.json' }, k, Date.now() + Number(a.timeout) * 1000); }
  catch (e) { if (e.failedJob) paid.commit(id, 0, req.request_id, 'failed'); throw e; }       // pending: the reservation stays open for --resume
  if (!r.video?.url) { paid.commit(id, est, req.request_id, 'failed'); throw new Error(`no video in the response: ${JSON.stringify(r).slice(0, 300)}`); }
  writeFileSync(out, Buffer.from(await (await fetch(r.video.url)).arrayBuffer()));
  const p = probe(out); const usd = costOf(p.width, p.height, p.duration, a.resolution); paid.commit(id, usd, req.request_id, 'done');
  if (!(p.frames > 0) || Math.abs(p.duration - secs) > 0.6) console.error(`WARNING: clip is ${p.duration} s / ${p.frames} frames (asked ${secs} s)`);
  console.log(JSON.stringify({ out, ...p, usd, requestId: req.request_id, seed: r.seed ?? body.seed ?? null, qc: qc(out) }));
} catch (e) { fail(e); }
