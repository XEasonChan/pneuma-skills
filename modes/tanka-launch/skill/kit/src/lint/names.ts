// launch-kit · names lint: a run's on-screen text should use roles ("Client contact", "Design lead") rather than personal names (some
// stories may name a buyer, so the QC shows these as WARNINGS, not errors). `lintNames(doc)` scans every text
// prop of every scene (+ its `vo` and `onScreen` text, which reach the captions) for capitalised personal names and returns warnings.
//
//   import {lintNames} from 'launch-kit';           lintNames(scenesJson) → NameWarning[]
//   node <kit>/src/lint/names-cli.ts <scenes.json> [--json] [--allow A,B]   (Node ≥ 23.6 runs .ts directly; exit 1 = warnings)
//
// Heuristics (no dictionary, no network, deterministic):
//   EN  · a word after a greeting / sign-off ("Hi Evan,", "Thanks, Evan", "Dear Ms Sato")
//       · a capitalised word in the middle of a sentence that is not a known brand / app / month / day / role word ("Her client Evan")
//       · a text's last sentence that is one capitalised word (the sign-off: "… today. Maya")
//       · a possessive "Evan's" / "Evan’s"
//   JA  · a name + honorific: …さん / 様 / さま / くん / ちゃん / 氏 (not after 皆 / お客 / 担当者 / ご担当者 …)
//   Company words next to a name ("Brightline Co.", "Inc", 社) are companies, not people. `allow` whitelists words.
type Json = null | boolean | number | string | Json[] | {[k: string]: Json};
export type NameWarning = {sceneId: string; sceneType: string; path: string; lang: 'en' | 'ja'; name: string; text: string; rule: string};

/** prop keys that never hold on-screen text (asset paths, ids, enums) */
const NON_TEXT = new Set(['app', 'src', 'img', 'image', 'frames', 'icon', 'face', 'assistant', 'channel', 'mode', 'type', 'id', 'state', 'cat', 'variant', 'tone', 'layout',
  'world', 'k', 's', 'status_', 'camera', 'bg', 'exit', 'align', 'ground', 'transitionOut', 'units', 'keys', 'match', 'selKw', 'pick', 'depth', 'at', 'from_', 'file_']);
const STOP = new Set(`I A An The This That These Those It Its We Our Us You Your Yours They Their He She His Her Hi Hello Hey Dear Thanks Thank Best Cheers Regards Re Fwd Fw Cc
Mon Monday Tue Tuesday Wed Wednesday Thu Thursday Fri Friday Sat Saturday Sun Sunday Today Tomorrow Yesterday Tonight Morning Evening Night Weekly Daily Monthly Annual
Jan January Feb February Mar March Apr April May Jun June Jul July Aug August Sep Sept September Oct October Nov November Dec December Q1 Q2 Q3 Q4
Gmail Google Outlook Microsoft Slack Notion Meet Teams Zoom WhatsApp LINE Line Airtable Sheets Drive Excel SharePoint Shopify Todoist Figma Calendar Contacts
Email Mail Chat Message Meeting Notes Note Memo Page Site Draft Reply Send Sent Confirm Cancel Done Edit View SOP PDF AI OK FYI ETA KPI PR
Client Clients Customer Buyer Supplier Vendor Partner Team Teammate Manager Lead Owner Admin Sales Design Designer Producer Account Operations Ops Finance Legal Support Marketing Engineering
President CEO CTO COO CFO VP Director Head Plant Purchasing Shipping Kiln Studio Store Shop Office HQ New York Tokyo Kyoto Osaka London Paris Japan US USA UK EU
Proposal Option Recommended Agenda Review Kickoff Kick Handover Contract Clause Order Invoice Quote Report Plan Project Prototype Walkthrough Schedule Reschedule Rescheduling
Every Not On Now Your Before After With Without All One Two Three Each Just Only Also And Or But If When While Then So Yes No Please Could Would Can Will Let Here There What Where Why How Who
Earlier Follow Up Updated Update New Next Last First Second Third Final Welcome Good Great Meet Brand Mobile Capacity Tone Promised Arrival Wall Room
Co Inc Ltd Corp LLC Everyone Everybody Someone Anyone Nobody Waiting Checked Booked Ready Friday's Thursday's Monday's`.split(/\s+/));
const COMPANY = /^(Co\.?|Inc\.?|Ltd\.?|LLC|Corp\.?|Group|GmbH|KK|Studio|Studios|Labs?|Company)$/;
const JA_HON = /([゠-ヿ一-鿿A-Za-z]{1,8})(さん|様|さま|くん|ちゃん|氏)/g;
const JA_NOT = /(皆|みな|お客|客|担当|担当者|ご担当者|先方|取引先|社長|部長|課長|店長|関係者|方々|各位|お得意)$/;

