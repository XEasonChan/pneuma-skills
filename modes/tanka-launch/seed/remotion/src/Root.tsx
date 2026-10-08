// The run's compositions: every edition × aspect × language, rendered from ../scenes.json (+ ../../stages/vo/lines.json when it exists).
//   short-16x9-{en,ja,en-jasub} · short-9x16-{en,ja,en-jasub} · full-16x9-{en,ja,en-jasub}   (+ the kit's Preview gallery)
// Custom scenes: add a file in ./custom/ that calls defineScene(...) and import it in ./custom/index.ts.
import React from 'react';
import {filmCompositions, type ScenesDoc} from 'launch-kit';
import {KitPreviewCompositions} from 'launch-kit/preview';
import scenes from '../scenes.json';
import './custom';

export const Root: React.FC = () => (
  <>
    {filmCompositions({scenes: scenes as unknown as ScenesDoc, editions: ['short', 'full'], aspects: ['16x9', '9x16'], fullAspects: ['16x9']})}
    <KitPreviewCompositions />
  </>
);
