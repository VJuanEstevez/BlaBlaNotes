import { store, persistLists, persistActiveListId, persistSettings } from './state/store.js';
import * as storage from './state/storage.js';
import { createId } from './utils/id.js';
import { nextColor } from './utils/colors.js';
import { capitalize } from './utils/text.js';
import { VoiceService, isSpeechSupported } from './services/voiceService.js';
import { WakeWordService, isWakeWordSupported } from './services/wakeWord.js';
import { AcousticTrigger, isAcousticTriggerSupported } from './services/acousticTrigger.js';
import { parseVoiceCommand, findListByName, findItemByText, itemMergeKey } from './services/commandParser.js';
import { buildListText } from './services/shareService.js';
import { initPwa, promptInstall, canInstall, isStandalone } from './services/pwa.js';
import { renderAll, focusEditInput } from './ui/render.js';
import { showToast } from './ui/toast.js';
import { setVoiceStatus, setTranscript, setVoiceHint, setContinuousLabel, onVoiceButtonClick } from './ui/voiceButton.js';
import { openCreateListModal, openSettingsModal, closeSettingsModal } from './ui/modal.js';
import { initShareFab, updateShareFab, shareActiveList } from './ui/shareFab.js';

let editingItemId = null;
let paletteOpenListId = null;

function render() {
  const state = store.getState();
  renderAll(state, { editingItemId, paletteOpenListId });
  updateShareFab(state.lists.find((list) => list.id === state.activeListId) ?? null);
}

function updateLists(mutator) {
  const lists = mutator(store.getState().lists.map((list) => ({ ...list, items: [...list.items] })));
  persistLists(lists);
  render();
}

function createList(name, color, { silent = false } = {}) {
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
  if (!silent) showToast(`Lista "${name}" creada`, 'success');
  return list;
}

function ensureActiveOrDefaultList() {
  const { lists, activeListId } = store.getState();
  if (lists.find((l) => l.id === activeListId)) return activeListId;
  if (lists.length > 0) {
    persistActiveListId(lists[0].id);
    return lists[0].id;
  }
  return createList('Notas', nextColor(0)).id;
}

/** Resolves a dictated list name to an existing list, creating it when new. */
function resolveOrCreateList(listName) {
  const { lists } = store.getState();
  const existing = listName ? findListByName(lists, listName) : null;
  if (existing) return { list: existing, created: false };

  if (listName) {
    return { list: createList(capitalize(listName), undefined, { silent: true }), created: true };
  }

  const activeId = ensureActiveOrDefaultList();
  return { list: store.getState().lists.find((l) => l.id === activeId), created: false };
}

function buildItem(parsed) {
  const item = {
    id: createId(),
    text: parsed.text,
    completed: false,
    createdAt: Date.now(),
  };
  if (parsed.quantity) item.quantity = parsed.quantity;
  if (parsed.unit) item.unit = parsed.unit;
  if (typeof parsed.price === 'number') {
    item.price = parsed.price;
    item.currency = parsed.currency ?? 'EUR';
  }
  return item;
}

/**
 * Appends dictated entries to a list. Repeating an entry bumps its counter
 * instead of creating a duplicate, which is what "añade dos yogures" twice
 * is expected to do on a shopping list.
 */
function addItemsToList(listId, parsedItems) {
  let addedCount = 0;
  let mergedCount = 0;

  updateLists((lists) =>
    lists.map((list) => {
      if (list.id !== listId) return list;

      const items = [...list.items];

      parsedItems.forEach((parsed) => {
        const key = itemMergeKey(parsed.text);
        const index = items.findIndex((item) => !item.completed && itemMergeKey(item.text) === key);

        if (index === -1) {
          items.push(buildItem(parsed));
          addedCount += 1;
          return;
        }

        const existing = items[index];
        items[index] = {
          ...existing,
          quantity: (existing.quantity || 1) + (parsed.quantity || 1),
          unit: existing.unit ?? parsed.unit,
          price: typeof existing.price === 'number' ? existing.price : parsed.price,
          currency: existing.currency ?? parsed.currency,
        };
        mergedCount += 1;
      });

      return { ...list, items };
    })
  );

  return { addedCount, mergedCount };
}

function describeItems(parsedItems) {
  return parsedItems.map((item) => item.text).join(', ');
}

// ------------------------------------------------------------------
// Voice command handling
// ------------------------------------------------------------------

