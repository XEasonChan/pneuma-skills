// footage-card · footage (or a still) in the film's rounded card (outside the hook and transitions, footage lives in cards), with an optional label pill; it can float up to the
// top-left as a picture-in-picture and stay over the next scene (`pip.hold` s) before it folds away (shrink + fade + blur).
// 9:16: the card sits in the upper half; the PiP goes to the top-left corner.
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {defineScene, type SceneCtx} from '../grammar';
import {tx, type Bi} from '../core/text';
import {EL, kk} from '../core/motion';
import {FloatingVideoCard, type HandoffRect} from '../handoff';
import {assetSrc} from '../assets';
import {fontFor} from '../brand/tokens';

export type FootageCardProps = {
  /** 'assets/footage/x.mp4' (the run's), 'kit:placeholder/still.svg' (a kit placeholder) or a URL; images work too */ src: string;
  label?: Bi;
  /** float up to the top-left as a PiP at `at` (s, default len − 0.9) and stay `hold` s over the next scene */ pip?: {at?: number; hold?: number};
  playbackRate?: number; startFrom?: number;
};

const RECT = {
  '16x9': {center: {x: 330, y: 120, w: 1260, h: 709, r: 30}, pip: {x: 72, y: 104, w: 560, h: 315, r: 26}},
  '9x16': {center: {x: 60, y: 420, w: 960, h: 540, r: 30}, pip: {x: 40, y: 120, w: 440, h: 248, r: 22}},
} as const;

const FootageCardC: React.FC<{p: FootageCardProps; c: SceneCtx}> = ({p, c}) => {
  const t = c.t;
  const R = RECT[c.aspect];
  const inK = kk(t, 0, 0.6, EL.enter);
  const pipAt = p.pip ? p.pip.at ?? c.len - 0.9 : undefined;
  const hold = p.pip?.hold ?? 0;
  const from: HandoffRect = {...R.center, y: R.center.y + (1 - inK) * 40};
  const labelK = kk(t, 0.35, 0.4) * (pipAt !== undefined ? 1 - kk(t, pipAt - 0.2, 0.3) : 1);
  return (
    <AbsoluteFill>
      <FloatingVideoCard t={t} src={assetSrc(p.src)} from={from} to={pipAt !== undefined ? R.pip : undefined} moveAt={pipAt} moveDur={0.8} foldAt={pipAt !== undefined ? c.len + hold - 0.6 : undefined}
        playbackRate={p.playbackRate} startFrom={p.startFrom}
        label={p.label ? (
          <div style={{position: 'absolute', left: 24, bottom: 22, opacity: labelK, padding: '8px 18px', borderRadius: 999, background: 'rgba(12,20,38,.55)', color: '#fff', fontFamily: fontFor(c.lang), fontSize: c.portrait ? 30 : 28, fontWeight: 500}}>{tx(p.label, c.lang)}</div>
        ) : undefined} />
    </AbsoluteFill>
  );
};

export const footageCard = defineScene<FootageCardProps>({
  type: 'footage-card',
  title: 'Footage card',
  description: 'Footage or a still in the rounded card, optional label pill; optional PiP that floats top-left over the next scene. (Full-frame footage belongs only in the hook and transitions.)',
  defaults: {src: 'kit:placeholder/still.svg', label: {en: 'Placeholder footage', ja: 'プレースホルダー映像'}},
  defaultLen: 4.5,
  band: 'free',
  transitionOut: {kind: 'carry', xf: 0.5},
  spill: (p) => p.pip?.hold ?? 0,
  component: FootageCardC,
  preview: {},
});
