/**
 * tl.mjs end to end in a temp workspace: the budget cap (exit 3), the ledger,
 * and the viewer's request inbox being drained by `tick`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { checkReserve, parseLedger, summarizeLedger } from "../skill/scripts/lib/ledger.mjs";

const TL = resolve(import.meta.dir, "../skill/scripts/tl.mjs");
let ws;

function tl(...args) {
  // cwd pinned to the temp workspace and a clean env: Bun loads a cwd `.env`
  // on its own, and a stray key or TL_* variable must not leak in.
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TL_WORKSPACE: ws };
  const proc = Bun.spawnSync([process.execPath, "--env-file=/dev/null", TL, ...args], { cwd: ws, env });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}
const film = () => JSON.parse(readFileSync(join(ws, "film.json"), "utf-8"));

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "tl-cli-"));
});
afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
});

describe("ledger (pure)", () => {
  test("reserved counts its estimate, done its actual, failed its actual or zero", () => {
    const lines = [
      { id: "a", status: "reserved", stage: "music", provider: "elevenlabs", estimateUsd: 4 },
      { id: "a", status: "done", actualUsd: 3.5 },
      { id: "b", status: "reserved", stage: "assets", provider: "fal", estimateUsd: 10 },
      { id: "c", status: "reserved", stage: "vo", provider: "elevenlabs", estimateUsd: 2 },
      { id: "c", status: "failed", actualUsd: null },
    ].map((l) => JSON.stringify(l));
    const s = summarizeLedger(parseLedger(`${lines.join("\n")}\nnot json\n`).entries, 60);
    expect(s.spentUsd).toBe(13.5);
    expect(s.reservedUsd).toBe(10);
    expect(s.open).toBe(1);
    expect(s.byStage).toEqual({ music: 3.5, assets: 10, vo: 0 });
    expect(checkReserve(s, 46.5).ok).toBe(true);
    expect(checkReserve(s, 46.51).ok).toBe(false);
  });
});

describe("tl.mjs", () => {
  test("init, status, and a second init refused without --force", () => {
    const r = tl("init", "--idea", "ACME remembers every thread", "--budget", "20");
    expect(r.code).toBe(0);
    expect(film().settings.budgetUsd).toBe(20);
    expect(tl("status").stdout).toContain("Idea            confirmed");
    const again = tl("init", "--idea", "another");
    expect(again.code).toBe(2);
  });

  test("the budget cap: within → id, over → exit 3, auto-run off and the stage blocked", () => {
    tl("init", "--idea", "x", "--budget", "10");
    expect(tl("autorun", "on").code).toBe(0);
    const ok = tl("ledger", "reserve", "--stage", "music", "--provider", "elevenlabs", "--what", "bed", "--usd", "6");
    expect(ok.code).toBe(0);
    const { id } = JSON.parse(ok.stdout.trim().split("\n").pop());
    expect(id).toMatch(/^L/);
    expect(tl("ledger", "commit", id, "--usd", "5.5", "--request-id", "req-1").code).toBe(0);

    const over = tl("ledger", "reserve", "--stage", "music", "--provider", "elevenlabs", "--what", "second bed", "--usd", "4.51");
    expect(over.code).toBe(3);
    expect(JSON.parse(over.stdout.trim()).error).toBe("over-budget");
    expect(film().autoRun.enabled).toBe(false);
    expect(film().stages.music.state).toBe("blocked");

    const fits = tl("ledger", "reserve", "--stage", "music", "--provider", "elevenlabs", "--what", "small", "--usd", "4.5");
    expect(fits.code).toBe(0);
    const summary = JSON.parse(tl("ledger", "summary", "--json").stdout);
    expect(summary.spentUsd).toBe(10);
    expect(summary.capUsd).toBe(10);
  });

  test("mock mode records provider mock at 0 USD", () => {
    tl("init", "--idea", "x", "--budget", "1", "--mock", "on");
    const r = tl("ledger", "reserve", "--stage", "vo", "--provider", "elevenlabs", "--what", "take", "--usd", "50");
    expect(r.code).toBe(0);
    const rec = parseLedger(readFileSync(join(ws, "ledger.jsonl"), "utf-8")).entries[0];
    expect(rec.provider).toBe("mock");
    expect(rec.estimateUsd).toBe(0);
  });

  test("a viewer request in requests/ is applied by tick and archived with its outcome", () => {
    tl("init", "--idea", "x");
    mkdirSync(join(ws, "stages/script/options"), { recursive: true });
    writeFileSync(join(ws, "stages/script/options/A.json"), '{"id":"A"}');
    writeFileSync(join(ws, "stages/script/options/B.json"), '{"id":"B"}');
    writeFileSync(
      join(ws, "opts.json"),
      JSON.stringify([
        { id: "A", title: "A", files: ["stages/script/options/A.json"] },
        { id: "B", title: "B", recommended: true, files: ["stages/script/options/B.json"] },
      ]),
    );
    expect(tl("options", "set", "script", "--file", "opts.json").code).toBe(0);
    mkdirSync(join(ws, "requests"), { recursive: true });
    writeFileSync(
      join(ws, "requests/r1.json"),
      JSON.stringify({ id: "r1", action: "pick", stage: "script", option: "A", by: "producer", requestedAt: new Date().toISOString() }),
    );
    expect(tl("status").stdout).toContain("Pending requests from the viewer: 1");
    const tick = tl("tick");
    expect(tick.code).toBe(0);
    expect(tick.stdout).toContain("Script: picked A (The producer)");
    expect(film().stages.script.pick).toBe("A");
    expect(existsSync(join(ws, "requests/r1.json"))).toBe(false);
    const archived = JSON.parse(readFileSync(join(ws, "requests/applied/r1.json"), "utf-8"));
    expect(archived.outcome.ok).toBe(true);
  });

  test("refusals exit 2: locked stage, auto pick of the rough cut", () => {
    tl("init", "--idea", "x");
    expect(tl("pick", "music", "A").code).toBe(2);
    expect(tl("approve", "roughcut", "--by", "auto").code).toBe(2);
    expect(tl("pick", "roughcut", "A", "--by", "auto-run").code).toBe(2);
    expect(tl("bogus").code).toBe(1);
  });

  test("works under Node as well as Bun", () => {
    const node = Bun.which("node");
    if (!node) return;
    const proc = Bun.spawnSync([node, TL, "init", "--idea", "node run"], {
      cwd: ws,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TL_WORKSPACE: ws },
    });
    expect(proc.exitCode).toBe(0);
    expect(readdirSync(ws)).toContain("film.json");
  });
});
