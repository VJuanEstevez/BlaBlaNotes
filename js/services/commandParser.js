import { normalize, capitalize, countWords } from '../utils/text.js';

// ------------------------------------------------------------------
// Vocabulary
// ------------------------------------------------------------------

const NUMBER_WORDS = {
  un: 1, uno: 1, una: 1,
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20,
  veinticinco: 25, treinta: 30, cuarenta: 40, cincuenta: 50, cien: 100,
  par: 2, docena: 12,
};

const UNIT_WORDS = [
  'botella', 'litro', 'kilo', 'kilogramo', 'gramo', 'paquete', 'lata', 'bote',
  'caja', 'barra', 'bolsa', 'docena', 'unidad', 'pieza', 'trozo', 'rebanada',
  'tarro', 'carton', 'ramo', 'manojo', 'sobre', 'tableta', 'pack', 'racion',
];

const CURRENCY_TOKENS = [
  { symbol: '€', code: 'EUR', words: ['euros', 'euro', 'eur', 'pavos', 'pavo'] },
  { symbol: '$', code: 'USD', words: ['dolares', 'dolar', 'usd'] },
  { symbol: '£', code: 'GBP', words: ['libras', 'libra', 'gbp'] },
];

const ADD_VERBS = String.raw`(?:añade|añadir|anade|anadir|agrega|agregar|apunta|apuntar|anota|anotar|pon|poner|mete|meter|incluye|incluir|compra|comprar|necesito|necesitamos|recuerda|recordar|guarda|guardar|suma|sumar)`;

/**
 * Matches the many ways Spanish refers to a list: "lista", "la lista de la",
 * "mi lista del", "una lista sobre"… Longest alternatives come first so the
 * regex engine consumes the whole connector before capturing the name.
 */
const LIST_REF = String.raw`(?:(?:la|el|mi|una|un)\s+)?lista(?:\s+(?:de\s+(?:la|los|las|el)|del|de|para|sobre|llamada|titulada))?`;

// ------------------------------------------------------------------
// Command patterns
// ------------------------------------------------------------------

const CREATE_LIST_RE = new RegExp(
  String.raw`^(?:(?:crea|crear|haz|hazme|hacer|creame|créame)\s+(?:una\s+)?(?:nueva\s+)?|(?:añade|anade|agrega|añadir|agregar)\s+una\s+nueva\s+|nueva\s+|nuevo\s+)${LIST_REF}\s+(.+)$`,
  'i'
);

const DELETE_LIST_RE = new RegExp(
  String.raw`^(?:borra|borrar|elimina|eliminar|quita|quitar|suprime|suprimir)\s+${LIST_REF}\s+(.+)$`,
  'i'
);

const SWITCH_LIST_RE = new RegExp(
  String.raw`^(?:cambia|cambiar|ve|vete|ir|abre|abrir|selecciona|seleccionar|muestra|mostrar|enseñame|ensename)\s+(?:a\s+|al\s+)?${LIST_REF}\s+(.+)$`,
  'i'
);

const COMPLETE_ITEM_RE =
  /^(?:marca|marcar|tacha|tachar|completa|completar)\s+(.+?)(?:\s+como\s+(?:hecho|hecha|hechos|completado|completada|comprado|comprada|listo|terminado|terminada))?$/i;

const ADD_TO_NAMED_RE = new RegExp(
  String.raw`^(?:${ADD_VERBS}\s+)?(.+?)\s+(?:a|en)\s+${LIST_REF}\s+(.+)$`,
  'i'
);

const ADD_IN_LIST_PREFIX_RE = new RegExp(
  String.raw`^(?:en|a)\s+${LIST_REF}\s+(.+?)\s*[,:]\s*(.+)$`,
  'i'
);

const LEADING_VERB_RE = new RegExp(String.raw`^${ADD_VERBS}\s+(?:que\s+)?`, 'i');
const WITH_ITEMS_RE = /^(.+?)\s+con\s+(.+)$/i;
const LEADING_CON_RE = /^con\s+/i;

// ------------------------------------------------------------------
// Enumeration splitting
// ------------------------------------------------------------------

