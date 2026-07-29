import { COLOR_PALETTE } from '../utils/colors.js';

const listModal = document.getElementById('list-modal');
const listModalForm = document.getElementById('list-modal-form');
const listModalTitle = document.getElementById('list-modal-title');
const listNameInput = document.getElementById('list-name-input');
const listColorOptions = document.getElementById('list-color-options');
const listModalSubmit = document.getElementById('list-modal-submit');

let selectedColor = COLOR_PALETTE[0].value;
let onSubmitCallback = null;

listColorOptions.innerHTML = COLOR_PALETTE.map(
  (color) => `
    <button
      class="modal__color-option"
      type="button"
      role="radio"
      aria-checked="false"
      aria-label="${color.name}"
      data-color="${color.value}"
      style="background:${color.value}"
    ></button>
  `
).join('');

function paintSelectedColor() {
  listColorOptions.querySelectorAll('.modal__color-option').forEach((btn) => {
    const isSelected = btn.dataset.color === selectedColor;
    btn.classList.toggle('modal__color-option--selected', isSelected);
    btn.setAttribute('aria-checked', String(isSelected));
  });
}

listColorOptions.addEventListener('click', (event) => {
  const btn = event.target.closest('.modal__color-option');
  if (!btn) return;
  selectedColor = btn.dataset.color;
  paintSelectedColor();
});

listModalForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = listNameInput.value.trim();
  if (!name) return;
  onSubmitCallback?.({ name, color: selectedColor });
  closeListModal();
});

document.getElementById('list-modal-close').addEventListener('click', closeListModal);
document.getElementById('list-modal-cancel').addEventListener('click', closeListModal);
listModal.addEventListener('cancel', closeListModal);

export function openCreateListModal({ defaultName = '', defaultColor, onSubmit }) {
  listModalTitle.textContent = 'Nueva lista';
  listModalSubmit.textContent = 'Crear lista';
  listNameInput.value = defaultName;
  selectedColor = defaultColor || COLOR_PALETTE[0].value;
  paintSelectedColor();
  onSubmitCallback = onSubmit;
  listModal.showModal();
  listNameInput.focus();
}

function closeListModal() {
  if (listModal.open) listModal.close();
  onSubmitCallback = null;
}

// ------------------------------------------------------------------
// Settings modal
// ------------------------------------------------------------------

const settingsModal = document.getElementById('settings-modal');

export function openSettingsModal() {
  settingsModal.showModal();
}

export function closeSettingsModal() {
  if (settingsModal.open) settingsModal.close();
}

document.getElementById('settings-modal-close').addEventListener('click', closeSettingsModal);
document.getElementById('settings-done').addEventListener('click', closeSettingsModal);
settingsModal.addEventListener('cancel', closeSettingsModal);
