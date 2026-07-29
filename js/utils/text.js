const DIACRITICS_REGEX = /[̀-ͯ]/g;

export function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS_REGEX, '')
    .trim();
}

export function capitalize(text) {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
