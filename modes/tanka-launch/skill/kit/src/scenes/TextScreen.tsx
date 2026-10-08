// text-screen · typed type with key words, one or two lines.
// Each word (EN) or space-separated phrase (JA) writes on left → right behind a thin caret; with a VO line in the scene the typing
// spreads over the line, else over `typeS`. Key words ink from the text colour to the accent 0.3 s after they land and get one light
// pass. Exit: the words rise out, staggered, with a soft blur, before the end (exit: 0 hands the words to the next scene).
// Layout: the browser wraps the words (flex-wrap) inside the measure (1680 px in 16:9, 920 px in 9:16); the block sits at the centre
// (a little above it in 9:16, clear of the caption band).
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {defineScene, type SceneCtx} from '../grammar';
import {tx, type Bi} from '../core/text';
import {c01, kk, lerp, EASE, slowPush, zoomAbout, idleBeats, bell} from '../core/motion';
import {TYPE, BRAND, fontFor} from '../brand/tokens';

export type TextLine = {text: Bi; keys?: Bi[]};
export type TextScreenProps = {
  lines: TextLine[];
  /** type size override (px); default TYPE[aspect].hero / sub for the second line */ size?: number;
  /** typing window, s (default: the scene's VO line, else 0.35 → 0.35 + chars / speed) */ typeFrom?: number; typeS?: number;
  caret?: boolean;
  /** 'light' (dark ink on a pale ground) or 'dark' (white ink on a night ground) */ tone?: 'light' | 'dark';
  /** seconds before the end the words start leaving (0 = no exit: a hand-off scene takes the words) */ exit?: number;
  /** the key-word colour (default the theme accent) */ accent?: string;
};

type Unit = {text: string; key: boolean; line: number; size: number; at: number; dur: number; idx: number};