function handleAddItems(listName, items) {
  if (items.length === 0) return;

  const { list, created } = resolveOrCreateList(listName);
  const { mergedCount } = addItemsToList(list.id, items);

  if (store.getState().activeListId !== list.id) persistActiveListId(list.id);
  render();

  const summary = describeItems(items);
  if (created) {
    showToast(`Lista "${list.name}" creada con: ${summary}`, 'success');
  } else if (mergedCount > 0 && items.length === mergedCount) {
    showToast(`Cantidad actualizada en "${list.name}": ${summary}`, 'success');
  } else {
    showToast(`Añadido a "${list.name}": ${summary}`, 'success');
  }
}

function handleCreateList(command) {
  const existing = findListByName(store.getState().lists, command.name);
  const list = existing ?? createList(command.name, undefined, { silent: command.items.length > 0 });

  if (existing) {
    persistActiveListId(existing.id);
    render();
    if (command.items.length === 0) {
      showToast(`Ya existía la lista "${existing.name}", cambiando a ella`);
    }
  }

  if (command.items.length > 0) {
    addItemsToList(list.id, command.items);
    render();
    showToast(`"${list.name}": ${describeItems(command.items)}`, 'success');
  }
}

function handleDeleteList(name) {
  const list = findListByName(store.getState().lists, name);
  if (!list) {
    showToast(`No encontré una lista llamada "${name}"`, 'error');
    return;
  }
  deleteList(list.id, { confirmFirst: true });
}

function handleCompleteItem(command) {
  const { lists, activeListId } = store.getState();
  const activeList = lists.find((l) => l.id === activeListId);
  const match = activeList ? findItemByText(activeList.items, command.text) : null;

  // No matching entry means this was almost certainly a plain note that just
  // happened to start with "marca…", so it is stored rather than discarded.
  if (!match) {
    handleAddItems(null, command.items);
    return;
  }

  updateLists((all) =>
    all.map((list) =>
      list.id === activeListId
        ? { ...list, items: list.items.map((item) => (item.id === match.id ? { ...item, completed: true } : item)) }
        : list
    )
  );
  showToast(`Completado: ${match.text}`, 'success');
}

function handleFinalItem(rawText) {
  setVoiceStatus('processing');

  const command = parseVoiceCommand(rawText, {
    detectQuantities: store.getState().settings.smartQuantities,
  });

  if (!command) {
    restoreVoiceStatus();
    return;
  }

  switch (command.type) {
    case 'create_list':
      handleCreateList(command);
      break;

    case 'delete_list':
      handleDeleteList(command.name);
      break;

    case 'switch_list': {
      const target = findListByName(store.getState().lists, command.name);
      if (target) {
        persistActiveListId(target.id);
        render();
        showToast(`Lista activa: ${target.name}`);
      } else {
        showToast(`No encontré una lista llamada "${command.name}"`, 'error');
      }
      break;
    }

    case 'complete_item':
      handleCompleteItem(command);
      break;

    case 'add_items':
      handleAddItems(command.listName, command.items);
      break;

    default:
      break;
  }

  restoreVoiceStatus();
}

function restoreVoiceStatus() {
  setVoiceStatus(store.getState().voiceStatus === 'idle' ? 'idle' : 'listening');
}

// ------------------------------------------------------------------
// Voice services
// ------------------------------------------------------------------

const initialSettings = store.getState().settings;

const voiceService = new VoiceService({
  lang: initialSettings.lang,
  silenceMs: initialSettings.silenceMs,
  continuous: initialSettings.continuousMode,
  onInterim: (text) => setTranscript(text),
  onFinalItem: handleFinalItem,
  onStateChange: (status) => {
    store.setState({ voiceStatus: status });
    setVoiceStatus(status);
    // Hands-free listeners share the microphone, so they stand down while
    // dictation is running and come back once it ends.
    if (status === 'listening') {
      pauseHandsFree();
    } else if (status === 'idle') {
      resumeHandsFree();
    }
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
        resumeHandsFree();
      }
    }, 2000);
  },
});

const wakeWordService = new WakeWordService({
  lang: initialSettings.lang,
  phrase: initialSettings.wakeWord,
  onDetect: () => {
    showToast('Palabra de activación detectada', 'success');
    startVoice();
  },
  onError: ({ message }) => {
    showToast(message, 'error');
    updateSettings({ wakeWordEnabled: false });
    syncSettingsControls();
    updateHandsFreeHint();
  },
  onStateChange: () => updateHandsFreeHint(),
});