// The comma must be followed by whitespace so decimal prices ("1,20 €")
// are never mistaken for an enumeration separator.
const SPLIT_RE = /\s*[,;]\s+|\s+(?:y\s+también|y\s+tambien|además\s+de|ademas\s+de|también|tambien|y|e)\s+/i;
const SUBORDINATE_RE = /^(?:que|porque|cuando|si|pero|aunque|mientras|para\s+que|así\s+que|asi\s+que|luego|entonces)\b/i;

const MAX_SEGMENTS = 10;
/** Free dictation needs shorter fragments to be considered a list; an
 *  explicit "añade X e Y a la lista Z" may enumerate longer entries. */
const MAX_WORDS_STRICT = 4;
const MAX_WORDS_EXPLICIT = 6;

/**
 * Breaks "leche, pan y tres huevos" into individual entries.
 * Only splits when every fragment looks like a list entry rather than a
 * clause, so free-form notes ("llamar a Ana y quedar el viernes") survive
 * as a single item.
 */
export function splitEnumeration(text, { explicit = false } = {}) {
  const segments = text
    .split(SPLIT_RE)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length < 2 || segments.length > MAX_SEGMENTS) return [text];

  const maxWords = explicit ? MAX_WORDS_EXPLICIT : MAX_WORDS_STRICT;
  const looksLikeEnumeration = segments.every(
    (segment) => countWords(segment) <= maxWords && !SUBORDINATE_RE.test(segment)
  );

  return looksLikeEnumeration ? segments : [text];
}

// ------------------------------------------------------------------
// Quantity / price extraction
// ------------------------------------------------------------------

const QUANTITY_RE = new RegExp(
  String.raw`^(?:(\d+(?:[.,]\d+)?)|(${Object.keys(NUMBER_WORDS).join('|')}))\s+(?:(${UNIT_WORDS.join('|')})(?:es|s)?\s+)?(?:de\s+)?(.+)$`,
  'i'
);

const PRICE_RE = new RegExp(
  String.raw`\s*(?:\b(?:a|por|de|que\s+cuestan?|cuestan?|precio\s+de|precio)\s+)?(?:(\d+(?:[.,]\d{1,2})?)|(${Object.keys(NUMBER_WORDS).join('|')}))\s*(${CURRENCY_TOKENS.flatMap((c) => [escapeSymbol(c.symbol), ...c.words]).join('|')})\.?`,
  'i'
);

