import { store, getActiveList, persistLists, persistActiveListId, persistSettings } from './state/store.js';
import * as storage from './state/storage.js';
import { createId } from './utils/id.js';
import { nextColor } from './utils/colors.js';
import { VoiceService, isSpeechSupported } from './services/voiceService.js';
import { parseVoiceCommand, findListByName } from './services/commandParser.js';
import { renderAll, focusEditInput } from './ui/render.js';
import { showToast } from './ui/toast.js';
import { setVoiceStatus, setTranscript, onVoiceButtonClick } from './ui/voiceButton.js';
import { openCreateListModal, openSettingsModal, closeSettingsModal } from './ui/modal.js';

let editingItemId = null;

function render() {
  renderAll(store.getState(), editingItemId);
}

function updateLists(mutator) {
  const lists = mutator(store.getState().lists.map((list) => ({ ...list, items: [...list.items] })));
  persistLists(lists);
  render();
}

function createList(name, color) {
  const lists = store.getState().lists;
  const list = {
    id: createId(),
    name,
    color: color || nextColor(lists.length),
    createdAt: Date.now(),
    items: [],
  };
  persistLists([...lists, list]);
  persistActiveListId(list.id);
  render();
  showToast(`Lista "${name}" creada`, 'success');
  return list;
}

function ensureActiveOrDefaultList() {
  const { lists, activeListId } = store.getState();
  if (lists.find((l) => l.id === activeListId)) return activeListId;
  if (lists.length > 0) {
    persistActiveListId(lists[0].id);
    return lists[0].id;
  }
  const list = createList('Notas', nextColor(0));
  return list.id;
}

function addItemToList(listId, text) {
  updateLists((lists) =>
    lists.map((list) =>
      list.id === listId
        ? { ...list, items: [...list.items, { id: createId(), text, completed: false, createdAt: Date.now() }] }
        : list
    )
  );
}

// ------------------------------------------------------------------
// Voice command handling
// ------------------------------------------------------------------

function handleFinalItem(rawText) {
  setVoiceStatus('processing');
  const command = parseVoiceCommand(rawText);

  if (!command) {
    setVoiceStatus(store.getState().voiceStatus === 'idle' ? 'idle' : 'listening');
    return;
  }

  const { lists } = store.getState();

  if (command.type === 'create_list') {
    const existing = findListByName(lists, command.name);
    if (existing) {
      persistActiveListId(existing.id);
      render();
      showToast(`Ya existía la lista "${existing.name}", cambiando a ella`);
    } else {
      createList(command.name);
    }
  } else if (command.type === 'switch_list') {
    const target = findListByName(lists, command.name);
    if (target) {
      persistActiveListId(target.id);
      render();
      showToast(`Lista activa: ${target.name}`);
    } else {
      showToast(`No encontré una lista llamada "${command.name}"`, 'error');
    }
  } else if (command.type === 'add_item') {
    let targetList = command.listName ? findListByName(lists, command.listName) : null;
    if (!targetList) {
      const activeId = ensureActiveOrDefaultList();
      targetList = store.getState().lists.find((l) => l.id === activeId);
    }
    addItemToList(targetList.id, command.text);
    showToast(`Añadido a "${targetList.name}": ${command.text}`, 'success');
  }

  setVoiceStatus(store.getState().voiceStatus === 'idle' ? 'idle' : 'listening');
}

const voiceService = new VoiceService({
  lang: store.getState().settings.lang,
  silenceMs: store.getState().settings.silenceMs,
  onInterim: (text) => setTranscript(text),
  onFinalItem: handleFinalItem,
  onStateChange: (status) => {
    store.setState({ voiceStatus: status });
    setVoiceStatus(status);
  },
  onError: ({ message }) => {
    if (!message) return;
    store.setState({ voiceStatus: 'error' });
    setVoiceStatus('error');
    showToast(message, 'error');
    setTimeout(() => {
      if (store.getState().voiceStatus === 'error') {
        store.setState({ voiceStatus: 'idle' });
        setVoiceStatus('idle');
      }
    }, 2000);
  },
});

function toggleVoice() {
  if (!isSpeechSupported) {
    showToast('Tu navegador no soporta reconocimiento de voz. Prueba con Chrome o Edge.', 'error');
    return;
  }
  if (store.getState().voiceStatus === 'listening') {
    voiceService.stop();
  } else {
    voiceService.start();
  }
}

