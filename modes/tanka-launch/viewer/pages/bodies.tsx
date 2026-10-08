/**
 * Stage page bodies — each option rendered for its medium: a scene table for
 * a script, players and a BPM curve for music, auditions for voices, takes
 * for VO, a contact sheet for assets, the MP4 for picture and sound.
 *
 * The shapes read here are contracts §5 (stage artifacts). Anything missing
 * is shown as missing, never invented.
 */

import { Fragment } from "react";

import {
  brand,
  contentUrl,
  langLabel,
  optionLangGroups,
  pickParts,
  type DerivedStage,
  optionDoc,
  optionDocs,
  optionMedia,
  parseJson,
  resolveRef,
  type RunModel,
  type StageOption,
} from "../model.js";
import { assetItems, voLines } from "../Nodes.js";
import { AudioPlayer, Density, VideoPlayer, VideoPoster } from "../ui.js";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));

interface BodyProps {
  model: RunModel;
  option: StageOption | undefined;
  base: string;
}

function Missing({ what }: { what: string }) {
  return <p className="tl-lead">{what}</p>;
}

// ── Idea ────────────────────────────────────────────────────────────────────

export function IdeaBody({ model }: { model: RunModel }) {
  const brief = model.film?.run.brief;
  if (!brief || !brief.idea) return <Missing what="No idea yet. Type the idea or selling point in the chat; the director writes the brief and starts the script." />;
  const extra = (model.film?.run.brief as unknown as Rec) ?? {};
  return (
    <div>
      <p className="tl-idea">{brand(brief.idea)}</p>
      <dl className="tl-kv">
        <dt>Market</dt>
        <dd>{brief.market === "both" ? "US and Japan" : brief.market === "jp" ? "Japan" : "US"}</dd>
        <dt>Formats</dt>
        <dd className="tl-pills">{brief.formats.map((f) => <span key={f} className="tl-pill">{f}</span>)}</dd>
        <dt>Languages</dt>
        <dd className="tl-pills">{brief.languages.map((l) => <span key={l} className="tl-pill">{langLabel(l)}</span>)}</dd>
        <dt>Selling points</dt>
        <dd>
          {brief.sellingPoints.length ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {brief.sellingPoints.map((s, i) => <li key={i}>{brand(s)}</li>)}
            </ul>
          ) : (
            <span className="tl-muted">not written yet</span>
          )}
        </dd>
        <dt>Figma</dt>
        <dd>{brief.sources.figma.length ? brief.sources.figma.join(", ") : <span className="tl-muted">none linked</span>}</dd>
        <dt>PRDs</dt>
        <dd>{brief.sources.prd.length ? brief.sources.prd.join(", ") : <span className="tl-muted">none linked</span>}</dd>
        {extra.notes ? (
          <>
            <dt>Notes</dt>
            <dd>{brand(str(extra.notes))}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

// ── Script ──────────────────────────────────────────────────────────────────

function langPair(v: unknown): { ja: string; en: string } {
  if (typeof v === "string") return { ja: "", en: v };
  if (isRec(v)) return { ja: str(v.ja), en: str(v.en) };
  return { ja: "", en: "" };
}

export function ScriptBody({ model, option }: BodyProps) {
  const doc = optionDoc<Rec>(model, option, (d) => isRec(d) && Array.isArray(d.scenes));
  if (!doc) return <Missing what="This option has no scene list yet (stages/script/options/<id>.json with scenes[])." />;
  const scenes = (doc.scenes as Rec[]).filter(isRec);
  const total = scenes.reduce((s, sc) => s + (Number(sc.durationS) || 0), 0);
  const arc = Array.isArray(doc.arc) ? (doc.arc as unknown[]).map(str).join(" → ") : str(doc.arc);
  return (
    <div>
      {doc.logline ? <p className="tl-lead" style={{ color: "var(--tl-fg)", fontSize: 14 }}>{brand(str(doc.logline))}</p> : null}
      {arc ? (
        <p className="tl-lead">
          <span className="tl-caps tl-muted">Arc </span> {brand(arc)}
        </p>
      ) : null}
      {option?.summary ? (
        <p className="tl-lead">
          <span className="tl-caps tl-muted">How it differs </span> {brand(option.summary)}
        </p>
      ) : null}
      <table className="tl-table">
        <thead>
          <tr>
            <th style={{ width: 70 }}>Scene</th>
            <th>VO</th>
            <th style={{ width: "26%" }}>On screen</th>
            <th style={{ width: 92 }}>Density</th>
          </tr>
        </thead>
        <tbody>
          {scenes.map((sc, i) => {
            const vo = langPair(sc.vo);
            const os = langPair(sc.onScreen);
            const d = isRec(sc.density) ? sc.density : {};
            return (
              <tr key={str(sc.id) || i}>
                <td>
                  <div className="tl-sid">{str(sc.id) || `s${i + 1}`}</div>
                  <div className="tl-sid">{Number(sc.durationS) ? `${Number(sc.durationS).toFixed(1)} s` : ""}</div>
                  {sc.sceneType ? <div className="tl-sid" style={{ marginTop: 3 }}>{str(sc.sceneType)}</div> : null}
                  {isRec(sc.board) && isRec(sc.board.source) && sc.board.source.type ? (
                    <div className="tl-sid tl-muted" style={{ marginTop: 3 }} title={str(sc.board.source.prd) || str(sc.board.source.figma)}>
                      src · {str(sc.board.source.type)}
                    </div>
                  ) : null}
                </td>
                <td>
                  {vo.ja ? <div className="tl-ja">{brand(vo.ja)}</div> : null}
                  {vo.en ? <div className={vo.ja ? "tl-en" : "tl-ja"}>{brand(vo.en)}</div> : null}
                  {!vo.ja && !vo.en ? <span className="tl-muted">— no VO —</span> : null}
                </td>
                <td>
                  {os.ja ? <div className="tl-ost">{brand(os.ja)}</div> : null}
                  {os.en ? <div className={os.ja ? "tl-en" : "tl-ost"}>{brand(os.en)}</div> : null}
                  {sc.transitionOut ? <div className="tl-sid" style={{ marginTop: 4 }}>→ {str(sc.transitionOut)}</div> : null}
                </td>
                <td>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }} className="tl-muted">
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>info <Density value={Number(d.info) || 0} /></span>
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>anim <Density value={Number(d.anim) || 0} /></span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="tl-note" style={{ marginTop: 10 }}>
        {scenes.length} scenes · <b>{total.toFixed(1)} s</b> total
      </p>
    </div>
  );
}

// ── Music ───────────────────────────────────────────────────────────────────

interface BpmPoint {
  from: number;
  to: number;
  bpm: number;
  feel?: string;
}

/** Scene boundaries of the picked (else recommended) script, in seconds. */
function scriptBoundaries(model: RunModel): Array<{ t: number; id: string }> {
  const script = model.byId.script;
  const id = script.pick ?? script.recommended;
  const option = script.options.find((o) => o.id === id);
  const doc = optionDoc<Rec>(model, option, (d) => isRec(d) && Array.isArray(d.scenes));
  if (!doc) return [];
  let t = 0;
  const out: Array<{ t: number; id: string }> = [];
  for (const sc of (doc.scenes as Rec[]).filter(isRec)) {
    out.push({ t, id: str(sc.id) });
    t += Number(sc.durationS) || 0;
  }
  return out;
}

/** The option's own scene windows (the ONE clock once it is picked), else null → the script's durationS. */
function optionWindows(doc: Rec | null): Array<{ t: number; id: string }> | null {
  const w = Array.isArray(doc?.windows) ? (doc!.windows as unknown[]).filter(isRec) : [];
  if (!w.length) return null;
  return w.map((x) => ({ t: Number(x.from) || 0, id: str(x.scene) }));
}

export function BpmGraph({ points, scenes }: { points: BpmPoint[]; scenes: Array<{ t: number; id: string }> }) {
  if (points.length === 0) return <Missing what="No BPM map in this option." />;
  const W = 760;
  const H = 150;
  const L = 34;
  const R = 8;
  const T = 14;
  const B = 22;
  const end = Math.max(...points.map((p) => p.to), scenes.length ? scenes[scenes.length - 1].t : 0);
  const bpms = points.map((p) => p.bpm);
  const lo = Math.floor((Math.min(...bpms) - 8) / 10) * 10;
  const hi = Math.ceil((Math.max(...bpms) + 8) / 10) * 10;
  const x = (s: number) => L + (end > 0 ? (s / end) * (W - L - R) : 0);
  const y = (b: number) => T + (1 - (b - lo) / Math.max(1, hi - lo)) * (H - T - B);
  const sorted = [...points].sort((a, b) => a.from - b.from);
  let line = "";
  sorted.forEach((p, i) => {
    line += `${i === 0 ? "M" : "L"}${x(p.from).toFixed(1)},${y(p.bpm).toFixed(1)} L${x(p.to).toFixed(1)},${y(p.bpm).toFixed(1)} `;
  });
  const fill = `${line} L${x(sorted[sorted.length - 1].to).toFixed(1)},${H - B} L${x(sorted[0].from).toFixed(1)},${H - B} Z`;
  const ticks: number[] = [];
  const step = end > 60 ? 10 : 5;
  for (let t = 0; t <= end + 0.001; t += step) ticks.push(t);
  return (
    <svg className="tl-bpm" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="BPM over time">
      {[lo, (lo + hi) / 2, hi].map((b) => (
        <g key={b}>
          <line className="tl-bpm-axis" x1={L} x2={W - R} y1={y(b)} y2={y(b)} opacity={0.5} />
          <text x={L - 6} y={y(b) + 3} textAnchor="end">{Math.round(b)}</text>
        </g>
      ))}
      {scenes.map((s) => (
        <g key={`${s.id}-${s.t}`}>
          <line className="tl-bpm-scene" x1={x(s.t)} x2={x(s.t)} y1={T - 6} y2={H - B} />
          <text x={x(s.t) + 3} y={T - 3} textAnchor="start" opacity={0.8}>{s.id}</text>
        </g>
      ))}
      <path className="tl-bpm-fill" d={fill} />
      <path className="tl-bpm-line" d={line} />
      {sorted.map((p, i) => {
        // One label per segment, only where it fits: the tempo when the map varies, plus a feel other than "straight".
        const varies = hi - lo > 20 && new Set(bpms.map((b) => Math.round(b))).size > 1;
        const label = [varies ? String(Math.round(p.bpm)) : "", p.feel && p.feel !== "straight" ? p.feel : ""].filter(Boolean).join(" · ");
        const room = x(p.to) - x(p.from);
        return label && room >= label.length * 6.2 + 6 ? (
          <text key={i} x={(x(p.from) + x(p.to)) / 2} y={y(p.bpm) - 6} textAnchor="middle" style={{ fill: "var(--tl-fg)", opacity: 0.8 }}>
            {label}
          </text>
        ) : null;
      })}
      {ticks.map((t) => (
        <text key={t} x={x(t)} y={H - 6} textAnchor="middle">{t}s</text>
      ))}
    </svg>
  );
}

export function MusicBody({ model, option, base }: BodyProps) {
  const docs = optionDocs(model, option);
  const found = docs.find((d) => isRec(d.doc) && isRec((d.doc as Rec).bed));
  const doc = found ? (found.doc as Rec) : null;
  const path = found?.path ?? "";
  const bed = isRec(doc?.bed) ? (doc!.bed as Rec) : {};
  const demo = isRec(doc?.demo) ? (doc!.demo as Rec) : {};
  const map = (Array.isArray(bed.bpmMap) ? bed.bpmMap : []).filter(isRec).map((m) => ({
    from: Number(m.from) || 0,
    to: Number(m.to) || 0,
    bpm: Number(m.bpm) || 0,
    feel: typeof m.feel === "string" ? m.feel : undefined,
  }));
  const audio = optionMedia(option, "audio");
  const music = resolveRef(path, str(demo.music) || str(bed.file)) ?? audio[0] ?? null;
  const guide = resolveRef(path, str(demo.guideVo)) ?? audio.find((a) => /guide|vo/i.test(a) && a !== music) ?? null;
  return (
    <div>
      <div className="tl-h3">Listen</div>
      <div className="tl-grid2">
        <AudioPlayer src={music ? contentUrl(base, music, model.rev) : null} label="Music only" sub={bed.source ? `${str(bed.source)}${bed.key ? ` · ${str(bed.key)}` : ""}` : undefined} />
        <AudioPlayer src={guide ? contentUrl(base, guide, model.rev) : null} label="With guide VO" sub="pacing demo — the VO is a guide read, not the final" />
      </div>
      <div className="tl-h3">Rhythm — BPM over time</div>
      <BpmGraph points={map} scenes={optionWindows(doc) ?? scriptBoundaries(model)} />
      <dl className="tl-kv" style={{ marginTop: 10 }}>
        <dt>Bed</dt>
        <dd>{str(bed.source) || "—"}{bed.file ? <span className="tl-mono tl-muted"> · {str(bed.file)}</span> : null}</dd>
        <dt>Key</dt>
        <dd>{str(bed.key) || "—"}</dd>
        <dt>SFX set</dt>
        <dd>{str(doc?.sfxSet) || "—"}</dd>
        {doc?.notes ? (
          <>
            <dt>Notes</dt>
            <dd>{brand(str(doc.notes))}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

// ── Voice ───────────────────────────────────────────────────────────────────

export function VoiceBody({ model, option, base }: BodyProps) {
  const docs = optionDocs(model, option).filter((d) => isRec(d.doc) && ("voiceId" in (d.doc as Rec) || "sample" in (d.doc as Rec)));
  const byLang = new Map<string, Array<{ path: string; doc: Rec }>>();
  for (const d of docs) {
    const doc = d.doc as Rec;
    const lang = str(doc.lang) || /\/(ja|en|en-jasub)-/.exec(d.path)?.[1] || "—";
    if (!byLang.has(lang)) byLang.set(lang, []);
    byLang.get(lang)!.push({ path: d.path, doc });
  }
  const loose = optionMedia(option, "audio");
  if (byLang.size === 0 && loose.length === 0) return <Missing what="No auditions in this option yet (stages/voice/options/<lang>-<id>.json with a sample)." />;
  return (
    <div>
      <p className="tl-lead">Each voice reads the same sample line. Pick the set; the VO stage records every line in it.</p>
      {[...byLang.entries()].map(([lang, list]) => (
        <Fragment key={lang}>
          <div className="tl-h3">{langLabel(lang)}</div>
          <div className="tl-grid2">
            {list.map(({ path, doc }) => {
              const sample = resolveRef(path, str(doc.sample));
              const settings = isRec(doc.settings)
                ? Object.entries(doc.settings as Rec)
                    .map(([k, v]) => `${k} ${v}`)
                    .join(" · ")
                : "";
              return (
                <AudioPlayer
                  key={path}
                  src={sample ? contentUrl(base, sample, model.rev) : null}
                  label={`${str(doc.name) || str(doc.voiceId)}`}
                  sub={settings || str(doc.voiceId)}
                />
              );
            })}
          </div>
        </Fragment>
      ))}
      {loose.length && byLang.size === 0 ? (
        <div className="tl-grid2">
          {loose.map((a) => (
            <AudioPlayer key={a} src={contentUrl(base, a, model.rev)} label={a.split("/").pop() ?? a} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Voice auditions on a per-language stage: every voice of every language on the same sample line, one pick per language.
 * Selecting a voice swaps it into the set; Confirm sends the set (`ja-konoha,en-calm`).
 */
export function VoicePickBody({ model, stage, selected, onSelect, base }: { model: RunModel; stage: DerivedStage; selected: string | null; onSelect: (id: string) => void; base: string }) {
  const groups = optionLangGroups(stage);
  if (!groups) return null;
  const chosen = new Set(pickParts(selected));
  const picked = new Set(pickParts(stage.pick));
  const choose = (id: string, lang: string) => {
    const next = [...groups.entries()].map(([l, list]) => (l === lang ? id : list.find((o) => chosen.has(o.id))?.id ?? list.find((o) => o.recommended)?.id ?? list[0].id));
    onSelect(next.join(","));
  };
  return (
    <div>
      <p className="tl-lead">Each voice reads the same sample line. Pick one voice per language — the VO stage records every line with the voices you confirm.</p>
      {[...groups.entries()].map(([lang, list]) => (
        <Fragment key={lang}>
          <div className="tl-h3">{langLabel(lang)}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {list.map((o) => {
              const docEntry = optionDocs(model, o).find((d) => isRec(d.doc) && ("voiceId" in (d.doc as Rec) || "sample" in (d.doc as Rec)));
              const doc = (docEntry?.doc ?? {}) as Rec;
              const sample = resolveRef(docEntry?.path ?? "", str(doc.sample)) ?? optionMedia(o, "audio")[0] ?? (o.preview ?? null);
              const on = chosen.has(o.id);
              return (
                <div key={o.id} className={`tl-voice${on ? " tl-on" : ""}`} onPointerDown={(e) => e.stopPropagation()}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", minWidth: 190, flex: 1 }}>
                    <input type="radio" name={`voice-${lang}`} checked={on} onChange={() => choose(o.id, lang)} />
                    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontWeight: 600, fontSize: 12.5 }}>
                        {brand(str(doc.name) || o.title)} {o.recommended ? <span className="tl-chip tl-rec" style={{ marginLeft: 4 }}>recommended</span> : null}
                        {picked.has(o.id) ? <span className="tl-chip tl-st-confirmed" style={{ marginLeft: 4 }}>confirmed</span> : null}
                      </span>
                      {o.summary ? <span className="tl-muted" style={{ fontSize: 11.5 }}>{brand(o.summary)}</span> : null}
                    </span>
                  </label>
                  {/* a fixed player column: a long voice note used to squeeze the player (or push it off the page) */}
                  <div style={{ flex: "0 0 300px", minWidth: 0 }}>
                    <AudioPlayer src={sample ? contentUrl(base, sample, model.rev) : null} label={o.id} sub={doc.mock ? `MOCK · say ${str(doc.mockVoice)}` : str(doc.voiceId)} />
                  </div>
                </div>
              );
            })}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

// ── VO ──────────────────────────────────────────────────────────────────────

export function VoBody({ model, option, base }: BodyProps) {
  const lines = voLines(model, option);
  if (lines.length === 0) return <Missing what="No takes yet (stages/vo/lines.json)." />;
  const groups = new Map<string, typeof lines>();
  for (const l of lines) {
    const key = `${l.lang}|${l.sceneId}|${l.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  }
  const langs = [...new Set(lines.map((l) => l.lang))];
  return (
    <div>
      <p className="tl-lead">Two takes per line, read-checked against the script. The picked take is marked.</p>
      {langs.map((lang) => (
        <Fragment key={lang}>
          <div className="tl-h3">{langLabel(lang)}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[...groups.entries()]
              .filter(([k]) => k.startsWith(`${lang}|`))
              .map(([key, takes]) => (
                <div key={key}>
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 5 }}>
                    <span className="tl-sid tl-mono tl-muted">{takes[0].sceneId}</span>
                    <span style={{ fontSize: 12.5 }}>{brand(takes[0].text)}</span>
                  </div>
                  <div className="tl-grid2">
                    {takes.map((t, i) => (
                      <AudioPlayer
                        key={`${t.take}-${i}`}
                        src={t.file ? contentUrl(base, t.file, model.rev) : null}
                        label={`Take ${t.take}${t.picked ? " · picked" : ""}`}
                        sub={[t.durS ? `${t.durS.toFixed(2)} s` : "", t.check ?? ""].filter(Boolean).join(" · ") || undefined}
                      />
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

// ── Assets ──────────────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<string, string> = {
  library: "library",
  figma: "Figma",
  codex: "GPT Image 2",
  fal: "Seedance",
  openrouter: "image fallback",
};

export function AssetsBody({ model, option, base }: BodyProps) {
  const items = assetItems(model, option);
  if (items.length === 0) return <Missing what="No assets listed in this option yet." />;
  const gaps = items.filter((i) => i.status === "gap").length;
  return (
    <div>
      <p className="tl-lead">
        {items.length} items · {items.filter((i) => i.status !== "gap").length} from the library or generated
        {gaps ? ` · ${gaps} still to generate (paid: priced before it runs)` : ""}.
      </p>
      <div className="tl-assets">
        {items.map((it, i) => {
          const url = it.file ? contentUrl(base, it.file, model.rev) : null;
          const video = it.file && /\.(mp4|mov|webm)$/i.test(it.file);
          return (
            <div className="tl-asset" key={`${it.file ?? "gap"}-${i}`}>
              {video ? (
                <VideoPoster src={url} aspect="16 / 10" />
              ) : (
                <div className="tl-asset-img" style={url ? { backgroundImage: `url("${url}")` } : undefined}>
                  {url ? null : "gap"}
                </div>
              )}
              <div className="tl-asset-cap">
                <span className={`tl-chip ${it.status === "gap" ? "tl-st-awaiting" : it.status === "generated" ? "tl-st-working" : "tl-st-confirmed"}`}>{it.status}</span>
                <span title={it.note ?? it.label}>
                  {it.sceneId ? `${it.sceneId} · ` : ""}
                  {it.label ?? SOURCE_LABEL[it.source] ?? it.source}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Video stages (picture, sound) ──────────────────────────────────────────

export function VideoBody({ model, option, base, stage }: BodyProps & { stage: string }) {
  const video =
    (option?.preview && /\.(mp4|mov|webm)$/i.test(option.preview) ? option.preview : null) ??
    optionMedia(option, "video")[0] ??
    `stages/${stage}/preview.mp4`;
  const docs = optionDocs(model, option);
  return (
    <div className="tl-vsplit">
      {/* the stage page already shows the option summary above the body (StagePage): not repeated under the player */}
      <VideoPlayer src={contentUrl(base, video, model.rev)} aspect="16 / 9" maxHeight={420} emptyText="No preview render yet" />
      {docs.length ? (
        <div>
          <div className="tl-h3">Files</div>
          <dl className="tl-kv">
            {docs.map((d) => (
              <Fragment key={d.path}>
                <dt className="tl-mono">{d.path.split("/").pop()}</dt>
                <dd className="tl-muted">{describeDoc(d.doc)}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function describeDoc(doc: unknown): string {
  if (Array.isArray(doc)) return `${doc.length} entries`;
  if (!isRec(doc)) return "";
  const keys = Object.keys(doc);
  const bits: string[] = [];
  for (const k of keys.slice(0, 6)) {
    const v = doc[k];
    if (Array.isArray(v)) bits.push(`${k}: ${v.length}`);
    else if (typeof v === "string" || typeof v === "number") bits.push(`${k}: ${String(v).slice(0, 40)}`);
  }
  return bits.join(" · ");
}

// ── QC ──────────────────────────────────────────────────────────────────────

export function QcBlock({ qc }: { qc: Rec | null }) {
  if (!qc) return <p className="tl-note">No QC record yet.</p>;
  const checks = (Array.isArray(qc.checks) ? qc.checks : []).filter(isRec);
  return (
    <div>
      <dl className="tl-kv">
        {qc.durationS !== undefined ? (
          <>
            <dt>Duration</dt>
            <dd>{Number(qc.durationS).toFixed(2)} s{qc.frames ? ` · ${String(qc.frames)} frames` : ""}</dd>
          </>
        ) : null}
        {qc.lufs !== undefined ? (
          <>
            <dt>Loudness</dt>
            <dd>
              {String(qc.lufs)} LUFS{qc.truePeak !== undefined ? ` · TP ${String(qc.truePeak)} dBTP` : ""}
            </dd>
          </>
        ) : null}
        {qc.pass !== undefined ? (
          <>
            <dt>Result</dt>
            <dd>{qc.pass ? <span className="tl-yes">pass</span> : <span style={{ color: "var(--tl-error)", fontWeight: 600 }}>fail</span>}</dd>
          </>
        ) : null}
      </dl>
      {checks.length ? (
        <ul style={{ margin: "8px 0 0", paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
          {checks.map((c, i) => (
            <li key={i} style={{ display: "flex", gap: 8, fontSize: 12.5, alignItems: "baseline" }}>
              <span className={`tl-chip ${c.status === "pass" ? "tl-st-confirmed" : c.status === "fail" ? "tl-st-changed" : "tl-st-empty"}`}>{str(c.status) || "unchecked"}</span>
              <span>{str(c.label ?? c.id)}</span>
              {c.note ? <span className="tl-muted">— {str(c.note)}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function DeliverBody({ model, deliveryDir }: { model: RunModel; deliveryDir: string }) {
  const reports = Object.entries(model.texts)
    .filter(([p]) => p.startsWith("stages/deliver/") && p.endsWith(".json"))
    .map(([p, t]) => ({ path: p, doc: parseJson<Rec>(t) }));
  const stage = model.byId.deliver;
  return (
    <div>
      <p className="tl-lead">
        After the final OK, every final is copied to <b className="tl-mono">{deliveryDir || "the delivery folder"}{model.film?.run.id ?? ""}/</b>, the previous final is kept as a fallback, and a reminder is set.
      </p>
      <dl className="tl-kv">
        <dt>Status</dt>
        <dd>{stage.status}</dd>
        {stage.notes ? (
          <>
            <dt>Notes</dt>
            <dd>{stage.notes}</dd>
          </>
        ) : null}
        {reports.map((r) => (
          <Fragment key={r.path}>
            <dt className="tl-mono">{r.path.split("/").pop()}</dt>
            <dd className="tl-muted">{describeDoc(r.doc)}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}
