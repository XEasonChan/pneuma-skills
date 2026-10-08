#!/usr/bin/env bun
/**
 * Build a run workspace for the canvas from these fixtures — through the
 * real stage machine (tl.mjs), so every hash, deadline and approval in the
 * resulting film.json is one tl.mjs itself wrote.
 *
 *   bun build-fixture.mjs <workspace> <scenario> [--no-media]
 *
 * Scenarios:
 *   fresh     the seed: an empty film.json
 *   midway    idea confirmed, script B picked by the producer, music awaiting (countdown running)
 *   roughcut  every stage to sound confirmed (countdown, the producer, auto-run); rough cuts
 *             rendered for three versions; the rough cut waits for the producer
 *   changed   roughcut + the picked script edited afterwards → script changed, the rest stale
 *   final     roughcut approved by the producer, finals rendered
 *
 * Media is generated into the workspace, never into the repo: the rough cuts
 * are ffmpeg test patterns, the beds are sine stand-ins and the voices are
 * macOS `say` (the same kind of stand-ins mock mode uses). No network, no
 * paid calls.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODE = resolve(HERE, "../..");
const TL = join(MODE, "skill/scripts/tl.mjs");
// Optional local media to make the screenshots richer (e.g. for showcase captures): FIXTURE_VIDEO_EN / FIXTURE_VIDEO_JA (MP4s),
// FIXTURE_BED_A|B|C (audio). Unset, everything is generated.
const SRC_EN = process.env.FIXTURE_VIDEO_EN ?? "";
const SRC_JA = process.env.FIXTURE_VIDEO_JA ?? "";
const BEDS = { A: process.env.FIXTURE_BED_A ?? "", B: process.env.FIXTURE_BED_B ?? "", C: process.env.FIXTURE_BED_C ?? "" };

const [wsArg, scenario = "midway", ...rest] = process.argv.slice(2);
if (!wsArg) {
  console.error("usage: bun build-fixture.mjs <workspace> <fresh|midway|roughcut|changed|final> [--no-media]");
  process.exit(1);
}
const WS = resolve(wsArg);
const MEDIA = !rest.includes("--no-media");
const SCENARIOS = ["fresh", "midway", "roughcut", "changed", "final"];
if (!SCENARIOS.includes(scenario)) {
  console.error(`unknown scenario "${scenario}" (${SCENARIOS.join(", ")})`);
  process.exit(1);
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts }).toString();
const tl = (...args) => {
  const out = run(process.execPath, [TL, ...args], { cwd: WS, env: { PATH: process.env.PATH, HOME: process.env.HOME, TL_WORKSPACE: WS } });
  return out.trim();
};
const w = (rel, value) => {
  const p = join(WS, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
};
const ff = (...args) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const probe = (file) => Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]).trim()) || 0;
const link = (from, to) => {
  const a = join(WS, from);
  const b = join(WS, to);
  mkdirSync(dirname(b), { recursive: true });
  if (existsSync(b)) rmSync(b);
  try {
    linkSync(a, b);
  } catch {
    copyFileSync(a, b);
  }
};

// ── Workspace ──────────────────────────────────────────────────────────────
mkdirSync(WS, { recursive: true });
for (const dir of ["stages", "requests", "out", "timeline.json", "timelines", "remotion", "ledger.jsonl", "film.json", ".tl"]) {
  rmSync(join(WS, dir), { recursive: true, force: true });
}
cpSync(join(MODE, "seed/film.json"), join(WS, "film.json"));
if (scenario === "fresh") {
  console.log(`fresh run at ${WS}`);
  process.exit(0);
}
cpSync(join(HERE, "stages"), join(WS, "stages"), { recursive: true });
cpSync(join(HERE, "options"), join(WS, ".tl/fixture-options"), { recursive: true });
const opt = (stage) => join(WS, ".tl/fixture-options", `${stage}.json`);

// ── Media (generated, small) ───────────────────────────────────────────────
const script = JSON.parse(readFileSync(join(HERE, "stages/script/options/B.json"), "utf-8"));
let t = 0;
const sceneStarts = script.scenes.map((s) => {
  const start = t;
  t += s.durationS;
  return { ...s, start };
});
const TOTAL = t;

function say(voice, rate, text, outMp3) {
  const aiff = `${outMp3}.aiff`;
  run("say", ["-v", voice, "-r", String(rate), "-o", aiff, text]);
  ff("-i", aiff, "-ac", "1", "-b:a", "48k", outMp3);
  rmSync(aiff, { force: true });
}

function video(src, out, vertical) {
  const abs = join(WS, out);
  mkdirSync(dirname(abs), { recursive: true });
  const vf = vertical ? "crop=ih*9/16:ih,scale=270:480,fps=24" : "scale=480:270,fps=24";
  if (src && existsSync(src)) {
    ff("-i", src, "-t", String(TOTAL), "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "34", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "56k", "-movflags", "+faststart", abs);
  } else {
    const size = vertical ? "270x480" : "480x270";
    ff("-f", "lavfi", "-i", `testsrc2=size=${size}:rate=24:duration=${TOTAL}`, "-f", "lavfi", "-i", `sine=frequency=220:duration=${TOTAL}`, "-c:v", "libx264", "-crf", "34", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "48k", "-shortest", abs);
  }
}

const voLines = [];
if (MEDIA) {
  // Music beds and guide-VO demos.
  for (const id of ["A", "B", "C"]) {
    const bed = join(WS, `stages/music/options/${id}-bed.mp3`);
    if (BEDS[id] && existsSync(BEDS[id])) ff("-i", BEDS[id], "-t", "30", "-b:a", "64k", bed);
    else ff("-f", "lavfi", "-i", `sine=frequency=${id === "A" ? 196 : id === "B" ? 174.6 : 220}:duration=30`, "-b:a", "64k", bed);
    const guide = join(WS, `stages/music/options/${id}-guide.mp3`);
    const guideVo = `${guide}.vo.mp3`;
    say("Samantha", 185, script.scenes.map((s) => s.vo.en).join(" "), guideVo);
    ff("-i", bed, "-i", guideVo, "-filter_complex", "[0:a]volume=0.55[m];[1:a]atrim=0:30[v];[m][v]amix=inputs=2:duration=first:normalize=0", "-t", "30", "-b:a", "64k", guide);
    rmSync(guideVo, { force: true });
  }
  // Voice auditions (mock stand-ins: macOS say).
  const sets = { A: ["Kyoko", 175, "Samantha"], B: ["Kyoko", 150, "Daniel"], C: ["Kyoko", 195, "Karen"] };
  for (const [id, [ja, rate, en]] of Object.entries(sets)) {
    say(ja, rate, "アクメなら、チームが知っていることをすぐに見つけられます。", join(WS, `stages/voice/options/ja-${id}.mp3`));
    say(en, 180, "Acme finds anything your team knows, with its sources.", join(WS, `stages/voice/options/en-${id}.mp3`));
  }
  // VO: two takes per line and language; the picked take is the one whose
  // length fits its scene best (a stand-in for the read check).
  mkdirSync(join(WS, "stages/vo/takes"), { recursive: true });
  for (const sc of sceneStarts) {
    for (const [lang, voice, rates] of [["ja", "Kyoko", [168, 182]], ["en", "Samantha", [172, 188]]]) {
      const takes = rates.map((rate, i) => {
        const file = `stages/vo/takes/${lang}-${sc.id}-t${i + 1}.mp3`;
        say(voice, rate, sc.vo[lang], join(WS, file));
        return { take: i + 1, file, durS: Math.round(probe(join(WS, file)) * 100) / 100 };
      });
      const best = takes.reduce((a, b) => (Math.abs(b.durS - sc.durationS * 0.7) < Math.abs(a.durS - sc.durationS * 0.7) ? b : a));
      for (const tk of takes) {
        voLines.push({
          id: `${sc.id}-${lang}`,
          sceneId: sc.id,
          lang,
          text: sc.vo[lang],
          take: tk.take,
          file: tk.file,
          durS: tk.durS,
          picked: tk === best,
          check: tk === best ? "read-check ok" : "read-check ok · longer",
          words: [],
        });
      }
    }
  }
}

w("stages/vo/lines.json", voLines);

// ── The run ────────────────────────────────────────────────────────────────
console.log(
  tl(
    "init",
    "--idea",
    "Acme finds anything your team knows — so a reply drafted at night waits for its owner in the morning, with its sources attached.",
    "--title",
    "Late request — answers with sources",
    "--market",
    "both",
    "--selling-points",
    "searches every app at once|drafts overnight, the owner approves|everyone answers from the same sources",
    "--prd",
    "prd/search.md",
    "--budget",
    "60",
  ),
);
w(".tl/fixture-brief.json", { brand: { display: "ACME", match: ["Acme"], spoken: { en: "Acme", ja: "アクメ" } }, integrations: { allow: [], deny: ["ExampleChat"] } });
tl("brief", "set", "--file", join(WS, ".tl/fixture-brief.json"), "--by", "producer");
tl("options", "set", "script", "--file", opt("script"));
tl("pick", "script", "B", "--by", "producer");
const r1 = JSON.parse(tl("ledger", "reserve", "--stage", "music", "--provider", "elevenlabs", "--what", "compose bed C (Drive)", "--usd", "2.40"));
tl("ledger", "commit", r1.id, "--usd", "2.31", "--request-id", "el-music-7f3a");
tl("options", "set", "music", "--file", opt("music"));

if (scenario !== "midway") {
  tl("pick", "music", "A", "--by", "auto-timeout");
  const r2 = JSON.parse(tl("ledger", "reserve", "--stage", "voice", "--provider", "elevenlabs", "--what", "6 auditions on the sample line", "--usd", "0.40"));
  tl("ledger", "commit", r2.id, "--usd", "0.36", "--request-id", "el-tts-a1");
  tl("options", "set", "voice", "--file", opt("voice"));
  tl("pick", "voice", "A", "--by", "producer");
  tl("autorun", "on");
  const r3 = JSON.parse(tl("ledger", "reserve", "--stage", "vo", "--provider", "elevenlabs", "--what", "28 VO takes (JA/EN)", "--usd", "1.90"));
  tl("ledger", "commit", r3.id, "--usd", "1.84", "--request-id", "el-tts-b2");
  tl("options", "set", "vo", "--file", opt("vo"));
  const r4 = JSON.parse(tl("ledger", "reserve", "--stage", "assets", "--provider", "fal", "--what", "Seedance 6 s · owner at desk", "--usd", "1.80"));
  tl("ledger", "commit", r4.id, "--usd", "1.75", "--request-id", "fal-sd-99");
  if (MEDIA) {
    video(SRC_EN, "out/roughcut/short-16x9-en.mp4", false);
    mkdirSync(join(WS, "stages/assets/options/thumbs"), { recursive: true });
    for (let i = 0; i < sceneStarts.length; i += 1) {
      const sc = sceneStarts[i];
      ff("-ss", String(sc.start + sc.durationS / 2), "-i", join(WS, "out/roughcut/short-16x9-en.mp4"), "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "5", join(WS, `stages/assets/options/thumbs/${sc.id}.jpg`));
    }
  }
  tl("options", "set", "assets", "--file", opt("assets"));

  // Picture: the Remotion scene list, then its preview.
  w("remotion/scenes.json", {
    fps: 30,
    formats: ["short-16x9", "short-9x16"],
    languages: ["ja", "en", "en-jasub"],
    scenes: sceneStarts.map((s) => ({ id: s.id, type: s.sceneType, from: Math.round(s.start * 30), len: Math.round(s.durationS * 30), props: {} })),
  });
  if (MEDIA) link("out/roughcut/short-16x9-en.mp4", "stages/picture/options/A-preview.mp4");
  tl("options", "set", "picture", "--file", opt("picture"));

  // Sound: the mix preview.
  if (MEDIA) {
    video(SRC_JA, "out/roughcut/short-16x9-ja.mp4", false);
    link("out/roughcut/short-16x9-ja.mp4", "stages/sound/options/A-mix.mp4");
  }
  tl("options", "set", "sound", "--file", opt("sound"));

  // The rough cut: the timeline, the renders, their QC.
  const fps = 30;
  const f = (s) => Math.round(s * fps);
  const picked = voLines.filter((l) => l.picked);
  w("timeline.json", {
    fps,
    units: "frames",
    formats: { "short-16x9": { width: 1920, height: 1080, frames: f(TOTAL) }, "short-9x16": { width: 1080, height: 1920, frames: f(TOTAL) } },
    scenes: sceneStarts.map((s) => ({ id: s.id, from: f(s.start), len: f(s.durationS), label: `${s.id} · ${s.sceneType}` })),
    tracks: {
      vo: picked.map((l) => {
        const sc = sceneStarts.find((s) => s.id === l.sceneId);
        return { from: f(sc.start + 0.4), dur: f(l.durS), id: l.id, lang: l.lang, text: l.text };
      }),
      bgm: [{ from: 0, dur: f(TOTAL), file: "stages/music/options/A-bed.mp3", label: "Steady pulse · A" }],
      sfx: sceneStarts.flatMap((s, i) => [
        { t: f(s.start), id: i === 0 ? "drop" : "whoosh", group: "transition" },
        { t: f(s.start + s.durationS * 0.5), id: "ui-tick", group: "ui" },
      ]),
      captions: picked.map((l) => {
        const sc = sceneStarts.find((s) => s.id === l.sceneId);
        return { from: f(sc.start + 0.4), dur: f(Math.min(l.durS, sc.durationS - 0.5)), text: l.text, lang: l.lang };
      }),
    },
  });
  if (MEDIA) {
    video(SRC_JA, "out/roughcut/short-9x16-ja.mp4", true);
    link("out/roughcut/short-16x9-en.mp4", "out/roughcut/short-16x9-en-jasub.mp4");
  }
  const qc = (key, file, lufs) => ({
    format: key.split("-").slice(0, 2).join("-"),
    lang: key.split("-").slice(2).join("-"),
    file,
    durationS: Math.round(TOTAL * 100) / 100,
    frames: f(TOTAL),
    lufs,
    truePeak: -1.3,
    pass: !key.includes("9x16"),
    checks: [
      { id: "duration", status: "pass", label: `Duration ${TOTAL.toFixed(1)} s ≤ 90 s` },
      { id: "loudness", status: "pass", label: `Loudness ${lufs} LUFS · TP −1.3 dBTP` },
      { id: "vo-read", status: "pass", label: "VO read-check against the script" },
      { id: "lint-brand-caps", status: "pass", label: "The brand written ACME in every caption" },
      { id: "caption-band", status: key.includes("9x16") ? "fail" : "pass", label: "Captions inside the 80 px band", note: key.includes("9x16") ? "s3 caption wraps to 3 lines" : undefined },
    ],
  });
  for (const [key, lufs] of [["short-16x9-ja", -14.1], ["short-16x9-en", -14.0], ["short-16x9-en-jasub", -14.0], ["short-9x16-ja", -14.2]]) {
    w(`out/qc/roughcut-${key}.json`, qc(key, `out/roughcut/${key}.mp4`, lufs));
  }
  // The rough cut is registered as an option set (v1, later v2…): no
  // countdown, and only the producer's pick passes it.
  w(".tl/fixture-options/roughcut.json", [
    {
      id: "v1",
      title: "Rough cut v1",
      summary: "VO + music A + SFX set E, all four rendered versions QC'd; 9:16 has one caption to fix.",
      recommended: true,
      files: ["timeline.json", "out/qc/roughcut-short-16x9-ja.json", "out/qc/roughcut-short-16x9-en.json", "out/qc/roughcut-short-9x16-ja.json"],
      preview: "out/roughcut/short-16x9-ja.mp4",
    },
  ]);
  tl("options", "set", "roughcut", "--file", opt("roughcut"));
  tl("tick");
}

if (scenario === "changed") {
  const p = join(WS, "stages/script/options/B.json");
  const doc = JSON.parse(readFileSync(p, "utf-8"));
  doc.scenes[1].vo.en = "A client in Osaka asks about last year's contract.";
  writeFileSync(p, `${JSON.stringify(doc, null, 2)}\n`);
}

if (scenario === "final") {
  tl("pick", "roughcut", "v1", "--by", "producer", "--note", "Approved. Tighten s3 by half a second in finals.");
  if (MEDIA) {
    for (const key of ["short-16x9-ja", "short-16x9-en", "short-16x9-en-jasub", "short-9x16-ja"]) link(`out/roughcut/${key}.mp4`, `out/final/${key}.mp4`);
  }
  for (const key of ["short-16x9-ja", "short-16x9-en", "short-16x9-en-jasub", "short-9x16-ja"]) {
    const rc = JSON.parse(readFileSync(join(WS, `out/qc/roughcut-${key}.json`), "utf-8"));
    w(`out/qc/final-${key}.json`, { ...rc, file: `out/final/${key}.mp4`, checks: rc.checks.map((c) => ({ ...c, status: "pass", note: undefined })) });
  }
}

console.log(tl("status"));
