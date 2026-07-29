const button = document.getElementById('voice-button');
const statusEl = document.getElementById('voice-status');
const transcriptEl = document.getElementById('voice-transcript');

const STATUS_LABELS = {
  idle: 'Pulsa para hablar',
  listening: 'Escuchando…',
  processing: 'Guardando…',
  error: 'Ha ocurrido un error',
};

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
  statusEl.textContent = STATUS_LABELS[status] || STATUS_LABELS.idle;
}

export function setTranscript(text) {
  transcriptEl.textContent = text;
}

export function onVoiceButtonClick(handler) {
  button.addEventListener('click', handler);
}
