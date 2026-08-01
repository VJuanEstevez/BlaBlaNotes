import { readableTextColor, hexToRgba, contrastRatio, TEXT_ON_DARK } from '../utils/colors.js';

const mainEl = document.getElementById('main-content');
const themeColorMeta = document.querySelector('meta[name="theme-color"]');

const DASHBOARD_VARS = [
  '--bg-dashboard',
  '--text-dashboard',
  '--text-dashboard-muted',
  '--border-dashboard',
  '--surface-dashboard',
  '--list-tint',
];

/** Opacity applied to the computed text colour for secondary copy. */
const MUTED_ALPHA = 0.74;
const BORDER_ALPHA = 0.24;
const SURFACE_ALPHA = 0.1;

/**
 * Paints the dashboard with the active folder's colour and derives every
 * foreground token from it.
 *
 * The text colour is not hard-coded: `readableTextColor` measures the
 * background's perceived luminance and returns whichever of white / near-black
 * wins the WCAG contrast comparison. Muted text, borders and inner surfaces are
 * then built as alpha variations of that same colour, so a bright ámbar folder
 * gets dark text and a deep violeta folder gets light text without any
 * per-colour bookkeeping.
 */
export function applyDashboardColor(color) {
  if (!mainEl) return;

  if (!color) {
    clearDashboardColor();
    return;
  }

  const text = readableTextColor(color);

  mainEl.style.setProperty('--bg-dashboard', color);
  mainEl.style.setProperty('--text-dashboard', text);
  mainEl.style.setProperty('--text-dashboard-muted', hexToRgba(text, MUTED_ALPHA));
  mainEl.style.setProperty('--border-dashboard', hexToRgba(text, BORDER_ALPHA));
  mainEl.style.setProperty('--surface-dashboard', hexToRgba(text, SURFACE_ALPHA));
  // Kept for components that only need the raw accent (checkboxes, rings…).
  mainEl.style.setProperty('--list-tint', color);

  // Lets CSS branch on the resolved tone, e.g. for focus rings on dark tints.
  mainEl.dataset.tone = text === TEXT_ON_DARK ? 'light' : 'dark';

  themeColorMeta?.setAttribute('content', color);
}

export function clearDashboardColor() {
  if (!mainEl) return;
  DASHBOARD_VARS.forEach((token) => mainEl.style.removeProperty(token));
  delete mainEl.dataset.tone;
  themeColorMeta?.setAttribute('content', '#6c5ce7');
}

/** Exposed for debugging and tests: the contrast actually achieved. */
export function dashboardContrast(color) {
  return contrastRatio(color, readableTextColor(color));
}