// ------------------------------------------------------------------
// Sidebar / overlay
// ------------------------------------------------------------------

const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarClose = document.getElementById('sidebar-close');

function openSidebar() {
  sidebar.classList.add('sidebar--open');
  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add('overlay--visible'));
  sidebarToggle.setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
  sidebar.classList.remove('sidebar--open');
  overlay.classList.remove('overlay--visible');
  sidebarToggle.setAttribute('aria-expanded', 'false');
  setTimeout(() => {
    overlay.hidden = true;
  }, 250);
}

sidebarToggle.addEventListener('click', () => {
  sidebar.classList.contains('sidebar--open') ? closeSidebar() : openSidebar();
});
sidebarClose.addEventListener('click', closeSidebar);
overlay.addEventListener('click', closeSidebar);

// ------------------------------------------------------------------
// Create list (manual)
// ------------------------------------------------------------------

document.getElementById('create-list-btn').addEventListener('click', () => {
  openCreateListModal({
    defaultColor: nextColor(store.getState().lists.length),
    onSubmit: ({ name, color }) => {
      const existing = findListByName(store.getState().lists, name);
      if (existing) {
        showToast(`Ya existe una lista llamada "${existing.name}"`, 'error');
        return;
      }
      createList(name, color);
      if (window.innerWidth < 960) closeSidebar();
    },
  });
});

// ------------------------------------------------------------------
// Delegated actions: sidebar + list panel
// ------------------------------------------------------------------

function handleAction(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action, id } = target.dataset;

  switch (action) {
    case 'select-list':
      persistActiveListId(id);
      editingItemId = null;
      render();
      if (window.innerWidth < 960) closeSidebar();
      break;

    case 'delete-list': {
      const list = store.getState().lists.find((l) => l.id === id);
      if (!list) return;
      if (!confirm(`¿Eliminar la lista "${list.name}" y todos sus elementos?`)) return;
      const remaining = store.getState().lists.filter((l) => l.id !== id);
      persistLists(remaining);
      if (store.getState().activeListId === id) {
        persistActiveListId(remaining[0]?.id ?? null);
      }
      render();
      showToast(`Lista "${list.name}" eliminada`);
      break;
    }

    case 'toggle-item':
      updateLists((lists) =>
        lists.map((list) =>
          list.id === store.getState().activeListId
            ? {
                ...list,
                items: list.items.map((item) =>
                  item.id === id ? { ...item, completed: !item.completed } : item
                ),
              }
            : list
        )
      );
      break;

    case 'edit-item':
      editingItemId = id;
      render();
      focusEditInput(id);
      break;

    case 'cancel-edit':
      editingItemId = null;
      render();
      break;

    case 'save-item': {
      const input = document.querySelector(`[data-role="edit-input"][data-id="${id}"]`);
      const text = input?.value.trim();
      if (text) {
        updateLists((lists) =>
          lists.map((list) =>
            list.id === store.getState().activeListId
              ? { ...list, items: list.items.map((item) => (item.id === id ? { ...item, text } : item)) }
              : list
          )
        );
      }
      editingItemId = null;
      render();
      break;
    }

    case 'delete-item': {
      updateLists((lists) =>
        lists.map((list) =>
          list.id === store.getState().activeListId
            ? { ...list, items: list.items.filter((item) => item.id !== id) }
            : list
        )
      );
      showToast('Elemento eliminado');
      break;
    }

    default:
      break;
  }
}

function handleColorChange(event) {
  const target = event.target.closest('[data-action="change-color"]');
  if (!target) return;
  const { id } = target.dataset;
  const color = target.value;
  updateLists((lists) => lists.map((list) => (list.id === id ? { ...list, color } : list)));
}

document.getElementById('sidebar-list').addEventListener('click', handleAction);
document.getElementById('list-panel').addEventListener('click', handleAction);
document.getElementById('list-panel').addEventListener('change', (event) => {
  handleAction(event);
  handleColorChange(event);
});

