const KEYS = {
  LISTS: 'blablanotes:lists',
  ACTIVE_LIST: 'blablanotes:activeListId',
  SETTINGS: 'blablanotes:settings',
};

export const DEFAULT_SETTINGS = {
  lang: 'es-ES',
  silenceMs: 3000,
  darkMode: false,
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error('No se pudo guardar en localStorage', error);
  }
}

export function loadLists() {
  return read(KEYS.LISTS, []);
}

export function saveLists(lists) {
  write(KEYS.LISTS, lists);
}

export function loadActiveListId() {
  return read(KEYS.ACTIVE_LIST, null);
}

export function saveActiveListId(id) {
  write(KEYS.ACTIVE_LIST, id);
}

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...read(KEYS.SETTINGS, {}) };
}

export function saveSettings(settings) {
  write(KEYS.SETTINGS, settings);
}

export function exportAll() {
  return {
    lists: loadLists(),
    activeListId: loadActiveListId(),
    settings: loadSettings(),
    exportedAt: new Date().toISOString(),
  };
}

export function importAll(data) {
  if (!data || !Array.isArray(data.lists)) {
    throw new Error('Formato de datos no válido');
  }
  saveLists(data.lists);
  saveActiveListId(data.activeListId ?? null);
  if (data.settings) saveSettings({ ...DEFAULT_SETTINGS, ...data.settings });
}

export function clearAll() {
  localStorage.removeItem(KEYS.LISTS);
  localStorage.removeItem(KEYS.ACTIVE_LIST);
  localStorage.removeItem(KEYS.SETTINGS);
}
