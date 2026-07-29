export const COLOR_PALETTE = [
  { name: 'violeta', value: '#6c5ce7' },
  { name: 'rosa', value: '#ff6b9d' },
  { name: 'coral', value: '#ff7d55' },
  { name: 'ambar', value: '#ffb020' },
  { name: 'lima', value: '#8bc34a' },
  { name: 'esmeralda', value: '#26c485' },
  { name: 'cielo', value: '#3ec4e0' },
  { name: 'indigo', value: '#5c6bc0' },
];

export function nextColor(usedCount) {
  return COLOR_PALETTE[usedCount % COLOR_PALETTE.length].value;
}

export function hexToRgba(hex, alpha) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
