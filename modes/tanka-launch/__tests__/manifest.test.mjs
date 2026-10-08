/**
 * The manifest and the stage machine must agree about which files are hash
 * inputs: a hashed file the viewer cannot see would make the canvas show
 * `changed` where tl.mjs shows `confirmed`.
 */
import { describe, expect, test } from "bun:test";

import manifest, { TL_WATCH_PATTERNS } from "../manifest.ts";
import { HASH_TEXT_PATTERNS, isHashText } from "../skill/scripts/lib/stage-state.mjs";

// Same semantics as Pneuma's core/sources/glob.ts::compileGlob.
function compileGlob(pattern) {
  let rx = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        rx += ".*";
        i += 1;
        if (pattern[i + 1] === "/") i += 1;
      } else rx += "[^/]*";
    } else if (ch === "?") rx += "[^/]";
    else if ("\\^$.|+()[]{}".includes(ch)) rx += `\\${ch}`;
    else rx += ch;
  }
  return new RegExp(`^${rx}$`);
}
const watched = (path) => TL_WATCH_PATTERNS.some((p) => compileGlob(p).test(path));

const SAMPLES = [
  "stages/script/options/A.json",
  "stages/script/brief.md",
  "stages/vo/lines.json",
  "stages/sound/soundmap.txt",
  "stages/finals/captions/en.srt",
  "stages/finals/captions/ja.vtt",
  "timeline.json",
  "timelines/short-16x9-ja.json",
  "remotion/scenes.json",
  "out/qc/roughcut-short-16x9-ja.json",
  "out/qc/final/short-9x16-en.json",
];

describe("manifest", () => {
  test("identity, backends and the skill", () => {
    expect(manifest.name).toBe("tanka-launch");
    expect(manifest.supportedBackends).toEqual(["claude-code", "codex"]);
    expect(manifest.skill.installName).toBe("pneuma-tanka-launch");
    expect(manifest.skill.envMapping.FAL_KEY).toBe("falApiKey");
    expect(manifest.skill.envMapping.ELEVENLABS_API_KEY).toBe("elevenLabsApiKey");
    const names = manifest.init.params.map((p) => p.name);
    for (const n of ["elevenLabsApiKey", "falApiKey", "openrouterApiKey", "figmaToken", "assetRoots", "prdRoot", "deliveryDir", "budgetUsd", "countdownMin", "codexPath", "mock"]) {
      expect(names).toContain(n);
    }
    for (const p of manifest.init.params.filter((p) => /Key$|Token$/.test(p.name))) expect(p.sensitive).toBe(true);
  });

  test("every watch pattern ends in a literal extension", () => {
    for (const p of TL_WATCH_PATTERNS) expect(p).toMatch(/\.[a-z]+$/);
  });

  test("every hash input is watched, and the samples are hash inputs", () => {
    for (const path of SAMPLES) {
      expect(isHashText(path)).toBe(true);
      expect(watched(path)).toBe(true);
    }
    expect(HASH_TEXT_PATTERNS.length).toBeGreaterThan(0);
    // Media and the film's own files are never hash inputs.
    for (const path of ["stages/music/options/A-demo.mp3", "out/roughcut/short-16x9-ja.mp4", "film.json", "ledger.jsonl"]) {
      expect(isHashText(path)).toBe(false);
    }
  });

  test("deriveParams gives truthy flags without leaking key values", () => {
    const d = manifest.init.deriveParams({ falApiKey: "secret", mock: "on" });
    expect(d.falConfigured).toBe("true");
    expect(d.elevenLabsMissing).toBe("true");
    expect(d.mockEnabled).toBe("true");
    for (const [k, v] of Object.entries(d)) if (k !== "falApiKey") expect(v).not.toBe("secret");
  });
});

describe("seed", () => {
  test("seed/film.json is what createFilm writes for an empty run", async () => {
    const { createFilm } = await import("../skill/scripts/lib/film.mjs");
    const seed = JSON.parse(await Bun.file(new URL("../seed/film.json", import.meta.url)).text());
    const fresh = createFilm({}, { now: Date.parse(seed.run.createdAt) });
    expect(seed).toEqual(fresh);
    expect(seed.run.brief.idea).toBe("");
  });
});
