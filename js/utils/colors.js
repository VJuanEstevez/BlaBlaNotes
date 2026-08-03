export const COLOR_PALETTE = [
  { name: 'violeta', value: '#6c5ce7' },
  { name: 'rosa', value: '#ff6b9d' },
  { name: 'coral', value: '#ff7d55' },
  { name: 'ambar', value: '#ffb020' },
  { name: 'lima', value: '#8bc34a' },
  { name: 'esmeralda', value: '#26c485' },
  { name: 'cielo', value: '#3ec4e0' },
  { name: 'indigo', value: '#5c6bc0' },
  { name: 'púrpura', value: '#9c27b0' },
];

/** Text tones used when a surface needs a readable foreground. */
export const TEXT_ON_DARK = '#ffffff';
export const TEXT_ON_LIGHT = '#0f172a';

const HEX_REGEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function nextColor(usedCount) {
  return COLOR_PALETTE[usedCount % COLOR_PALETTE.length].value;
}

export function hexToRgb(hex) {
  const match = String(hex ?? '').trim().match(HEX_REGEX);
  if (!match) return { r: 0, g: 0, b: 0 };

  const value =
    match[1].length === 3
      ? match[1].split('').map((char) => char + char).join('')
      : match[1];

  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

export function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Blends two hex colours; `weight` is how much of `hexB` ends up in the result. */
export function mixHex(hexA, hexB, weight = 0.5) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const w = Math.min(1, Math.max(0, weight));
  const channel = (from, to) => Math.round(from + (to - from) * w);
  return `#${[channel(a.r, b.r), channel(a.g, b.g), channel(a.b, b.b)]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** sRGB gamma expansion, as defined by WCAG 2.x. */
function linearize(channel) {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/**
 * Perceived luminance of a colour (0 = black, 1 = white).
 * Uses the WCAG coefficients, which weight green far above red and blue
 * because that is how the human eye reads brightness.
 */
export function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG contrast ratio between two colours, from 1:1 to 21:1. */
export function contrastRatio(hexA, hexB) {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  const [lighter, darker] = a >= b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Picks the foreground colour that reads best on `backgroundHex`.
 * Instead of a fixed luminance threshold we compare the actual contrast
 * ratio of both candidates, so mid-tones (ámbar, lima, cielo…) resolve
 * to dark text while deep hues (violeta, índigo…) resolve to white.
 */
export function readableTextColor(backgroundHex, { light = TEXT_ON_DARK, dark = TEXT_ON_LIGHT } = {}) {
  return contrastRatio(backgroundHex, dark) >= contrastRatio(backgroundHex, light) ? dark : light;
}
