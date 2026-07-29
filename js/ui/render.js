import { hexToRgba } from '../utils/colors.js';

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

const sidebarListEl = document.getElementById('sidebar-list');
const sidebarEmptyEl = document.getElementById('sidebar-empty');
const mainEl = document.getElementById('main-content');
const listPanelPlaceholder = document.getElementById('list-panel-placeholder');
const listPanelContent = document.getElementById('list-panel-content');

export function renderSidebar({ lists, activeListId }) {
  sidebarEmptyEl.hidden = lists.length > 0;
  sidebarListEl.innerHTML = lists
    .map((list) => {
      const isActive = list.id === activeListId;
      return `
        <li class="sidebar__item${isActive ? ' sidebar__item--active' : ''}">
          <button
            class="sidebar__item-btn"
            type="button"
            data-action="select-list"
            data-id="${list.id}"
            aria-current="${isActive ? 'true' : 'false'}"
          >
            <span class="sidebar__color-dot" style="background:${list.color}" aria-hidden="true"></span>
            <span class="sidebar__item-name">${escapeHtml(list.name)}</span>
            <span class="sidebar__item-count">${list.items.length}</span>
          </button>
        </li>
      `;
    })
    .join('');
}

function renderItem(item, isEditing) {
  if (isEditing) {
    return `
      <li class="list-item" data-item-id="${item.id}">
        <input
          class="list-item__input"
          type="text"
          value="${escapeHtml(item.text)}"
          data-role="edit-input"
          data-id="${item.id}"
          aria-label="Editar texto del elemento"
        />
        <div class="list-item__actions">
          <button class="list-item__btn list-item__btn--save" type="button" data-action="save-item" data-id="${item.id}" aria-label="Guardar cambios">✓</button>
          <button class="list-item__btn" type="button" data-action="cancel-edit" data-id="${item.id}" aria-label="Cancelar edición">✕</button>
        </div>
      </li>
    `;
  }

  return `
    <li class="list-item${item.completed ? ' list-item--completed' : ''}" data-item-id="${item.id}" draggable="true" data-role="draggable-item">
      <span class="list-item__drag-handle" aria-hidden="true">⋮⋮</span>
      <input
        class="list-item__checkbox"
        type="checkbox"
        ${item.completed ? 'checked' : ''}
        data-action="toggle-item"
        data-id="${item.id}"
        aria-label="Marcar como completado: ${escapeHtml(item.text)}"
      />
      <span class="list-item__text" data-role="item-text">${escapeHtml(item.text)}</span>
      <div class="list-item__actions">
        <button class="list-item__btn list-item__btn--edit" type="button" data-action="edit-item" data-id="${item.id}" aria-label="Editar elemento">✎</button>
        <button class="list-item__btn list-item__btn--delete" type="button" data-action="delete-item" data-id="${item.id}" aria-label="Eliminar elemento">🗑</button>
      </div>
    </li>
  `;
}

export function renderListPanel({ lists, activeListId }, editingItemId = null) {
  const list = lists.find((l) => l.id === activeListId);

  if (!list) {
    listPanelPlaceholder.hidden = false;
    listPanelContent.innerHTML = '';
    mainEl.style.removeProperty('--list-tint');
    return;
  }

  listPanelPlaceholder.hidden = true;
  mainEl.style.setProperty('--list-tint', list.color);

  const itemsHtml =
    list.items.length > 0
      ? `<ul class="list-panel__items" data-role="items">${list.items.map((item) => renderItem(item, item.id === editingItemId)).join('')}</ul>`
      : `<p class="list-panel__empty">Esta lista está vacía. Pulsa el micrófono y dicta un elemento.</p>`;

  listPanelContent.innerHTML = `
    <header class="list-panel__header" style="--list-color:${list.color}">
      <div class="list-panel__title-group">
        <h2 class="list-panel__title">${escapeHtml(list.name)}</h2>
        <span class="list-panel__count">${list.items.length} elemento${list.items.length === 1 ? '' : 's'}</span>
      </div>
      <div class="list-panel__actions">
        <button
          class="list-panel__share-btn"
          type="button"
          data-action="share-whatsapp"
          data-id="${list.id}"
          aria-label="Compartir por WhatsApp"
          title="Compartir por WhatsApp"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.67-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.076 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421-7.403h-.004a9.87 9.87 0 00-4.935 1.23l-.344.202-3.573-.934.951 3.462.202.323a9.875 9.875 0 001.516 5.031c2.122 2.856 5.588 4.17 8.757 3.355 3.169-.816 5.594-3.625 5.966-6.811.372-3.187-.839-6.234-3.159-7.977-1.16-.863-2.516-1.349-3.916-1.348z"/>
          </svg>
        </button>
        <button
          class="list-panel__share-btn"
          type="button"
          data-action="share-email"
          data-id="${list.id}"
          aria-label="Compartir por Email"
          title="Compartir por Email"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
          </svg>
        </button>
      </div>
    </header>
    ${itemsHtml}
  `;
}

export function renderAll(state, editingItemId = null) {
  renderSidebar(state);
  renderListPanel(state, editingItemId);
}

export function focusEditInput(itemId) {
  const input = listPanelContent.querySelector(`[data-role="edit-input"][data-id="${itemId}"]`);
  if (input) {
    input.focus();
    input.select();
  }
}
