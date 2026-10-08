/**
 * The countdown, the tick, the producer's requests and auto-run — and the hard gate
 * none of them may pass.
 */
import { describe, expect, test } from "bun:test";

import { deriveStages } from "../skill/scripts/lib/stage-state.mjs";
import {
  approveStage,
  createFilm,
  parseRequest,
  pickOption,
  reconcile,
  setAutorun,
  setOptions,
  TLError,
} from "../skill/scripts/lib/film.mjs";

const T0 = Date.parse("2026-09-28T09:00:00.000Z");
const MIN = 60_000;

const two = (stage) => [
  { id: "A", title: `${stage} A`, files: [`stages/${stage}/options/A.json`] },
  { id: "B", title: `${stage} B`, recommended: true, files: [`stages/${stage}/options/B.json`] },
];
const texts = {};
for (const s of ["script", "music", "voice", "vo", "assets", "picture", "sound", "roughcut"]) {
  texts[`stages/${s}/options/A.json`] = `{"s":"${s}","o":"A"}`;
  texts[`stages/${s}/options/B.json`] = `{"s":"${s}","o":"B"}`;
}
const status = (film, now) => Object.fromEntries(deriveStages(film, texts, now).map((s) => [s.id, s]));
const req = (action, stage, option, at, extra = {}) =>
  parseRequest({ id: `r-${at}`, action, stage, option, requestedAt: new Date(at).toISOString(), ...extra });

describe("countdown and tick", () => {
  test("nothing happens before the deadline; after it the recommended option is taken by auto-timeout", () => {
    let film = createFilm({ idea: "x" }, { now: T0 });
    film = setOptions(film, "script", two("script"), { now: T0, texts });
    expect(film.stages.script.deadline).toBe(new Date(T0 + 30 * MIN).toISOString());

    const early = reconcile(film, { now: T0 + 29 * MIN, texts });
    expect(early.changes).toEqual([]);
    expect(status(early.film, T0 + 29 * MIN).script.status).toBe("awaiting");

    const late = reconcile(film, { now: T0 + 30 * MIN + 1, texts });
    expect(late.changes).toEqual([{ stage: "script", option: "B", by: "auto-timeout" }]);
    const s = status(late.film, T0 + 30 * MIN + 1).script;
    expect(s.status).toBe("confirmed");
    expect(s.pick).toBe("B");
    expect(s.pickedBy).toBe("auto-timeout");
    expect(late.film.stages.script.deadline).toBeNull();
    expect(late.film.stages.script.approval.by).toBe("auto");
  });

  test("the countdown uses the film's countdownMin (seconds work for tests)", () => {
    let film = createFilm({ idea: "x", settings: { countdownMin: 0.05 } }, { now: T0 });
    film = setOptions(film, "script", two("script"), { now: T0, texts });
    expect(Date.parse(film.stages.script.deadline) - T0).toBe(3000);
    expect(reconcile(film, { now: T0 + 3001, texts }).changes).toHaveLength(1);
  });

  test("a request the producer made before the deadline wins over the timeout, even if applied after it", () => {
    let film = createFilm({ idea: "x" }, { now: T0 });
    film = setOptions(film, "script", two("script"), { now: T0, texts });
    const r = reconcile(film, {
      now: T0 + 45 * MIN, // the tick runs late
      texts,
      requests: [req("pick", "script", "A", T0 + 29 * MIN)],
    });
    expect(r.requests).toEqual([{ id: `r-${T0 + 29 * MIN}`, ok: true, changed: true }]);
    expect(r.film.stages.script.pick).toBe("A");
    expect(r.film.stages.script.pickedBy).toBe("producer");
    expect(r.changes.some((c) => c.by === "auto-timeout")).toBe(false);
  });

  test("a request made after the timeout re-picks, and what was built on the old pick goes stale", () => {
    let film = createFilm({ idea: "x" }, { now: T0 });
    film = setOptions(film, "script", two("script"), { now: T0, texts });
    film = reconcile(film, { now: T0 + 31 * MIN, texts }).film; // auto → B
    film = setOptions(film, "music", two("music"), { now: T0 + 32 * MIN, texts });
    film = pickOption(film, "music", "A", { now: T0 + 33 * MIN, texts, by: "producer" }).film;
    const r = reconcile(film, { now: T0 + 34 * MIN, texts, requests: [req("pick", "script", "A", T0 + 34 * MIN)] });
    const s = status(r.film, T0 + 34 * MIN);
    expect(s.script.pick).toBe("A");
    expect(s.music.status).toBe("stale");
  });

  test("a refused request is reported, not thrown", () => {
    const film = createFilm({ idea: "x" }, { now: T0 });
    const r = reconcile(film, { now: T0, texts, requests: [req("pick", "music", "A", T0)] });
    expect(r.requests[0].ok).toBe(false);
    expect(r.requests[0].error).toContain("locked");
  });
});

