/**
 * Derived status (contracts §2): one algorithm, pure, clock and texts passed in.
 */
import { describe, expect, test } from "bun:test";

import { deriveStages, hashStage, stageStatus, STAGES } from "../skill/scripts/lib/stage-state.mjs";
import { approveStage, createFilm, pickOption, setOptions } from "../skill/scripts/lib/film.mjs";
import { sha256 } from "../skill/scripts/lib/sha256.mjs";

const T0 = Date.parse("2026-09-28T09:00:00.000Z");
const MIN = 60_000;

const statusMap = (film, texts, now) =>
  Object.fromEntries(deriveStages(film, texts, now).map((s) => [s.id, s.status]));

function scriptTexts() {
  return {
    "stages/script/options/A.json": JSON.stringify({ id: "A", title: "Recall", scenes: [{ id: "s1" }] }),
    "stages/script/options/B.json": JSON.stringify({ id: "B", title: "Night reply", scenes: [{ id: "s1" }] }),
  };
}

const scriptOptions = [
  { id: "A", title: "Recall", files: ["stages/script/options/A.json"] },
  { id: "B", title: "Night reply", recommended: true, files: ["stages/script/options/B.json"] },
];

const musicTexts = {
  "stages/music/options/A.json": JSON.stringify({ id: "A", bed: { bpmMap: [{ from: 0, to: 10, bpm: 96 }] } }),
};
const musicOptions = [
  { id: "A", title: "Ink pulse", files: ["stages/music/options/A.json", "stages/music/options/A-demo.mp3"] },
];

describe("sha256", () => {
  test("matches known vectors", () => {
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    // Multi-block and non-ASCII (UTF-8) input.
    expect(sha256("記憶".repeat(40))).toBe(
      new Bun.CryptoHasher("sha256").update("記憶".repeat(40)).digest("hex"),
    );
  });
});

