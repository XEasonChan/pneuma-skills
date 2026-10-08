/**
 * Workspace I/O for tl.mjs — the only module here that touches the disk.
 *
 * The pure rules live in stage-state.mjs / film.mjs / ledger.mjs so the
 * viewer runs the same code. This module reads the hashable texts exactly as
 * the viewer receives them, writes film.json atomically under a lock, and
 * drains the viewer's request inbox.
 */

import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { isHashText } from "./stage-state.mjs";
import { parseRequest } from "./film.mjs";

export const FILM_FILE = "film.json";
export const LEDGER_FILE = "ledger.jsonl";
export const REQUESTS_DIR = "requests";
export const APPLIED_DIR = "requests/applied";

/** The skill root: `<skill>/scripts/lib/io.mjs` → `<skill>`. */
export const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Where the run lives. Explicit flag, then TL_WORKSPACE, then Pneuma's home
 * root (the project root in a project session, the workspace in a quick one),
 * then the current directory.
 */
export function resolveWorkspace(flag) {
  const candidate = flag || process.env.TL_WORKSPACE || process.env.PNEUMA_HOME_ROOT || process.cwd();
  return resolve(candidate);
}

/**
 * Parse a dotenv file into a map. Parsed, never sourced: the file sits in the
 * workspace, and executing it would run whatever it holds.
 */
export function parseDotenv(text) {
  const out = {};
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (/^[A-Z_][A-Z0-9_]*$/i.test(key)) out[key] = value;
  }
  return out;
}

/**
 * The session environment: the skill's `.env` (written by Pneuma from the
 * init params through `envMapping`) under the process environment, which
 * wins. Values are only ever tested for presence or read as settings; no
 * key value is printed.
 */
export function loadEnv() {
  let fileEnv = {};
  const path = join(SKILL_ROOT, ".env");
  try {
    if (existsSync(path)) fileEnv = parseDotenv(readFileSync(path, "utf-8"));
  } catch {
    fileEnv = {};
  }
  return { ...fileEnv, ...process.env };
}

export function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
}

function walk(root, dir, out) {
  let entries;
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(root, rel, out);
    else if (entry.isFile()) out.push(rel);
  }
}

/**
 * Every hashable text file, keyed by workspace-relative path with `/`
 * separators — the same set the viewer receives through its watch patterns.
 */
export function readTexts(ws) {
  const paths = [];
  for (const dir of ["stages", "timelines", "out/qc"]) walk(ws, dir, paths);
  for (const file of ["timeline.json", "remotion/scenes.json"]) {
    if (existsSync(join(ws, file))) paths.push(file);
  }
  const texts = {};
  for (const rel of paths) {
    const norm = rel.split(sep).join("/");
    if (!isHashText(norm)) continue;
    try {
      texts[norm] = readFileSync(join(ws, rel), "utf-8");
    } catch {
      /* unreadable → treated like a missing file */
    }
  }
  return texts;
}

export function readFilm(ws) {
  const path = join(ws, FILM_FILE);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf-8");
  try {
    return JSON.parse(text);
  } catch (err) {
    const e = new Error(`film.json is not valid JSON: ${err instanceof Error ? err.message : err}`);
    e.exitCode = 1;
    throw e;
  }
}

/** Atomic write: a temp file beside the target, then rename. */
export function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  renameSync(tmp, path);
}

export function writeFilm(ws, film) {
  writeJsonAtomic(join(ws, FILM_FILE), film);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `fn` holding `.tl.lock` in the workspace, so two tl.mjs processes (the
 * agent and a sub-agent, say) never interleave read-modify-write of
 * film.json or the ledger. A lock older than 30 s is a crashed process.
 */
export function withLock(ws, fn) {
  const lock = join(ws, ".tl.lock");
  const started = Date.now();
  let fd = null;
  while (fd === null) {
    try {
      fd = openSync(lock, "wx");
    } catch (err) {
      if (err && err.code !== "EEXIST") throw err;
      try {
        if (Date.now() - statSync(lock).mtimeMs > 30000) unlinkSync(lock);
      } catch {
        /* raced with the owner releasing it */
      }
      if (Date.now() - started > 10000) {
        const e = new Error("film.json is locked by another tl.mjs process (.tl.lock); try again");
        e.exitCode = 1;
        throw e;
      }
      sleep(50);
    }
  }
  try {
    return fn();
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* already closed */
    }
    try {
      unlinkSync(lock);
    } catch {
      /* already gone */
    }
  }
}

/** Pending viewer requests: `requests/*.json`, parsed; unreadable ones reported. */
export function readRequests(ws) {
  const dir = join(ws, REQUESTS_DIR);
  const pending = [];
  const invalid = [];
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return { pending, invalid };
  }
  for (const name of names.sort()) {
    const file = join(dir, name);
    try {
      if (!statSync(file).isFile()) continue;
      const req = parseRequest(JSON.parse(readFileSync(file, "utf-8")), name.replace(/\.json$/, ""));
      if (req) pending.push({ ...req, file: `${REQUESTS_DIR}/${name}` });
      else invalid.push({ file: `${REQUESTS_DIR}/${name}`, error: "not a pick / approve / autorun request" });
    } catch (err) {
      invalid.push({ file: `${REQUESTS_DIR}/${name}`, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { pending, invalid };
}

/** Move a handled request to `requests/applied/` with its outcome. */
export function archiveRequest(ws, relFile, outcome) {
  const src = join(ws, relFile);
  let body = {};
  try {
    body = JSON.parse(readFileSync(src, "utf-8"));
  } catch {
    body = { unreadable: true };
  }
  const dst = join(ws, APPLIED_DIR, relFile.split("/").pop());
  writeJsonAtomic(dst, { ...body, appliedAt: new Date().toISOString(), outcome });
  try {
    unlinkSync(src);
  } catch {
    /* already moved */
  }
}

export function readLedgerText(ws) {
  const path = join(ws, LEDGER_FILE);
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

export function appendLedger(ws, entry) {
  appendFileSync(join(ws, LEDGER_FILE), `${JSON.stringify(entry)}\n`, "utf-8");
}

export function relPath(ws, abs) {
  return relative(ws, abs).split(sep).join("/");
}