let COMPANIES = new Set<string>();
const scanEn = (text: string): {name: string; rule: string}[] => {
  const out: {name: string; rule: string}[] = [];
  const add = (name: string, rule: string) => { if (!out.some((o) => o.name === name)) out.push({name, rule}); };
  const isName = (w: string) => /^[A-Z][a-z]{1,}$/.test(w) && !STOP.has(w) && !COMPANIES.has(w);
  // greetings / sign-offs
  for (const m of text.matchAll(/\b(?:Hi|Hello|Hey|Dear|Thanks|Thank you|Best|Cheers|Regards|Sincerely)[,!]?\s+(?:Mr\.?|Ms\.?|Mrs\.?|Dr\.?)?\s*([A-Z][a-z]+)/g)) if (!STOP.has(m[1]) && !COMPANIES.has(m[1])) add(m[1], 'greeting / sign-off');
  // possessives
  for (const m of text.matchAll(/\b([A-Z][a-z]+)(?:'s|’s)\b/g)) if (isName(m[1])) add(m[1], 'possessive');
  // mid-sentence capitalised words (sentence / segment starts are skipped)
  const segs = text.split(/(?<=[.!?:·—–\-(\n"“])\s+|\s*[·|]\s*|\n/);
  for (const seg of segs) {
    const words = seg.split(/\s+/).filter(Boolean);
    words.forEach((raw, i) => {
      const w = raw.replace(/^[("“'‘\[]+|[)"”'’\].,;:!?]+$/g, '').replace(/(?:'s|’s)$/, '');
      const next = words[i + 1]?.replace(/[,;:!?]+$/, '') ?? '';
      if (!isName(w) || COMPANY.test(next)) return;
      if (i > 0) add(w, 'capitalised word mid-sentence');
    });
  }
  // a last sentence that is a single capitalised word = the sign-off
  const last = text.trim().split(/(?<=[.!?])\s+/).pop()?.trim().replace(/[.!]$/, '') ?? '';
  if (/^[A-Z][a-z]+$/.test(last) && !STOP.has(last) && !COMPANIES.has(last) && text.trim().includes(' ')) add(last, 'sign-off');
  return out;
};
const scanJa = (text: string): {name: string; rule: string}[] => {
  const out: {name: string; rule: string}[] = [];
  for (const m of text.matchAll(JA_HON)) {
    const who = m[1];
    if (JA_NOT.test(who)) continue;
    if (!out.some((o) => o.name === who + m[2])) out.push({name: who + m[2], rule: 'name + honorific'});
  }
  // Latin names inside Japanese text follow the EN rules (greeting / possessive), not the mid-sentence one
  for (const x of scanEn(text)) if (x.rule !== 'capitalised word mid-sentence') out.push(x);
  return out;
};

/** scan a scenes.json (object or JSON string) for personal names in on-screen text; `allow` = words that are fine (a brand, a place) */
export function lintNames(docIn: unknown, o: {allow?: string[]} = {}): NameWarning[] {
  const doc = (typeof docIn === 'string' ? JSON.parse(docIn) : docIn) as {scenes?: {id?: string; type?: string; props?: Json; vo?: Json; onScreen?: Json}[]};
  const allow = new Set(o.allow ?? []);
  // companies: any capitalised word right before Co. / Inc / Ltd / 社 anywhere in the doc is a company everywhere
  const all = JSON.stringify(doc?.scenes ?? []);
  COMPANIES = new Set([...all.matchAll(/\b([A-Z][A-Za-z]+)\s+(?:Co\.?|Inc\.?|Ltd\.?|LLC|Corp\.?|GmbH)(?![a-z])/g), ...all.matchAll(/([A-Z][A-Za-z]+)(?:社|株式会社)/g)].map((m) => m[1]));
  const out: NameWarning[] = [];
  const seen = new Set<string>();
  (doc?.scenes ?? []).forEach((s, si) => {
    const push = (path: string, lang: 'en' | 'ja', text: string) => {
      for (const f of lang === 'ja' ? scanJa(text) : scanEn(text)) {
        if (allow.has(f.name)) continue;
        const key = `${s.id}|${path}|${f.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({sceneId: s.id ?? `#${si}`, sceneType: s.type ?? '?', path, lang, name: f.name, text, rule: f.rule});
      }
    };
    const walk = (v: Json, path: string, lang: 'en' | 'ja' | null) => {
      if (typeof v === 'string') {
        if (/^(kit:|assets\/|https?:|\.{0,2}\/)/.test(v) || /\.(png|jpe?g|webm|mp4|mov|svg|pdf|json)$/i.test(v)) return;
        const L = lang ?? (/[぀-ヿ一-鿿]/.test(v) ? 'ja' : 'en');
        push(path, L, v);
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, lang));
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          if (NON_TEXT.has(k)) continue;
          walk(x, `${path}.${k}`, k === 'en' ? 'en' : k === 'ja' ? 'ja' : lang);
        }
      }
    };
    walk(s.props ?? {}, `scenes[${si}].props`, null);
    if (s.onScreen) walk(s.onScreen, `scenes[${si}].onScreen`, null);
    if (s.vo && typeof s.vo === 'object' && !Array.isArray(s.vo)) walk({en: (s.vo as Record<string, Json>).en ?? null, ja: (s.vo as Record<string, Json>).ja ?? null} as Json, `scenes[${si}].vo`, null);
  });
  // pass 2: a name found once is flagged wherever it appears (e.g. at a sentence start: "Maya runs a small studio.")
  const names = [...new Set(out.filter((w) => /^[A-Z]/.test(w.name)).map((w) => w.name))];
  if (names.length) {
    const re = new RegExp(`\\b(${names.join('|')})\\b`);
    const texts: {sceneId: string; sceneType: string; path: string; lang: 'en' | 'ja'; text: string}[] = [];
    (doc?.scenes ?? []).forEach((s, si) => {
      const walk = (v: Json, path: string, lang: 'en' | 'ja' | null) => {
        if (typeof v === 'string') texts.push({sceneId: s.id ?? `#${si}`, sceneType: s.type ?? '?', path, lang: lang ?? (/[\u3040-\u30ff\u4e00-\u9fff]/.test(v) ? 'ja' : 'en'), text: v});
        else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, lang));
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (!NON_TEXT.has(k)) walk(x, `${path}.${k}`, k === 'en' ? 'en' : k === 'ja' ? 'ja' : lang); }
      };
      walk(s.props ?? {}, `scenes[${si}].props`, null);
      if (s.onScreen) walk(s.onScreen, `scenes[${si}].onScreen`, null);
      if (s.vo && typeof s.vo === 'object' && !Array.isArray(s.vo)) walk({en: (s.vo as Record<string, Json>).en ?? null, ja: (s.vo as Record<string, Json>).ja ?? null} as Json, `scenes[${si}].vo`, null);
    });
    for (const x of texts) {
      const m = re.exec(x.text);
      if (!m || allow.has(m[1])) continue;
      const key = `${x.sceneId}|${x.path}|${m[1]}`;
      if (seen.has(key) || [...seen].some((k) => k.startsWith(`${x.sceneId}|${x.path}|${m[1]}`))) continue;
      seen.add(key);
      out.push({...x, name: m[1], rule: 'the same name as elsewhere in the film'});
    }
  }
  return out;
}

/** one line per warning, for a QC log */
export const formatNameWarnings = (w: NameWarning[]): string =>
  w.length ? w.map((x) => `names: ${x.sceneId} (${x.sceneType}) ${x.path} [${x.lang}] "${x.name}" — ${x.rule}`).join('\n') : 'names: no personal names found';