const acousticTrigger = new AcousticTrigger({
  sensitivity: initialSettings.clapSensitivity,
  onTrigger: () => {
    showToast('Chasquido detectado', 'success');
    startVoice();
  },
  onError: ({ message }) => {
    showToast(message, 'error');
    updateSettings({ clapTriggerEnabled: false });
    syncSettingsControls();
    updateHandsFreeHint();
  },
  onStateChange: () => updateHandsFreeHint(),
});

function pauseHandsFree() {
  wakeWordService.pause();
  acousticTrigger.pause();
  updateHandsFreeHint();
}

function resumeHandsFree() {
  wakeWordService.resume();
  acousticTrigger.resume();
  updateHandsFreeHint();
}

function updateHandsFreeHint() {
  const { settings, voiceStatus } = store.getState();

  if (voiceStatus === 'listening') {
    setVoiceHint(settings.continuousMode ? 'Di «siguiente» para separar elementos' : '');
    return;
  }

  const triggers = [];
  if (settings.wakeWordEnabled) triggers.push(`di «${settings.wakeWord}»`);
  if (settings.clapTriggerEnabled) triggers.push('chasquea dos veces');

  setVoiceHint(triggers.length ? `Manos libres: ${triggers.join(' o ')}` : '');
}

function startVoice() {
  if (!isSpeechSupported) {
    showToast('Tu navegador no soporta reconocimiento de voz. Prueba con Chrome o Edge.', 'error');
    return;
  }
  pauseHandsFree();
  voiceService.start();
}

