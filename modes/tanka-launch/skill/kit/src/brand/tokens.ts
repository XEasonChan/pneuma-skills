// launch-kit · theme tokens (colours, type, radii, layout bands). A neutral default palette: a run restyles the film by editing these in
// its own copy or by passing colours through scene props. Nothing here is a company's brand.
export const BRAND = {
  accent: '#3D5AFE', accentL: '#7B8CFF', sky: '#B9C3FF',
  ink: '#111827', ink2: '#4B5563', mute: '#9CA3AF',
  ground: '#F3F4F6', paper: '#FFFFFF', canvas: '#F5F5F0',
  night: '#0B1020', deep: '#121A33', dawn: '#F4EEE8', line: '#E5E7EB',
  green: '#16A34A', orange: '#EA580C', red: '#DC2626',
} as const;

// System font stacks only (web fonts can time out in headless renders). macOS faces first, then common Linux stand-ins (Inter,
// Noto Sans / Serif JP), so a render works on either.
export const FONT = {
  en: '"SF Pro Display", "SF Pro Text", -apple-system, "Helvetica Neue", Inter, "Noto Sans", "Noto Sans JP", sans-serif',
  enText: '"SF Pro Text", -apple-system, Inter, system-ui, "Noto Sans", "Noto Sans JP", sans-serif',
  ja: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "SF Pro Display", Inter, sans-serif',
  mincho: '"Hiragino Mincho ProN", "Noto Serif JP", serif',
  mono: '"SF Mono", ui-monospace, "Noto Sans Mono", monospace',
} as const;
export const fontFor = (lang: 'en' | 'ja') => (lang === 'ja' ? FONT.ja : FONT.en);

export const RADIUS = {card: 30, floating: 26, panel: 20, chip: 999, bubble: 18, window: 16} as const;
export const SHADOW = {
  card: '0 40px 90px rgba(15,23,42,.20)',
  float: '0 30px 70px rgba(15,23,42,.18), 0 6px 18px rgba(15,23,42,.08)',
  soft: '0 12px 32px rgba(30,52,90,.12)',
} as const;

/** type sizes per aspect (stage px): hero = the type-screen line, sub = its second line */
export const TYPE = {
  '16x9': {hero: {en: 96, ja: 84}, sub: {en: 64, ja: 56}, title: 44, body: 30},
  '9x16': {hero: {en: 92, ja: 80}, sub: {en: 60, ja: 52}, title: 44, body: 32},
} as const;

/** caption band: the subtitle plate's bottom sits 80 px above the frame's bottom; over app UI (scene band 'ui') 24 px up. 9:16 keeps
 *  the same rule, lifted clear of the platform UI (short-video apps cover the bottom ~12 %): 240 / 220 px. */
export const CAPTION_BAND = {
  '16x9': {bottom: 80, ui: 24, size: {en: 34, ja: 32}, maxW: 1320},
  '9x16': {bottom: 240, ui: 220, size: {en: 40, ja: 38}, maxW: 940},
} as const;
/** the UI-safe window per aspect: app windows end above the caption band */
export const UI_SAFE = {
  '16x9': {x: 40, y: 72, w: 1840, h: 912},
  '9x16': {x: 36, y: 140, w: 1008, h: 1400},
} as const;
