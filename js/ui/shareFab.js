import {
  buildListText,
  copyText,
  whatsappUrl,
  mailtoUrl,
  shareNative,
  canShareNative,
} from '../services/shareService.js';
import { showToast } from './toast.js';

const fabEl = document.getElementById('share-fab');
const triggerEl = document.getElementById('share-fab-trigger');
const menuEl = document.getElementById('share-fab-menu');
const nativeBtnEl = document.getElementById('share-fab-native');

let currentList = null;
let isOpen = false;

function setOpen(open) {
  isOpen = open;
  fabEl.classList.toggle('share-fab--open', open);
  menuEl.hidden = !open;
  triggerEl.setAttribute('aria-expanded', String(open));
}

function closeMenu() {
  if (isOpen) setOpen(false);
}

/** Shows or hides the whole control depending on whether a list is selected. */
export function updateShareFab(list) {
  currentList = list ?? null;

  if (!currentList) {
    closeMenu();
    fabEl.hidden = true;
    return;
  }

  fabEl.hidden = false;
  triggerEl.setAttribute('aria-label', `Compartir la lista ${currentList.name}`);
  triggerEl.title = `Compartir "${currentList.name}"`;
}

async function runAction(action) {
  if (!currentList) return;

  const text = buildListText(currentList);

  switch (action) {
    case 'clipboard': {
      const copied = await copyText(text);
      showToast(
        copied ? `"${currentList.name}" copiada al portapapeles` : 'No se pudo copiar la lista',
        copied ? 'success' : 'error'
      );
      break;
    }

    case 'whatsapp':
      window.open(whatsappUrl(text), '_blank', 'noopener');
      showToast('Abriendo WhatsApp…');
      break;

    case 'email':
      window.open(mailtoUrl(`Mi lista: ${currentList.name}`, text), '_blank', 'noopener');
      showToast('Abriendo tu cliente de correo…');
      break;

    case 'native':
      await shareNative({ title: currentList.name, text });
      break;

    default:
      break;
  }

  closeMenu();
}

export function initShareFab() {
  if (!fabEl) return;

  // The native share sheet only exists on some platforms; hide it elsewhere.
  if (nativeBtnEl) nativeBtnEl.hidden = !canShareNative;

  triggerEl.addEventListener('click', () => setOpen(!isOpen));

  menuEl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-share-action]');
    if (button) runAction(button.dataset.shareAction);
  });

  document.addEventListener('click', (event) => {
    if (isOpen && !fabEl.contains(event.target)) closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen) {
      closeMenu();
      triggerEl.focus();
    }
  });
}

/** Used by the list-panel header buttons so both entry points share one path. */
export function shareActiveList(action, list) {
  currentList = list ?? currentList;
  return runAction(action);
}