describe("derived status", () => {
  test("a seed film (no idea) has an empty idea and everything else locked", () => {
    const film = createFilm({}, { now: T0 });
    const s = statusMap(film, {}, T0);
    expect(s.idea).toBe("empty");
    for (const id of STAGES.slice(1)) expect(s[id]).toBe("locked");
  });

  test("init with an idea confirms the idea; the script stage opens", () => {
    const film = createFilm({ idea: "ACME remembers" }, { now: T0 });
    const s = statusMap(film, {}, T0);
    expect(s.idea).toBe("confirmed");
    expect(s.script).toBe("empty");
    expect(s.music).toBe("locked");
  });

  test("options → awaiting with a running countdown; pick → confirmed", () => {
    const texts = scriptTexts();
    let film = createFilm({ idea: "ACME remembers" }, { now: T0 });
    film = setOptions(film, "script", scriptOptions, { now: T0, texts });
    const d = deriveStages(film, texts, T0 + 10 * MIN).find((x) => x.id === "script");
    expect(d.status).toBe("awaiting");
    expect(d.recommended).toBe("B");
    expect(d.remainingMs).toBe(20 * MIN);
    expect(d.expired).toBe(false);

    film = pickOption(film, "script", "A", { now: T0 + 11 * MIN, texts, by: "producer" }).film;
    const s = statusMap(film, texts, T0 + 11 * MIN);
    expect(s.script).toBe("confirmed");
    expect(s.music).toBe("empty");
  });

  test("editing the picked option's file → changed; downstream approvals go stale, unapproved ones lock", () => {
    let texts = { ...scriptTexts(), ...musicTexts };
    let film = createFilm({ idea: "ACME remembers" }, { now: T0 });
    film = setOptions(film, "script", scriptOptions, { now: T0, texts });
    film = pickOption(film, "script", "A", { now: T0 + MIN, texts, by: "producer" }).film;
    film = setOptions(film, "music", musicOptions, { now: T0 + 2 * MIN, texts });
    film = pickOption(film, "music", "A", { now: T0 + 3 * MIN, texts, by: "producer" }).film;
    expect(statusMap(film, texts, T0 + 3 * MIN).music).toBe("confirmed");

    texts = { ...texts, "stages/script/options/A.json": JSON.stringify({ id: "A", title: "Recall v2" }) };
    const s = statusMap(film, texts, T0 + 4 * MIN);
    expect(s.script).toBe("changed");
    expect(s.music).toBe("stale");
    expect(s.voice).toBe("locked");
  });

  test("a sibling option file changing does not un-confirm the pick", () => {
    let texts = scriptTexts();
    let film = createFilm({ idea: "ACME remembers" }, { now: T0 });
    film = setOptions(film, "script", scriptOptions, { now: T0, texts });
    film = pickOption(film, "script", "A", { now: T0 + MIN, texts, by: "producer" }).film;
    texts = { ...texts, "stages/script/options/B.json": "{}", "stages/script/options/C.json": "{}" };
    expect(stageStatus(film, "script", texts, T0 + 2 * MIN)).toBe("confirmed");
  });

  test("re-picking upstream after downstream was approved makes downstream stale", () => {
    const texts = { ...scriptTexts(), ...musicTexts };
    let film = createFilm({ idea: "ACME remembers" }, { now: T0 });
    film = setOptions(film, "script", scriptOptions, { now: T0, texts });
    film = pickOption(film, "script", "A", { now: T0 + MIN, texts, by: "producer" }).film;
    film = setOptions(film, "music", musicOptions, { now: T0 + 2 * MIN, texts });
    film = pickOption(film, "music", "A", { now: T0 + 3 * MIN, texts, by: "auto-timeout" }).film;
    // Same millisecond as the music pick: order comes from `seq`, not the clock.
    film = pickOption(film, "script", "B", { now: T0 + 3 * MIN, texts, by: "producer" }).film;
    const s = statusMap(film, texts, T0 + 3 * MIN);
    expect(s.script).toBe("confirmed");
    expect(s.music).toBe("stale");
  });

  test("picking the same option again is a no-op (a duplicate request never bumps the order)", () => {
    const texts = scriptTexts();
    let film = createFilm({ idea: "x" }, { now: T0 });
    film = setOptions(film, "script", scriptOptions, { now: T0, texts });
    film = pickOption(film, "script", "A", { now: T0 + MIN, texts }).film;
    const seq = film.seq;
    const again = pickOption(film, "script", "A", { now: T0 + 2 * MIN, texts });
    expect(again.changed).toBe(false);
    expect(again.film.seq).toBe(seq);
  });

  test("working hint; finals approved show done", () => {
    const texts = {};
    let film = createFilm({ idea: "x" }, { now: T0 });
    film.stages.script.state = "working";
    expect(stageStatus(film, "script", texts, T0)).toBe("working");

    // Walk every stage to finals with one-option stages and the producer's rough cut.
    const all = {};
    film = createFilm({ idea: "x" }, { now: T0 });
    let t = T0;
    for (const id of ["script", "music", "voice", "vo", "assets", "picture", "sound", "roughcut"]) {
      all[`stages/${id}/options/A.json`] = `{"id":"A","stage":"${id}"}`;
      film = setOptions(film, id, [{ id: "A", title: id, files: [`stages/${id}/options/A.json`] }], { now: (t += MIN), texts: all });
      film = pickOption(film, id, "A", { now: (t += MIN), texts: all, by: "producer" }).film;
    }
    all["out/qc/final-short-16x9-ja.json"] = '{"ok":true}';
    film = approveStage(film, "finals", { now: (t += MIN), texts: all, by: "auto" }).film;
    const s = statusMap(film, all, t);
    expect(s.roughcut).toBe("confirmed");
    expect(s.finals).toBe("done");
    expect(s.deliver).toBe("empty");
  });

  test("the stage hash covers media by path only and is stable across key order", () => {
    const texts = scriptTexts();
    let film = createFilm({ idea: "x" }, { now: T0 });
    film = setOptions(film, "script", scriptOptions, { now: T0, texts });
    film = pickOption(film, "script", "B", { now: T0 + MIN, texts }).film;
    const h1 = hashStage(film, "script", texts);
    const reordered = JSON.parse(JSON.stringify(film));
    reordered.stages.script.options = reordered.stages.script.options.map((o) =>
      Object.fromEntries(Object.entries(o).reverse()),
    );
    expect(hashStage(reordered, "script", texts)).toBe(h1);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("stages without options", () => {
  test("finals wait for the producer once their QC records exist", () => {
    const all = {};
    let film = createFilm({ idea: "x" }, { now: T0 });
    let t = T0;
    for (const id of ["script", "music", "voice", "vo", "assets", "picture", "sound", "roughcut"]) {
      all[`stages/${id}/options/A.json`] = `{"id":"A","stage":"${id}"}`;
      film = setOptions(film, id, [{ id: "A", title: id, files: [`stages/${id}/options/A.json`] }], { now: (t += MIN), texts: all });
      film = pickOption(film, id, "A", { now: (t += MIN), texts: all, by: "producer" }).film;
    }
    expect(stageStatus(film, "finals", all, t)).toBe("empty");
    all["out/qc/final-short-16x9-ja.json"] = '{"pass":true}';
    expect(stageStatus(film, "finals", all, t)).toBe("awaiting");
    film = approveStage(film, "finals", { now: (t += MIN), texts: all, by: "producer" }).film;
    expect(stageStatus(film, "finals", all, t)).toBe("done");
  });
});