function toggleVoice() {
  if (store.getState().voiceStatus === 'listening') {
    voiceService.stop();
  } else {
    startVoice();
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

function deleteList(id, { confirmFirst = true } = {}) {
  const list = store.getState().lists.find((l) => l.id === id);
  if (!list) return;
  if (confirmFirst && !confirm(`¿Eliminar la lista "${list.name}" y todos sus elementos?`)) return;

  const remaining = store.getState().lists.filter((l) => l.id !== id);
  persistLists(remaining);
  if (store.getState().activeListId === id) {
    persistActiveListId(remaining[0]?.id ?? null);
  }
  if (paletteOpenListId === id) paletteOpenListId = null;
  editingItemId = null;
  render();
  showToast(`Lista "${list.name}" eliminada`);
}

function handleAction(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action, id } = target.dataset;

  switch (action) {
    case 'select-list':
      persistActiveListId(id);
      editingItemId = null;
      paletteOpenListId = null;
      render();
      if (window.innerWidth < 960) closeSidebar();
      break;

    case 'delete-list':
      deleteList(id);
      break;

    case 'toggle-palette':
      paletteOpenListId = paletteOpenListId === id ? null : id;
      render();
      break;

    case 'set-list-color':
      updateLists((lists) =>
        lists.map((list) => (list.id === id ? { ...list, color: target.dataset.color } : list))
      );
      paletteOpenListId = null;
      render();
      break;

    case 'share-clipboard':
    case 'share-email':
      shareActiveList(
        action.replace('share-', ''),
        store.getState().lists.find((l) => l.id === id)
      );
      break;

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

document.getElementById('sidebar-list').addEventListener('click', handleAction);
document.getElementById('list-panel').addEventListener('click', handleAction);
document.getElementById('list-panel').addEventListener('change', handleAction);

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
// Drag & Drop reordering
// ------------------------------------------------------------------

let draggedItemId = null;
let draggedFromListId = null;

const listPanelEl = document.getElementById('list-panel');

listPanelEl.addEventListener('dragstart', (event) => {
  const item = event.target.closest('[data-role="draggable-item"]');
  if (!item) return;
  draggedItemId = item.dataset.itemId;
  draggedFromListId = store.getState().activeListId;
  item.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
});

listPanelEl.addEventListener('dragend', (event) => {
  const item = event.target.closest('[data-role="draggable-item"]');
  if (item) item.classList.remove('dragging');
  draggedItemId = null;
});

listPanelEl.addEventListener('dragover', (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const target = event.target.closest('[data-role="draggable-item"]');
  if (target && draggedItemId && target.dataset.itemId !== draggedItemId) {
    target.classList.add('drag-over');
  }
});

listPanelEl.addEventListener('dragleave', (event) => {
  const target = event.target.closest('[data-role="draggable-item"]');
  if (target) target.classList.remove('drag-over');
});

listPanelEl.addEventListener('drop', (event) => {
  event.preventDefault();
  const target = event.target.closest('[data-role="draggable-item"]');
  if (!target || !draggedItemId) return;

  target.classList.remove('drag-over');

  const sourceList = store.getState().lists.find((l) => l.id === draggedFromListId);
  if (!sourceList) return;

  const draggedIndex = sourceList.items.findIndex((item) => item.id === draggedItemId);
  const targetIndex = sourceList.items.findIndex((item) => item.id === target.dataset.itemId);
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
// Keyboard input
// ------------------------------------------------------------------

const keyboardInputForm = document.getElementById('keyboard-input-form');
const keyboardInput = document.getElementById('keyboard-input');
const keyboardToggle = document.getElementById('keyboard-toggle');

keyboardToggle.addEventListener('click', () => {
  const isVisible = !keyboardInputForm.hidden;
  keyboardInputForm.hidden = isVisible;
  if (!isVisible) {
    keyboardInput.focus();
  }
});

keyboardInputForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = keyboardInput.value.trim();
  if (!text) return;

  const { lists, activeListId } = store.getState();
  const activeId = activeListId || ensureActiveOrDefaultList();
  handleAddItems(null, [{ text: capitalize(text) }]);
  keyboardInput.value = '';
  keyboardInput.focus();
});

// ------------------------------------------------------------------
// Settings
// ------------------------------------------------------------------

const settingsToggle = document.getElementById('settings-toggle');
const langSelect = document.getElementById('settings-lang');
const silenceRange = document.getElementById('settings-silence');
const silenceValue = document.getElementById('settings-silence-value');
const continuousCheckbox = document.getElementById('settings-continuous');
const quantitiesCheckbox = document.getElementById('settings-quantities');
const wakeWordCheckbox = document.getElementById('settings-wake-word');
const wakeWordInput = document.getElementById('settings-wake-word-phrase');
const clapCheckbox = document.getElementById('settings-clap');
const clapRange = document.getElementById('settings-clap-sensitivity');
const installButton = document.getElementById('settings-install');

function updateSettings(partial) {
  persistSettings({ ...store.getState().settings, ...partial });
}

/** Mirrors the stored settings back onto the controls. */
function syncSettingsControls() {
  const settings = store.getState().settings;

  langSelect.value = settings.lang;
  silenceRange.value = settings.silenceMs / 1000;
  silenceValue.textContent = `${(settings.silenceMs / 1000).toFixed(1)}s`;
  continuousCheckbox.checked = settings.continuousMode;
  quantitiesCheckbox.checked = settings.smartQuantities;
  wakeWordCheckbox.checked = settings.wakeWordEnabled;
  wakeWordInput.value = settings.wakeWord;
  wakeWordInput.disabled = !settings.wakeWordEnabled;
  clapCheckbox.checked = settings.clapTriggerEnabled;
  clapRange.value = settings.clapSensitivity;
  clapRange.disabled = !settings.clapTriggerEnabled;
}

settingsToggle.addEventListener('click', () => {
  syncSettingsControls();
  openSettingsModal();
});

langSelect.addEventListener('change', () => {
  updateSettings({ lang: langSelect.value });
  voiceService.setLang(langSelect.value);
  wakeWordService.setLang(langSelect.value);
});

silenceRange.addEventListener('input', () => {
  silenceValue.textContent = `${Number(silenceRange.value).toFixed(1)}s`;
});

silenceRange.addEventListener('change', () => {
  const silenceMs = Math.round(Number(silenceRange.value) * 1000);
  updateSettings({ silenceMs });
  voiceService.setSilenceMs(silenceMs);
});

continuousCheckbox.addEventListener('change', () => {
  const continuousMode = continuousCheckbox.checked;
  updateSettings({ continuousMode });
  voiceService.setContinuous(continuousMode);
  setContinuousLabel(continuousMode);
  showToast(
    continuousMode
      ? 'Dictado continuo activado: la escucha no se cortará por silencio'
      : 'Dictado continuo desactivado'
  );
});

quantitiesCheckbox.addEventListener('change', () => {
  updateSettings({ smartQuantities: quantitiesCheckbox.checked });
});

wakeWordCheckbox.addEventListener('change', async () => {
  const enabled = wakeWordCheckbox.checked;
  updateSettings({ wakeWordEnabled: enabled });
  wakeWordInput.disabled = !enabled;

  if (!enabled) {
    wakeWordService.disable();
    updateHandsFreeHint();
    return;
  }

  if (!isWakeWordSupported) {
    showToast('Este navegador no soporta la palabra de activación.', 'error');
    updateSettings({ wakeWordEnabled: false });
    syncSettingsControls();
    return;
  }

  wakeWordService.setPhrase(store.getState().settings.wakeWord);
  if (wakeWordService.enable()) {
    showToast(`Escucha pasiva activada. Di «${store.getState().settings.wakeWord}»`, 'success');
  }
  updateHandsFreeHint();
});

wakeWordInput.addEventListener('change', () => {
  const phrase = wakeWordInput.value.trim() || 'oye blabla';
  wakeWordInput.value = phrase;
  updateSettings({ wakeWord: phrase });
  wakeWordService.setPhrase(phrase);
  updateHandsFreeHint();
});

clapCheckbox.addEventListener('change', async () => {
  const enabled = clapCheckbox.checked;
  updateSettings({ clapTriggerEnabled: enabled });
  clapRange.disabled = !enabled;

  if (!enabled) {
    acousticTrigger.disable();
    updateHandsFreeHint();
    return;
  }

  if (!isAcousticTriggerSupported) {
    showToast('Este navegador no soporta el disparador acústico.', 'error');
    updateSettings({ clapTriggerEnabled: false });
    syncSettingsControls();
    return;
  }

  const started = await acousticTrigger.enable();
  if (started) {
    showToast('Chasquido activado: dos chasquidos abren el micrófono', 'success');
  } else {
    updateSettings({ clapTriggerEnabled: false });
    syncSettingsControls();
  }
  updateHandsFreeHint();
});

clapRange.addEventListener('change', () => {
  const clapSensitivity = Number(clapRange.value);
  updateSettings({ clapSensitivity });
  acousticTrigger.setSensitivity(clapSensitivity);
});

// ------------------------------------------------------------------
// Data management
// ------------------------------------------------------------------

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
  return lists.map((list) => buildListText(list, { branding: false })).join('\n\n———\n\n');
}

document.getElementById('settings-export-json').addEventListener('click', () => {
  downloadFile(
    JSON.stringify(storage.exportAll(), null, 2),
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
    const data = JSON.parse(await file.text());
    storage.importAll(data);
    store.setState({
      lists: storage.loadLists(),
      activeListId: storage.loadActiveListId(),
      settings: storage.loadSettings(),
    });
    render();
    syncSettingsControls();
    closeSettingsModal();
    showToast('Datos importados correctamente', 'success');
  } catch {
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
  paletteOpenListId = null;
  render();
  syncSettingsControls();
  closeSettingsModal();
  showToast('Todos los datos han sido borrados');
});

installButton?.addEventListener('click', async () => {
  const accepted = await promptInstall();
  if (accepted) {
    installButton.hidden = true;
    showToast('BlaBlaNotes se está instalando', 'success');
  }
});

// ------------------------------------------------------------------
// Init
// ------------------------------------------------------------------

function initHandsFree() {
  const settings = store.getState().settings;

  // Passive listening needs a user gesture on most browsers, so a session
  // that starts with these already enabled arms them on the first interaction.
  if (settings.wakeWordEnabled || settings.clapTriggerEnabled) {
    const arm = () => {
      if (settings.wakeWordEnabled && isWakeWordSupported) {
        wakeWordService.setPhrase(settings.wakeWord);
        wakeWordService.enable();
      }
      if (settings.clapTriggerEnabled && isAcousticTriggerSupported) {
        acousticTrigger.setSensitivity(settings.clapSensitivity);
        acousticTrigger.enable();
      }
      updateHandsFreeHint();
    };
    document.addEventListener('pointerdown', arm, { once: true });
    document.addEventListener('keydown', arm, { once: true });
  }

  updateHandsFreeHint();
}

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

  initPwa({
    onUpdateAvailable: (applyUpdate) => {
      showToast('Nueva versión disponible, actualizando…');
      applyUpdate();
    },
    onInstallAvailable: () => {
      if (installButton) installButton.hidden = false;
    },
    onInstalled: () => {
      if (installButton) installButton.hidden = true;
      showToast('BlaBlaNotes instalada', 'success');
    },
    onOffline: () => showToast('Sin conexión. Tus listas siguen disponibles.'),
    onOnline: () => showToast('Conexión restablecida', 'success'),
  });

  if (installButton) installButton.hidden = !canInstall() || isStandalone;

  initShareFab();
  onVoiceButtonClick(toggleVoice);

  if (!isSpeechSupported) {
    setVoiceStatus('idle');
    showToast('Tu navegador no soporta reconocimiento de voz. Prueba con Chrome o Edge.', 'error');
  }

  setContinuousLabel(store.getState().settings.continuousMode);
  syncSettingsControls();
  initHandsFree();
  render();
}
