import { normalize, capitalize } from '../utils/text.js';

const CREATE_LIST_RE = /^(?:crea|crear|nueva|añade una nueva|agrega una nueva)\s+lista(?:\s+(?:de|para|sobre))?\s+(.+)/i;
const SWITCH_LIST_RE = /^(?:cambia|cambiar|selecciona|seleccionar|ir a|abre|abrir)\s+(?:a\s+)?lista\s+(.+)/i;
const ADD_TO_NAMED_RE_1 = /^(?:añade|anade|agrega|añadir|agregar|apunta|pon)\s+(.+?)\s+(?:a|en)\s+(?:la\s+)?lista\s+(.+)/i;
const ADD_TO_NAMED_RE_2 = /^en\s+(?:la\s+)?lista\s+(.+?)[,:]\s*(.+)/i;

/**
 * Turns a raw dictated phrase into a structured action.
 * Falls back to `add_item` against the active list when no
 * command pattern matches.
 */
export function parseVoiceCommand(rawText) {
  const text = rawText.trim();
  if (!text) return null;

  let match = text.match(CREATE_LIST_RE);
  if (match) {
    return { type: 'create_list', name: capitalize(match[1].trim()) };
  }

  match = text.match(SWITCH_LIST_RE);
  if (match) {
    return { type: 'switch_list', name: match[1].trim() };
  }

  match = text.match(ADD_TO_NAMED_RE_1);
  if (match) {
    return { type: 'add_item', listName: match[2].trim(), text: capitalize(match[1].trim()) };
  }

  match = text.match(ADD_TO_NAMED_RE_2);
  if (match) {
    return { type: 'add_item', listName: match[1].trim(), text: capitalize(match[2].trim()) };
  }

  return { type: 'add_item', listName: null, text: capitalize(text) };
}

export function findListByName(lists, name) {
  const target = normalize(name);
  return (
    lists.find((list) => normalize(list.name) === target) ||
    lists.find((list) => normalize(list.name).includes(target) || target.includes(normalize(list.name))) ||
    null
  );
}
