const DIACRITICS_REGEX = /[̀-ͯ]/g;

const CURRENCY_LOCALES = {
  EUR: 'es-ES',
  USD: 'en-US',
  GBP: 'en-GB',
};

export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS_REGEX, '')
    .trim();
}

export function capitalize(text) {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function countWords(text) {
  return normalize(text).split(/\s+/).filter(Boolean).length;
}

/**
 * Edit distance between two strings, used to accept slightly misheard
 * wake words ("oye blabla" vs. "oye bla bla") without demanding an
 * exact transcription from the speech engine.
 */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }

  return previous[b.length];
}

export function formatPrice(amount, currency = 'EUR') {
  try {
    return new Intl.NumberFormat(CURRENCY_LOCALES[currency] || 'es-ES', {
      style: 'currency',
      currency,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function formatQuantity(amount) {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(1).replace('.', ',');
}