document.getElementById('list-panel').addEventListener('keydown', (event) => {
  if (event.target.matches('[data-role="edit-input"]') && event.key === 'Enter') {
    event.preventDefault();
    document.querySelector(`[data-action="save-item"][data-id="${event.target.dataset.id}"]`)?.click();
  }
  if (event.target.matches('[data-role="edit-input"]') && event.key === 'Escape') {
    editingItemId = null;
    render();
  }
});

// ------------------------------------------------------------------
// Dark mode
// ------------------------------------------------------------------

const darkModeToggle = document.getElementById('dark-mode-toggle');
const darkModeIcon = darkModeToggle.querySelector('.sidebar__footer-icon');
const darkModeLabel = darkModeToggle.querySelector('[data-role="dark-mode-label"]');

function applyTheme(isDark) {
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  darkModeToggle.setAttribute('aria-pressed', String(isDark));
  darkModeIcon.textContent = isDark ? '☀️' : '🌙';
  darkModeLabel.textContent = isDark ? 'Modo claro' : 'Modo oscuro';
}

darkModeToggle.addEventListener('click', () => {
  const settings = { ...store.getState().settings, darkMode: !store.getState().settings.darkMode };
  persistSettings(settings);
  applyTheme(settings.darkMode);
});

// ------------------------------------------------------------------
// Settings
// ------------------------------------------------------------------

const settingsToggle = document.getElementById('settings-toggle');
const langSelect = document.getElementById('settings-lang');
const silenceRange = document.getElementById('settings-silence');
const silenceValue = document.getElementById('settings-silence-value');

settingsToggle.addEventListener('click', () => {
  const settings = store.getState().settings;
  langSelect.value = settings.lang;
  silenceRange.value = settings.silenceMs / 1000;
  silenceValue.textContent = `${(settings.silenceMs / 1000).toFixed(1)}s`;
  openSettingsModal();
});

langSelect.addEventListener('change', () => {
  const settings = { ...store.getState().settings, lang: langSelect.value };
  persistSettings(settings);
  voiceService.setLang(settings.lang);
});

silenceRange.addEventListener('input', () => {
  silenceValue.textContent = `${Number(silenceRange.value).toFixed(1)}s`;
});

silenceRange.addEventListener('change', () => {
  const silenceMs = Math.round(Number(silenceRange.value) * 1000);
  const settings = { ...store.getState().settings, silenceMs };
  persistSettings(settings);
  voiceService.setSilenceMs(silenceMs);
});

function downloadFile(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildTxtExport() {
  const { lists } = store.getState();
  if (lists.length === 0) return 'No hay listas guardadas.';
  return lists
    .map((list) => {
      const heading = `${list.name.toUpperCase()} (${list.items.length})`;
      const body = list.items.length
        ? list.items.map((item) => `${item.completed ? '[x]' : '[ ]'} ${item.text}`).join('\n')
        : '(vacía)';
      return `${heading}\n${'-'.repeat(heading.length)}\n${body}`;
    })
    .join('\n\n');
}

document.getElementById('settings-export-json').addEventListener('click', () => {
  const data = storage.exportAll();
  downloadFile(
    JSON.stringify(data, null, 2),
    'application/json',
    `blablanotes-backup-${new Date().toISOString().slice(0, 10)}.json`
  );
  showToast('Datos exportados en JSON', 'success');
});

document.getElementById('settings-export-txt').addEventListener('click', () => {
  downloadFile(
    buildTxtExport(),
    'text/plain',
    `blablanotes-backup-${new Date().toISOString().slice(0, 10)}.txt`
  );
  showToast('Datos exportados en TXT', 'success');
});

const importInput = document.getElementById('settings-import-input');
document.getElementById('settings-import').addEventListener('click', () => importInput.click());

importInput.addEventListener('change', async () => {
  const file = importInput.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    storage.importAll(data);
    store.setState({
      lists: storage.loadLists(),
      activeListId: storage.loadActiveListId(),
      settings: storage.loadSettings(),
    });
    render();
    applyTheme(store.getState().settings.darkMode);
    closeSettingsModal();
    showToast('Datos importados correctamente', 'success');
  } catch (error) {
    showToast('El archivo no tiene un formato válido', 'error');
  } finally {
    importInput.value = '';
  }
});