describe("the hard gate", () => {
  function toRoughcut() {
    let film = createFilm({ idea: "x" }, { now: T0 });
    let t = T0;
    for (const s of ["script", "music", "voice", "vo", "assets", "picture", "sound"]) {
      film = setOptions(film, s, two(s), { now: (t += MIN), texts });
      film = pickOption(film, s, "B", { now: (t += MIN), texts, by: "producer" }).film;
    }
    film = setOptions(film, "roughcut", two("roughcut"), { now: (t += MIN), texts });
    return { film, t };
  }

  test("the rough cut gets no countdown and a timeout never passes it", () => {
    const { film, t } = toRoughcut();
    expect(film.stages.roughcut.deadline).toBeNull();
    const r = reconcile(film, { now: t + 24 * 60 * MIN, texts });
    expect(r.changes).toEqual([]);
    expect(status(r.film, t).roughcut.status).toBe("awaiting");
  });

  test("only the producer can pick or approve the rough cut", () => {
    const { film, t } = toRoughcut();
    expect(() => pickOption(film, "roughcut", "B", { now: t, texts, by: "auto-run" })).toThrow(TLError);
    expect(() => pickOption(film, "roughcut", "B", { now: t, texts, by: "auto-timeout" })).toThrow(/hard gate/);
    expect(() => approveStage(film, "roughcut", { now: t, texts, by: "auto" })).toThrow(/hard gate/);
    const ok = pickOption(film, "roughcut", "B", { now: t, texts, by: "producer" });
    expect(status(ok.film, t).roughcut.status).toBe("confirmed");
    expect(status(ok.film, t).finals.status).toBe("empty");
  });
});

describe("auto-run", () => {
  test("auto-run takes the recommended option as each stage's options land, and stops at the rough cut", () => {
    let film = createFilm({ idea: "x" }, { now: T0 });
    film = setAutorun(film, true, { now: T0 });
    let t = T0;
    for (const s of ["script", "music", "voice", "vo", "assets", "picture", "sound"]) {
      film = setOptions(film, s, two(s), { now: (t += MIN), texts });
      const r = reconcile(film, { now: t, texts });
      expect(r.changes).toEqual([{ stage: s, option: "B", by: "auto-run" }]);
      film = r.film;
    }
    film = setOptions(film, "roughcut", two("roughcut"), { now: (t += MIN), texts });
    const r = reconcile(film, { now: t + 60 * MIN, texts });
    expect(r.changes).toEqual([]);
    const s = status(r.film, t);
    expect(s.sound.status).toBe("confirmed");
    expect(s.sound.pickedBy).toBe("auto-run");
    expect(s.roughcut.status).toBe("awaiting");
    expect(s.finals.status).toBe("locked");
  });

  test("switching auto-run on picks every stage already waiting, in order", () => {
    let film = createFilm({ idea: "x" }, { now: T0 });
    film = setOptions(film, "script", two("script"), { now: T0, texts });
    const r = reconcile(film, {
      now: T0 + MIN,
      texts,
      requests: [parseRequest({ id: "auto", action: "autorun", on: true, requestedAt: new Date(T0 + MIN).toISOString() })],
    });
    expect(r.film.autoRun.enabled).toBe(true);
    expect(r.film.stages.script.pick).toBe("B");
    expect(r.film.stages.script.pickedBy).toBe("auto-run");
  });
});

describe("approve on a stage with options", () => {
  test("The producer's approve takes the only (or recommended) option; an automatic approve must pick", () => {
    let film = createFilm({ idea: "x" }, { now: T0 });
    let t = T0;
    for (const s of ["script", "music", "voice", "vo", "assets", "picture", "sound"]) {
      film = setOptions(film, s, two(s), { now: (t += MIN), texts });
      film = pickOption(film, s, "B", { now: (t += MIN), texts, by: "producer" }).film;
    }
    film = setOptions(film, "roughcut", [{ id: "v1", title: "Rough cut v1", files: ["stages/roughcut/options/A.json"] }], { now: (t += MIN), texts });
    expect(() => approveStage(film, "script", { now: t, texts, by: "auto" })).not.toThrow();
    const ok = approveStage(film, "roughcut", { now: t, texts, by: "producer" });
    expect(ok.film.stages.roughcut.pick).toBe("v1");
    expect(ok.film.stages.roughcut.pickedBy).toBe("producer");
    expect(status(ok.film, t).roughcut.status).toBe("confirmed");
  });
});
