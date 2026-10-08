// The budget gate for paid calls made from .mjs scripts (same rules as common/paid.py; contracts §3-§4).
//   reserve BEFORE the request (`tl.mjs ledger reserve … --usd <est>`; exit 3 = over the cap -> exit 3 here),
//   commit after it with the actual cost and the provider's request id; failures commit status=failed.
// Mock mode (TL_MOCK=1 or film.json settings.mock) never calls a provider; TL_NO_NETWORK=1 makes a provider call a hard error.
// Keys only from env (FAL_KEY, OPENROUTER_API_KEY, ELEVENLABS_API_KEY); never printed.
import * as fs from 'node:fs';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCRIPTS = dirname(HERE);
export const PRICES = JSON.parse(readFileSync(join(HERE, 'prices.json'), 'utf8'));
const KEYS = { elevenlabs: 'ELEVENLABS_API_KEY', fal: 'FAL_KEY', openrouter: 'OPENROUTER_API_KEY' };

export function wsRoot(arg) {
  if (arg) return resolve(arg);
  if (process.env.TL_WS) return resolve(process.env.TL_WS);
  let d = process.cwd();
  for (;;) { if (existsSync(join(d, 'film.json'))) return d; const p = dirname(d); if (p === d) return process.cwd(); d = p; }
}
export function film(ws) { const p = join(ws, 'film.json'); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}; }
const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());
// env TL_MOCK when set (on|1|true|yes = on, anything else = off), else film.json settings.mock (`tl.mjs mock on|off` changes it)
export function isMock(ws) {
  const e = process.env.TL_MOCK;
  if (e !== undefined && e !== '') return truthy(e);
  const m = film(ws).settings?.mock;
  return m === true || truthy(m);
}
// a key from the process env, else the installed skill's .env (Pneuma writes it from the init params); never printed
export function skillEnv(name) {
  const v = (process.env[name] || '').trim();
  if (v) return v;
  try {
    for (const line of readFileSync(join(SCRIPTS, '..', '.env'), 'utf8').split('\n')) {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (m && m[1] === name) return m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
  return '';
}
export function key(provider) {
  const v = skillEnv(KEYS[provider]);
  if (!v) throw new Error(`${KEYS[provider]} is not set (Pneuma init params -> env). Not calling ${provider}.`);
  return v;
}
export function guardNetwork(provider) {
  if (process.env.TL_NO_NETWORK === '1') throw new Error(`TL_NO_NETWORK=1: refusing a real ${provider} call`);
}
function tl() {
  const p = process.env.TL_CLI || join(SCRIPTS, 'tl.mjs');
  if (!existsSync(p)) return null;
  const which = (b) => spawnSync('sh', ['-c', `command -v ${b}`], { encoding: 'utf8' }).stdout.trim();
  const rt = which('bun') || which('node') || process.execPath;
  return [rt, p];
}
function parseId(out) {
  out = (out || '').trim();
  try { const j = JSON.parse(out.split('\n').pop()); if (j && j.id) return j.id; } catch {}
  const m = out.match(/"id"\s*:\s*"([^"]+)"/) || out.match(/\bid[=: ]+([A-Za-z0-9_.:-]+)/);
  if (m) return m[1];
  if (out && !out.includes(' ')) return out;
  throw new Error(`could not read the ledger id from tl.mjs output: ${out.slice(0, 200)}`);
}

export class BudgetExceeded extends Error { constructor(m) { super(m); this.exitCode = 3; } }

export class Paid {
  constructor(ws, stage) { this.ws = ws; this.stage = stage; this.mock = isMock(ws); }
  cli(args) { const t = tl(); if (!t) return null; return spawnSync(t[0], [t[1], ...args], { cwd: this.ws, encoding: 'utf8' }); }
  reserve(provider, what, usd) {
    const r = this.cli(['ledger', 'reserve', '--stage', this.stage, '--provider', provider, '--what', what.slice(0, 200), '--usd', Number(usd).toFixed(4)]);
    if (r === null) {
      if (provider === 'mock' || this.mock) return this.fallback({ provider: 'mock', what, estimateUsd: 0, actualUsd: 0, status: 'done' });
      throw new Error('ledger unavailable (scripts/tl.mjs not found): refusing a paid call without the budget gate');
    }
    if (r.status === 3) throw new BudgetExceeded(`${(r.stdout + r.stderr).trim().slice(0, 400)} — the run is over its cap; stop and ask the producer`);
    if (r.status !== 0) throw new Error(`tl.mjs ledger reserve failed (${r.status}): ${(r.stderr || r.stdout).slice(0, 400)}`);
    return parseId(r.stdout);
  }
  commit(id, usd, requestId, status = 'done') {
    if (!id || String(id).startsWith('local-')) return;
    const args = ['ledger', 'commit', String(id), '--usd', Number(usd).toFixed(4), '--status', status];
    if (requestId) args.push('--request-id', String(requestId));
    const r = this.cli(args);
    if (r && r.status !== 0) console.error(`warning: ledger commit failed: ${(r.stderr || r.stdout).slice(0, 300)}`);
  }
  mockRecord(what) { const id = this.reserve('mock', what, 0); this.commit(id, 0, 'mock', 'done'); return id; }
  fallback(rec) {
    const id = 'local-' + randomUUID().slice(0, 10);
    appendFileSync(join(this.ws, 'ledger.jsonl'), JSON.stringify({ id, ts: new Date().toISOString(), stage: this.stage, requestId: null, via: 'paid.mjs (tl.mjs absent; mock only)', ...rec }) + '\n');
    return id;
  }
}

/** free space: warn under 5 GB, stop under 1.5 GB (TL_DISK_WARN_GB / TL_DISK_MIN_GB) */
export function diskGuard(path, what = 'writing') {
  let free = Infinity;
  try { const s = fs.statfsSync?.(path); if (!s) return free; free = (s.bavail * s.bsize) / 1e9; } catch { return free; }
  const warn = Number(process.env.TL_DISK_WARN_GB || 5), stop = Number(process.env.TL_DISK_MIN_GB || 1.5);
  if (free < stop) throw new Error(`DISK: only ${free.toFixed(1)} GB free (< ${stop} GB): stopping before ${what}`);
  if (free < warn) console.error(`DISK: ${free.toFixed(1)} GB free (< ${warn} GB) — clear old renders soon`);
  return free;
}

/** exit with the right code for a thrown error (3 = budget) */
export function fail(e) {
  console.error(e?.message || String(e));
  process.exit(e instanceof BudgetExceeded ? 3 : 1);
}