function escapeSymbol(symbol) {
  return symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toNumber(digits, word) {
  if (digits) return Number(digits.replace(',', '.'));
  return NUMBER_WORDS[normalize(word)] ?? null;
}

function resolveCurrency(token) {
  const normalized = normalize(token);
  const match = CURRENCY_TOKENS.find(
    (currency) => currency.symbol === token || currency.words.includes(normalized)
  );
  return match?.code ?? 'EUR';
}

/** Pulls "a 2,50 euros" out of the phrase and returns it as structured data. */
function extractPrice(text) {
  const match = text.match(PRICE_RE);
  if (!match) return { text, price: null, currency: null };

  const amount = toNumber(match[1], match[2]);
  if (amount === null) return { text, price: null, currency: null };

  return {
    text: text.replace(match[0], ' ').replace(/\s{2,}/g, ' ').trim(),
    price: amount,
    currency: resolveCurrency(match[3]),
  };
}

/**
 * Turns a dictated fragment into an item, lifting the leading quantity and
 * unit out of the text: "tres botellas de leche" → Leche ×3 botellas.
 */
export function parseItem(rawSegment, { detectQuantities = true } = {}) {
  let text = rawSegment.trim().replace(/[.!?]+$/, '');
  let price = null;
  let currency = null;

  if (detectQuantities) {
    const priceResult = extractPrice(text);
    text = priceResult.text;
    price = priceResult.price;
    currency = priceResult.currency;
  }

  const item = { text: capitalize(text) };
  if (price !== null) {
    item.price = price;
    item.currency = currency;
  }

  if (!detectQuantities || !text) return item;

  const match = text.match(QUANTITY_RE);
  if (!match) return item;

  const quantity = toNumber(match[1], match[2]);
  const unit = match[3];
  const rest = match[4].trim();
  if (quantity === null || !rest) return item;

  if (quantity > 1) {
    item.text = capitalize(rest);
    item.quantity = quantity;
    if (unit) item.unit = normalize(unit).endsWith('s') ? unit.toLowerCase() : `${unit.toLowerCase()}s`;
  } else {
    // "una botella de leche" — drop the article but keep the unit in the text.
    item.text = capitalize(text.slice(match[1] ? match[1].length : match[2].length).trim());
  }

  return item;
}

function parseItems(text, options = {}) {
  return splitEnumeration(text, { explicit: options.explicit })
    .map((segment) => parseItem(segment, options))
    .filter((item) => item.text);
}

function cleanListName(rawName) {
  return capitalize(rawName.replace(LEADING_CON_RE, '').replace(/[.!?]+$/, '').trim());
}

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

/**
 * Turns a raw dictated phrase into a structured action. Recognised shapes:
 *
 *   crear lista de la compra con leche y pan   → create_list (+ items)
 *   borra la lista de películas                → delete_list
 *   cambia a la lista de música                → switch_list
 *   marca el pan como comprado                 → complete_item
 *   añadir leche y pan a la lista del súper    → add_items (2 items, named list)
 *   comprar tres botellas de leche a 2 euros   → add_items (active list)
 *
 * Anything that matches no pattern falls back to `add_items` against the
 * active list, so plain dictation keeps working exactly as before.
 */
export function parseVoiceCommand(rawText, { detectQuantities = true } = {}) {
  const text = String(rawText ?? '').trim();
  if (!text) return null;

  const options = { detectQuantities };
  // An explicitly targeted list ("… a la lista de la compra") is a strong
  // signal that the payload really is an enumeration of items.
  const explicitOptions = { detectQuantities, explicit: true };

  let match = text.match(CREATE_LIST_RE);
  if (match) {
    const withItems = match[1].match(WITH_ITEMS_RE);
    if (withItems) {
      return {
        type: 'create_list',
        name: cleanListName(withItems[1]),
        items: parseItems(withItems[2], explicitOptions),
      };
    }
    return { type: 'create_list', name: cleanListName(match[1]), items: [] };
  }

  match = text.match(DELETE_LIST_RE);
  if (match) {
    return { type: 'delete_list', name: match[1].trim() };
  }

  match = text.match(SWITCH_LIST_RE);
  if (match) {
    return { type: 'switch_list', name: match[1].trim() };
  }

  match = text.match(ADD_IN_LIST_PREFIX_RE);
  if (match) {
    return { type: 'add_items', listName: match[1].trim(), items: parseItems(match[2], explicitOptions) };
  }

  match = text.match(ADD_TO_NAMED_RE);
  if (match) {
    return { type: 'add_items', listName: match[2].trim(), items: parseItems(match[1], explicitOptions) };
  }

  match = text.match(COMPLETE_ITEM_RE);
  if (match) {
    // Kept as a soft command: the caller falls back to adding the text when
    // no matching item exists, so "marcar cita con Ana" is never lost.
    return { type: 'complete_item', text: match[1].trim(), items: parseItems(match[1], options) };
  }

  return {
    type: 'add_items',
    listName: null,
    items: parseItems(text.replace(LEADING_VERB_RE, ''), options),
  };
}

export function findListByName(lists, name) {
  const target = normalize(name);
  if (!target) return null;
  return (
    lists.find((list) => normalize(list.name) === target) ||
    lists.find((list) => normalize(list.name).includes(target) || target.includes(normalize(list.name))) ||
    null
  );
}

const LEADING_ARTICLE_RE = /^(?:el|la|los|las|un|una|unos|unas)\s+/;

function itemKey(text) {
  return normalize(text).replace(LEADING_ARTICLE_RE, '');
}

/** Matches dictated text against stored items, ignoring case, accents and articles. */
export function findItemByText(items, text) {
  const target = itemKey(text);
  if (!target) return null;
  return (
    items.find((item) => itemKey(item.text) === target) ||
    items.find((item) => itemKey(item.text).includes(target) || target.includes(itemKey(item.text))) ||
    null
  );
}

/** Normalised key used to merge repeated dictations of the same item. */
export function itemMergeKey(text) {
  return itemKey(text);
}