document.getElementById('settings-clear').addEventListener('click', () => {
  if (!confirm('¿Borrar todas las listas y ajustes? Esta acción no se puede deshacer.')) return;
  storage.clearAll();
  store.setState({
    lists: [],
    activeListId: null,
    settings: storage.loadSettings(),
  });
  editingItemId = null;
  render();
  applyTheme(store.getState().settings.darkMode);
  closeSettingsModal();
  showToast('Todos los datos han sido borrados');
});

// ------------------------------------------------------------------
// Init
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Share functionality
// ------------------------------------------------------------------

function shareList(listId, platform) {
  const list = store.getState().lists.find((l) => l.id === listId);
  if (!list) return;

  const text = list.items.length > 0
    ? list.items.map((item) => `${item.completed ? '✓' : '○'} ${item.text}`).join('\n')
    : '(lista vacía)';

  const message = `📋 ${list.name}\n\n${text}\n\n🎙️ Creado con BlaBlaNotes`;

  if (platform === 'whatsapp') {
    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/?text=${encoded}`, '_blank');
    showToast('Abriendo WhatsApp...', 'success');
  } else if (platform === 'email') {
    const subject = encodeURIComponent(`Mi lista: ${list.name}`);
    const body = encodeURIComponent(message);
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
    showToast('Abriendo email...', 'success');
  }
}

// ------------------------------------------------------------------
// Drag & Drop functionality
// ------------------------------------------------------------------

let draggedItemId = null;
let draggedFromListId = null;

document.getElementById('list-panel').addEventListener('dragstart', (event) => {
  const item = event.target.closest('[data-role="draggable-item"]');
  if (!item) return;
  draggedItemId = item.dataset.itemId;
  draggedFromListId = store.getState().activeListId;
  item.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
});

document.getElementById('list-panel').addEventListener('dragend', (event) => {
  const item = event.target.closest('[data-role="draggable-item"]');
  if (item) item.classList.remove('dragging');
  draggedItemId = null;
});

document.getElementById('list-panel').addEventListener('dragover', (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const target = event.target.closest('[data-role="draggable-item"]');
  if (target && draggedItemId && target.dataset.itemId !== draggedItemId) {
    target.classList.add('drag-over');
  }
});

document.getElementById('list-panel').addEventListener('dragleave', (event) => {
  const target = event.target.closest('[data-role="draggable-item"]');
  if (target) target.classList.remove('drag-over');
});

document.getElementById('list-panel').addEventListener('drop', (event) => {
  event.preventDefault();
  const target = event.target.closest('[data-role="draggable-item"]');
  if (!target || !draggedItemId) return;

  target.classList.remove('drag-over');

  const draggedIndex = store.getState().lists
    .find((l) => l.id === draggedFromListId)
    .items.findIndex((item) => item.id === draggedItemId);
  const targetIndex = store.getState().lists
    .find((l) => l.id === draggedFromListId)
    .items.findIndex((item) => item.id === target.dataset.itemId);

  if (draggedIndex === -1 || targetIndex === -1) return;

  updateLists((lists) =>
    lists.map((list) => {
      if (list.id !== draggedFromListId) return list;
      const items = [...list.items];
      const [draggedItem] = items.splice(draggedIndex, 1);
      items.splice(targetIndex, 0, draggedItem);
      return { ...list, items };
    })
  );

  draggedItemId = null;
  draggedFromListId = null;
  showToast('Elemento reordenado', 'success');
});

// ------------------------------------------------------------------
// Share button handler
// ------------------------------------------------------------------

document.getElementById('list-panel').addEventListener('click', (event) => {
  const shareBtn = event.target.closest('[data-action^="share-"]');
  if (!shareBtn) return;
  const { action, id } = shareBtn.dataset;
  const platform = action.replace('share-', '');
  shareList(id, platform);
});

// ------------------------------------------------------------------
// Init
// ------------------------------------------------------------------

export function initApp() {
  const splashScreen = document.getElementById('splash-screen');
  setTimeout(() => {
    if (splashScreen) {
      splashScreen.classList.add('hidden');
      setTimeout(() => {
        splashScreen.hidden = true;
      }, 400);
    }
  }, 1200);

  if (!isSpeechSupported) {
    setVoiceStatus('idle');
    showToast('Tu navegador no soporta reconocimiento de voz. Prueba con Chrome o Edge.', 'error');
  }
  onVoiceButtonClick(toggleVoice);
  applyTheme(store.getState().settings.darkMode);
  render();
}
