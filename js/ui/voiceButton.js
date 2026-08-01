const button = document.getElementById('voice-button');
const statusEl = document.getElementById('voice-status');
const transcriptEl = document.getElementById('voice-transcript');
const hintEl = document.getElementById('voice-hint');

const STATUS_LABELS = {
  idle: 'Pulsa para hablar',
  listening: 'Escuchando…',
  processing: 'Guardando…',
  error: 'Ha ocurrido un error',
};

const CONTINUOUS_LABEL = 'Escuchando en continuo…';

let continuousMode = false;

export function setContinuousLabel(enabled) {
  continuousMode = enabled;
}

export function setVoiceStatus(status) {
  button.classList.remove(
    'voice-control__button--listening',
    'voice-control__button--processing',
    'voice-control__button--error'
  );

  if (status !== 'idle') {
    button.classList.add(`voice-control__button--${status}`);
  }

  button.setAttribute('aria-pressed', String(status === 'listening'));
  button.setAttribute(
    'aria-label',
    status === 'listening' ? 'Detener dictado por voz' : 'Activar dictado por voz'
  );

  statusEl.textContent =
    status === 'listening' && continuousMode ? CONTINUOUS_LABEL : STATUS_LABELS[status] || STATUS_LABELS.idle;
}

export function setTranscript(text) {
  transcriptEl.textContent = text;
}

/**
 * Shows what hands-free triggers are armed ("Di «oye blabla»…"), so the user
 * can tell passive listening is on without opening the settings.
 */
export function setVoiceHint(text) {
  if (!hintEl) return;
  hintEl.textContent = text || '';
  hintEl.hidden = !text;
}

export function onVoiceButtonClick(handler) {
  button.addEventListener('click', handler);
}
