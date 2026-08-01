import { formatPrice, formatQuantity } from '../utils/text.js';

export const canShareNative = Boolean(navigator.share);

/** Formats "×3 botellas" for a single item, or an empty string when there is no count. */
export function quantityLabel(item) {
  if (!item?.quantity || item.quantity <= 1) return '';
  const amount = `×${formatQuantity(item.quantity)}`;
  return item.unit ? `${amount} ${item.unit}` : amount;
}

export function itemTotal(item) {
  if (typeof item?.price !== 'number') return 0;
  return item.price * (item.quantity && item.quantity > 1 ? item.quantity : 1);
}

/** Sum of every priced item in a list, or 0 when none has a price. */
export function listTotal(list) {
  return (list?.items ?? []).reduce((total, item) => total + itemTotal(item), 0);
}

function itemLine(item) {
  const parts = [item.completed ? '✅' : '▫️', item.text];
  const quantity = quantityLabel(item);
  if (quantity) parts.push(`(${quantity})`);
  if (typeof item.price === 'number') parts.push(`— ${formatPrice(item.price, item.currency)}`);
  return parts.join(' ');
}

/**
 * Renders a list as plain text, ready for the clipboard, WhatsApp, email or
 * the native share sheet. Kept free of markup so it pastes cleanly anywhere.
 */
export function buildListText(list, { branding = true } = {}) {
  const body = list.items.length
    ? list.items.map(itemLine).join('\n')
    : '(lista vacía)';

  const total = listTotal(list);
  const lines = [`📋 ${list.name}`, '', body];

  if (total > 0) {
    const currency = list.items.find((item) => typeof item.price === 'number')?.currency ?? 'EUR';
    lines.push('', `Total: ${formatPrice(total, currency)}`);
  }

  if (branding) lines.push('', '🎙️ Creado con BlaBlaNotes');

  return lines.join('\n');
}

/**
 * Copies text to the clipboard. The Clipboard API needs a secure context, so
 * a hidden textarea plus `execCommand` covers plain-HTTP and older browsers.
 */
export async function copyText(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to the legacy path */
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);

  try {
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

export function whatsappUrl(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function mailtoUrl(subject, body) {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export async function shareNative({ title, text }) {
  if (!canShareNative) return false;
  try {
    await navigator.share({ title, text });
    return true;
  } catch {
    // The user dismissing the share sheet is not an error worth reporting.
    return false;
  }
}