const TextScreenC: React.FC<{p: TextScreenProps; c: SceneCtx}> = ({p, c}) => {
  const ja = c.lang === 'ja';
  const T = TYPE[c.aspect];
  const dark = p.tone === 'dark';
  const ink = dark ? '#FFFFFF' : BRAND.ink;
  const accent = p.accent ?? (dark ? BRAND.sky : BRAND.accent);
  const maxW = c.portrait ? 920 : 1680;
  // units per line (EN words; JA space-separated phrases), each knows whether it is a key word
  const units: Unit[] = [];
  p.lines.forEach((l, li) => {
    const text = tx(l.text, c.lang);
    const keys = (l.keys ?? []).map((k) => tx(k, c.lang)).filter(Boolean);
    const size = p.size ?? (li === 0 ? T.hero[c.lang] : T.sub[c.lang]);
    for (const w of text.split(/\s+/).filter(Boolean)) units.push({text: w, key: keys.some((k) => w === k || k.split(/\s+/).includes(w)), line: li, size, at: 0, dur: 0, idx: units.length});
  });
  // timing: VO-keyed when the scene has a line, else by characters
  const chars = units.reduce((a, u) => a + u.text.length + (ja ? 0 : 1), 0);
  const speed = ja ? 9 : 20; // chars / s
  const v = c.vo[0];
  const t0 = p.typeFrom ?? (v ? Math.max(0.15, v.at - 0.05) : 0.35);
  const dur = p.typeS ?? (v ? Math.max(0.6, Math.min(v.dur * 0.92, (chars / speed) * 1.4)) : Math.max(0.6, chars / speed));
  const perChar = dur / Math.max(1, chars);
  let acc = 0;
  for (const u of units) { u.at = t0 + acc * perChar; u.dur = Math.max(0.03, perChar * u.text.length); acc += u.text.length + (ja ? 0 : 1); }
  const lastAt = units.length ? units[units.length - 1].at + units[units.length - 1].dur : t0;
  const ex = p.exit ?? 0.75;
  const E = c.len - ex;
  const typingIdx = units.findIndex((u) => c.t >= u.at && c.t < u.at + u.dur);
  const shownIdx = units.reduce((m, u, i) => (c.t >= u.at ? i : m), -1);
  const caretIdx = typingIdx >= 0 ? typingIdx : shownIdx;
  const blink = typingIdx >= 0 || c.t < lastAt + 0.2 ? 1 : Math.floor((c.t - lastAt) / 0.5) % 2 === 0 ? 1 : 0;
  const caretO = (ex > 0 ? 1 - kk(c.t, E - 0.1, 0.15) : 1) * blink * (p.caret === false ? 0 : 1);
  // living hold: the key words get another light pass every ~2.6 s and the block pushes in slowly
  const beats = idleBeats(lastAt + 1.8, E - 0.2, 2.6);
  const cy = c.portrait ? c.H / 2 - 60 : c.H / 2;
  const z = slowPush(c.t, {from: lastAt + 0.4, rate: 0.006, max: 0.035});
  const lines = [...new Set(units.map((u) => u.line))];
  return (
    <AbsoluteFill style={{transform: zoomAbout(z, c.W / 2, cy), transformOrigin: '0 0'}}>
      <div style={{position: 'absolute', left: (c.W - maxW) / 2, width: maxW, top: cy, transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10}}>
        {lines.map((li) => (
          <div key={li} style={{display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: ja ? 0 : '0.26em', rowGap: 6, fontSize: units.find((u) => u.line === li)!.size, lineHeight: 1.25,
            fontFamily: fontFor(c.lang), fontWeight: 600, letterSpacing: ja ? '0.02em' : '-0.01em', fontFeatureSettings: ja ? '"palt"' : undefined}}>
            {units.filter((u) => u.line === li).map((u) => {
              const k = c01((c.t - u.at) / u.dur);
              const leave = ex > 0 ? EASE.leave(c01((c.t - E - u.idx * 0.028) / 0.42)) : 0;
              const inkK = u.key ? kk(c.t, u.at + u.dur + 0.3, 0.35) : 0;
              const pass = u.key ? Math.max(bell((c.t - (u.at + u.dur + 0.45)) / 0.7), ...beats.map((b) => bell((c.t - b) / 0.7))) : 0;
              return (
                <span key={u.idx} style={{position: 'relative', display: 'inline-block', whiteSpace: 'pre', opacity: k <= 0 ? 0 : 1 - leave,
                  clipPath: k > 0 && k < 1 ? `inset(-20% ${((1 - k) * 100).toFixed(2)}% -20% 0)` : undefined,
                  transform: leave > 0 ? `translateY(${(-lerp(0, 140, leave)).toFixed(1)}px)` : undefined, filter: leave > 0.01 ? `blur(${(8 * leave).toFixed(2)}px)` : undefined,
                  color: inkK > 0 ? mixHex(ink, accent, inkK) : ink, textShadow: pass > 0.01 ? `0 0 ${(18 * pass).toFixed(1)}px ${accent}` : undefined}}>
                  {u.text}
                  {u.idx === caretIdx && caretO > 0 ? (
                    <span style={{position: 'absolute', left: `calc(${(k * 100).toFixed(2)}% + 4px)`, top: '8%', width: Math.max(3, u.size * 0.045), height: '90%', background: dark ? '#fff' : accent, borderRadius: 2, opacity: 0.85 * caretO}} />
                  ) : null}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/** blend two #RRGGBB colours */
const mixHex = (a: string, b: string, k: number) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * c01(k))).join(',')})`;
};

export const textScreen = defineScene<TextScreenProps>({
  type: 'text-screen',
  title: 'Text screen',
  description: 'Typed type with key words (ink → accent + one light pass), one or two lines; words rise off-frame to exit.',
  defaults: {lines: [{text: {en: 'Where did that file go?', ja: 'あの資料、 どこだっけ？'}, keys: [{en: 'file', ja: 'あの資料、'}]}], caret: true, tone: 'light', exit: 0.75},
  defaultLen: 3.2,
  band: 'free',
  muteCaptions: true,
  transitionOut: {kind: 'carry', xf: 0.4},
  component: TextScreenC,
  preview: {lines: [{text: {en: "We've all been there.", ja: 'よくある話。'}, keys: [{en: 'there.', ja: 'よくある話。'}]}, {text: {en: 'The answer is scattered across five apps.', ja: '答えは、 五つのアプリに 散らばっている。'}, keys: [{en: 'scattered', ja: '散らばっている。'}]}]},
});
