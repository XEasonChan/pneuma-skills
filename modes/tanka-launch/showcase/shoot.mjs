/**
 * Re-shoot the gallery pictures.
 *
 * They are screenshots, not artwork: a `--viewing` tanka-launch session over a
 * run that `viewer/fixtures/build-fixture.mjs` builds through the real tl.mjs
 * (a fictional product, ACME), driven through CDP and resampled to the
 * 1376 x 768 the launcher lays out. See README.md for the session and the
 * Chrome this expects.
 *
 *   bun modes/tanka-launch/showcase/shoot.mjs \
 *     --url "http://localhost:18497?session=<id>&mode=tanka-launch" \
 *     --out modes/tanka-launch/showcase [--cdp 19426]
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    out: { type: "string", default: "." },
    cdp: { type: "string", default: "19426" },
  },
});
if (!values.url) {
  console.error("shoot.mjs needs --url of a running --viewing session (see README.md)");
  process.exit(1);
}

const DSF = 2;
const VIEWPORT = { width: 1376, height: 768 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RAW_DIR = mkdtempSync(join(tmpdir(), "launch-showcase-raw-"));

const targets = await (await fetch(`http://127.0.0.1:${values.cdp}/json/list`)).json();
const target = targets.find((t) => t.type === "page");
if (!target) throw new Error(`no page target on CDP port ${values.cdp}`);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let nextId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  const entry = msg.id === undefined ? null : pending.get(msg.id);
  if (!entry) return;
  pending.delete(msg.id);
  if (msg.error) entry.reject(new Error(`${entry.method}: ${JSON.stringify(msg.error)}`));
  else entry.resolve(msg.result);
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params }));
  });
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "threw");
  return result.result.value;
}
/** Click the first button whose title or text starts with `needle`. */
async function click(needle) {
  const ok = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.title || '').startsWith(${JSON.stringify(needle)}) || x.textContent.trim().startsWith(${JSON.stringify(needle)}));
    if (!b) return false; b.click(); return true; })()`);
  if (!ok) throw new Error(`no button starting with "${needle}"`);
}
/** Seek the open stage page's player (the largest video on screen; node cards carry small ones). */
const seek = (s) =>
  evaluate(`(async () => {
    const area = (e) => { const r = e.getBoundingClientRect(); return r.width * r.height; };
    const v = [...document.querySelectorAll('video')].sort((a, b) => area(b) - area(a))[0]; if (!v) return 'no video';
    v.muted = true; v.pause();
    if (v.readyState < 1) await new Promise((r) => { v.addEventListener('loadedmetadata', r, { once: true }); setTimeout(r, 8000); });
    await new Promise((r) => { v.addEventListener('seeked', r, { once: true }); v.currentTime = ${s}; setTimeout(r, 8000); });
    return v.currentTime; })()`);

/** Capture the viewport (or a CSS-pixel rect of it) and resample to 1376 x 768 with ffmpeg. */
async function capture(name, rect = null) {
  await sleep(400);
  const raw = join(RAW_DIR, `${name}.png`);
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(raw, Buffer.from(data, "base64"));
  const px = (n) => Math.round(n * DSF);
  const vf = [rect ? `crop=${px(rect.w)}:${px(rect.h)}:${px(rect.x)}:${px(rect.y)}` : null, "scale=1376:768:flags=lanczos"].filter(Boolean).join(",");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-vf", vf, join(values.out, `${name}.png`)]);
  console.log(`  ${name}.png`);
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: DSF, mobile: false });
await send("Page.navigate", { url: values.url });
await sleep(10000);
await click("Collapse"); // the agent surface — this is a picture of the work
await sleep(800);

// hero — the whole run on the canvas: options per stage, the picked path, the rough cut waiting at the gate.
await click("Fit to screen");
await sleep(1500);
await capture("hero");

// highlight-gate — the rough cut, the one hard gate, parked on the lockup.
await click("★ Rough cut");
await sleep(2500);
console.log('  seek →', await seek(13.6));
await sleep(2000);
await capture("highlight-gate");

// highlight-music — three music options, each on its own BPM clock with a guide-VO demo.
await click("3 Music");
await sleep(2500);
await capture("highlight-music");

// highlight-script — three script options side by side, the countdown pick and the producer's pick.
await click("2 Script");
await sleep(2500);
await capture("highlight-script");

ws.close();
console.log("done");
process.exit(0);
