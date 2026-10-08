// logo-lockup · any logo on its ground: the mark lands (spring), slides aside while the wordmark wipes in left → right (soft leading
// edge), the tagline rises under it. The run supplies its own logo (`logo`: an image path such as 'assets/brand/logo.svg' or a kit
// placeholder 'kit:placeholder/mark.svg') and its wordmark text (`wordmark`); with neither, a neutral placeholder mark is drawn.
// 'dark' = white type on a night ground; 'light' = dark type on the pale ground. 9:16 stacks the mark over the wordmark.
import React from 'react';
import {AbsoluteFill, Img, spring} from 'remotion';
import {defineScene, type SceneCtx} from '../grammar';
import {tx, brandCaps, type Bi} from '../core/text';
import {EL, kk, lerp, slowPush, zoomAbout} from '../core/motion';
import {assetSrc} from '../assets';
import {BRAND, fontFor} from '../brand/tokens';

export type LogoLockupProps = {
  /** the mark: an image path (run asset, 'kit:…' or URL); default: a neutral placeholder shape */ logo?: string;
  /** the wordmark text beside / under the mark (default: none) */ wordmark?: string;
  tagline?: Bi; line2?: Bi;
  tone?: 'dark' | 'light';
  /** s: the mark lands · the wordmark wipes · the tagline rises (default 0.15 · 0.55 · 1.3) */ at?: {mark?: number; word?: number; tag?: number};
  /** fine print at the bottom (e.g. a fiction disclaimer) */ note?: Bi;
};

/** the neutral placeholder mark: a rounded square with a ring (no company's logo) */
const PlaceholderMark: React.FC<{size: number; color: string}> = ({size, color}) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <rect x="6" y="6" width="88" height="88" rx="24" fill={color} />
    <circle cx="50" cy="50" r="20" fill="none" stroke="#fff" strokeWidth="9" />
  </svg>
);

const LogoLockupC: React.FC<{p: LogoLockupProps; c: SceneCtx}> = ({p, c}) => {
  const t = c.t, f = Math.round(t * c.fps);
  const light = p.tone === 'light';
  const A = {mark: 0.15, word: 0.55, tag: 1.3, ...p.at};
  const drop = spring({frame: f - Math.round(A.mark * c.fps), fps: c.fps, config: {stiffness: 260, damping: 16}});
  const markK = kk(t, A.mark, 0.4);
  const word = brandCaps(p.wordmark ?? '');
  const hasWord = word.length > 0;
  const slide = hasWord ? kk(t, A.word - 0.1, 0.7, EL.morph) : 0;
  const wipe = kk(t, A.word, 0.95, EL.enter);
  const tagK = kk(t, A.tag, 0.6, EL.enter), l2K = kk(t, A.tag + 0.45, 0.6, EL.enter);
  const noteK = kk(t, A.tag + 0.8, 0.6);
  const cx = c.W / 2, cy = c.H / 2;
  const P = c.portrait;
  const wordSize = P ? 116 : 132;
  // an estimate of the bold wordmark's width for the layout (capitals are wider); the text itself is placed in its box
  const ww = [...word].reduce((a, ch) => a + wordSize * (/[A-Z0-9]/.test(ch) ? 0.82 : ch === ' ' ? 0.3 : 0.58), 0);
  const mark = P ? 240 : 200;
  const gap = 45;
  const L0 = cx - (mark + gap + ww) / 2;
  const mx = P || !hasWord ? cx : lerp(cx, L0 + mark / 2, slide);
  const my = P && hasWord ? lerp(cy - 40, cy - 150, slide) : cy - 20;
  const wx = P ? cx - ww / 2 : L0 + mark + gap, wy = P ? cy + 60 : cy - 20;
  const edge = lerp(-60, ww + 60, wipe);
  const mask = `linear-gradient(90deg, #000 ${edge - 60}px, transparent ${edge + 60}px)`;
  const ink = light ? BRAND.ink : '#FFFFFF';
  const sub = light ? BRAND.ink2 : 'rgba(255,255,255,.9)';
  const font = fontFor(c.lang);
  const tagY = P ? cy + 200 : cy + 110;
  // living hold after the tagline: a slow push on the lockup (a longer scene keeps pushing, it never freezes)
  const z = slowPush(t, {from: A.tag + 0.6, rate: 0.006, max: 0.03});
  return (
    <AbsoluteFill style={{transform: zoomAbout(z, cx, cy), transformOrigin: '0 0'}}>
      <div style={{position: 'absolute', left: mx - mark / 2, top: my - mark / 2 + (1 - drop) * -8, width: mark, height: mark, opacity: markK, display: 'grid', placeItems: 'center'}}>
        {p.logo ? <Img src={assetSrc(p.logo)} style={{maxWidth: '100%', maxHeight: '100%', objectFit: 'contain'}} /> : <PlaceholderMark size={mark} color={light ? BRAND.accent : BRAND.accentL} />}
      </div>
      {hasWord ? (
        <div style={{position: 'absolute', left: wx - 20, top: wy - wordSize * 0.6, width: ww + 40, height: wordSize * 1.2, display: 'flex', alignItems: 'center', justifyContent: P ? 'center' : 'flex-start',
          fontFamily: font, fontWeight: 700, fontSize: wordSize, letterSpacing: '0.02em', color: ink, whiteSpace: 'nowrap', WebkitMaskImage: wipe < 1 ? mask : undefined, maskImage: wipe < 1 ? mask : undefined}}>{word}</div>
      ) : null}
      {p.tagline ? (
        <div style={{position: 'absolute', left: P ? 70 : 0, right: P ? 70 : 0, top: tagY, textAlign: 'center', fontFamily: font, fontWeight: 500, fontSize: 46, lineHeight: 1.35, color: sub,
          opacity: tagK, transform: `translateY(${(1 - tagK) * 18}px)`, filter: tagK < 0.99 ? `blur(${(1 - tagK) * 6}px)` : undefined, textWrap: 'balance' as React.CSSProperties['textWrap']}}>{tx(p.tagline, c.lang)}</div>
      ) : null}
      {p.line2 ? (
        <div style={{position: 'absolute', left: 0, right: 0, top: tagY + (P ? 140 : 70), textAlign: 'center', fontFamily: font, fontWeight: 500, fontSize: P ? 38 : 34, color: light ? BRAND.accent : BRAND.sky, opacity: l2K, transform: `translateY(${(1 - l2K) * 14}px)`}}>{tx(p.line2, c.lang)}</div>
      ) : null}
      {p.note ? <div style={{position: 'absolute', left: 0, right: 0, bottom: P ? 120 : 34, textAlign: 'center', fontFamily: font, fontSize: 18, color: light ? BRAND.mute : 'rgba(255,255,255,.6)', opacity: noteK}}>{tx(p.note, c.lang)}</div> : null}
    </AbsoluteFill>
  );
};

export const logoLockup = defineScene<LogoLockupProps>({
  type: 'logo-lockup',
  title: 'Logo lockup',
  description: "The run's logo lands, its wordmark wipes in, the tagline rises (dark or light ground; stacked in 9:16). Takes any logo image.",
  defaults: {tone: 'dark', wordmark: 'ACME', tagline: {en: 'Your launch line goes here.', ja: 'ここにキャッチコピーが入ります。'}},
  defaultLen: 3.9,
  band: 'free',
  muteCaptions: true, // the logo line is the picture (no caption over the lockup)
  ground: 'deep',
  transitionOut: {kind: 'carry', xf: 0.6},
  component: LogoLockupC,
  preview: {logo: 'kit:placeholder/mark.svg'},
});
