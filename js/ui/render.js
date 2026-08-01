import { COLOR_PALETTE } from '../utils/colors.js';
import { formatPrice } from '../utils/text.js';
import { quantityLabel, listTotal } from '../services/shareService.js';
import { applyDashboardColor, clearDashboardColor } from './dashboardTheme.js';

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

const sidebarListEl = document.getElementById('sidebar-list');
const sidebarEmptyEl = document.getElementById('sidebar-empty');
const listPanelPlaceholder = document.getElementById('list-panel-placeholder');
const listPanelContent = document.getElementById('list-panel-content');

export function renderSidebar({ lists, activeListId }) {
  sidebarEmptyEl.hidden = lists.length > 0;
  sidebarListEl.innerHTML = lists
    .map((list) => {
      const isActive = list.id === activeListId;
      const name = escapeHtml(list.name);
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
            <span class="sidebar__item-name">${name}</span>
            <span class="sidebar__item-count">${list.items.length}</span>
          </button>
          <button
            class="sidebar__item-delete"
            type="button"
            data-action="delete-list"
            data-id="${list.id}"
            aria-label="Eliminar la lista ${name}"
            title="Eliminar la lista ${name}"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false">
              <path d="M9 3a1 1 0 0 0-1 1v1H4.5a1 1 0 0 0 0 2H5v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7h.5a1 1 0 1 0 0-2H16V4a1 1 0 0 0-1-1H9Zm1 4a1 1 0 0 1 1 1v9a1 1 0 1 1-2 0V8a1 1 0 0 1 1-1Zm4 0a1 1 0 0 1 1 1v9a1 1 0 1 1-2 0V8a1 1 0 0 1 1-1Z"/>
            </svg>
          </button>
        </li>
      `;
    })
    .join('');
}

/** Renders the "×3 botellas" badge and the price chip, when present. */
function renderItemMeta(item) {
  const parts = [];
  const quantity = quantityLabel(item);

  if (quantity) {
    parts.push(`<span class="list-item__badge">${escapeHtml(quantity)}</span>`);
  }
  if (typeof item.price === 'number') {
    parts.push(`<span class="list-item__price">${escapeHtml(formatPrice(item.price, item.currency))}</span>`);
  }

  return parts.length ? `<span class="list-item__meta">${parts.join('')}</span>` : '';
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
      ${renderItemMeta(item)}
      <div class="list-item__actions">
        <button class="list-item__btn list-item__btn--edit" type="button" data-action="edit-item" data-id="${item.id}" aria-label="Editar elemento">✎</button>
        <button class="list-item__btn list-item__btn--delete" type="button" data-action="delete-item" data-id="${item.id}" aria-label="Eliminar elemento">🗑</button>
      </div>
    </li>
  `;
}

function renderPalette(list, isOpen) {
  const swatches = COLOR_PALETTE.map(
    (color) => `
      <button
        class="list-panel__swatch${color.value === list.color ? ' list-panel__swatch--selected' : ''}"
        type="button"
        role="radio"
        aria-checked="${color.value === list.color}"
        aria-label="Color ${color.name}"
        title="${color.name}"
        data-action="set-list-color"
        data-id="${list.id}"
        data-color="${color.value}"
        style="background:${color.value}"
      ></button>
    `
  ).join('');

  return `
    <div
      class="list-panel__palette"
      id="list-panel-palette"
      role="radiogroup"
      aria-label="Color de la lista"
      ${isOpen ? '' : 'hidden'}
    >${swatches}</div>
  `;
}

export function renderListPanel({ lists, activeListId }, { editingItemId = null, paletteOpenListId = null } = {}) {
  const list = lists.find((l) => l.id === activeListId);

  if (!list) {
    listPanelPlaceholder.hidden = false;
    listPanelContent.innerHTML = '';
    clearDashboardColor();
    return;
  }

  listPanelPlaceholder.hidden = true;
  applyDashboardColor(list.color);

  const itemsHtml =
    list.items.length > 0
      ? `<ul class="list-panel__items" data-role="items">${list.items
          .map((item) => renderItem(item, item.id === editingItemId))
          .join('')}</ul>`
      : `<p class="list-panel__empty">Esta lista está vacía. Pulsa el micrófono y dicta un elemento.</p>`;

  const total = listTotal(list);
  const currency = list.items.find((item) => typeof item.price === 'number')?.currency ?? 'EUR';
  const totalHtml =
    total > 0
      ? `<span class="list-panel__total">Total ${escapeHtml(formatPrice(total, currency))}</span>`
      : '';

  const isPaletteOpen = paletteOpenListId === list.id;

  listPanelContent.innerHTML = `
    <header class="list-panel__header" style="--list-color:${list.color}">
      <div class="list-panel__title-group">
        <h2 class="list-panel__title">${escapeHtml(list.name)}</h2>
        <p class="list-panel__meta">
          <span class="list-panel__count">${list.items.length} elemento${list.items.length === 1 ? '' : 's'}</span>
          ${totalHtml}
        </p>
      </div>
      <div class="list-panel__actions">
        <button
          class="list-panel__icon-btn"
          type="button"
          data-action="toggle-palette"
          data-id="${list.id}"
          aria-expanded="${isPaletteOpen}"
          aria-controls="list-panel-palette"
          aria-label="Cambiar el color de la lista"
          title="Cambiar color"
        >
          <span class="list-panel__current-color" style="background:${list.color}" aria-hidden="true"></span>
        </button>
        <button
          class="list-panel__icon-btn"
          type="button"
          data-action="share-clipboard"
          data-id="${list.id}"
          aria-label="Copiar la lista al portapapeles"
          title="Copiar al portapapeles"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"/>
          </svg>
        </button>
        <button
          class="list-panel__icon-btn"
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
      </div>
    </header>
    ${renderPalette(list, isPaletteOpen)}
    ${itemsHtml}
  `;
}

export function renderAll(state, options = {}) {
  renderSidebar(state);
  renderListPanel(state, options);
}

export function focusEditInput(itemId) {
  const input = listPanelContent.querySelector(`[data-role="edit-input"][data-id="${itemId}"]`);
  if (input) {
    input.focus();
    input.select();
  }
}
