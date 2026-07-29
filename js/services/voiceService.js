const SpeechRecognitionImpl =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

export const isSpeechSupported = Boolean(SpeechRecognitionImpl);

/**
 * Wraps the Web Speech API with continuous listening and a rolling
 * silence timer: every time speech is detected the timer resets, and
 * when it fires the accumulated transcript is handed off as one
 * finished item so the app can save it and start capturing the next one.
 */
export class VoiceService {
  constructor({ lang, silenceMs, onInterim, onFinalItem, onStateChange, onError }) {
    this.lang = lang;
    this.silenceMs = silenceMs;
    this.onInterim = onInterim || (() => {});
    this.onFinalItem = onFinalItem || (() => {});
    this.onStateChange = onStateChange || (() => {});
    this.onError = onError || (() => {});

    this.recognition = null;
    this.isListening = false;
    this.shouldRestart = false;
    this.silenceTimer = null;
    this.buffer = '';

    if (isSpeechSupported) {
      this._setup();
    }
  }

  _setup() {
    this.recognition = new SpeechRecognitionImpl();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = this.lang;

    this.recognition.onresult = (event) => this._handleResult(event);
    this.recognition.onerror = (event) => this._handleError(event);
    this.recognition.onend = () => this._handleEnd();
  }

  setLang(lang) {
    this.lang = lang;
    if (this.recognition) this.recognition.lang = lang;
  }

  setSilenceMs(ms) {
    this.silenceMs = ms;
  }

  start() {
    if (!isSpeechSupported) {
      this.onError({ code: 'unsupported', message: 'Este navegador no soporta reconocimiento de voz.' });
      return;
    }
    if (this.isListening) return;

    this.buffer = '';
    this.shouldRestart = true;
    try {
      this.recognition.start();
      this.isListening = true;
      this.onStateChange('listening');
    } catch (error) {
      this.onError({ code: 'start-failed', message: 'No se pudo iniciar el micrófono.', raw: error });
    }
  }

  stop() {
    this.shouldRestart = false;
    this._clearSilenceTimer();
    if (this.recognition && this.isListening) {
      this.recognition.stop();
    }
    this.isListening = false;
    this._commitBuffer();
    this.onStateChange('idle');
  }

  _handleResult(event) {
    let interim = '';
    let finalChunk = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalChunk += result[0].transcript;
      } else {
        interim += result[0].transcript;
      }
    }

    if (finalChunk) {
      this.buffer = `${this.buffer} ${finalChunk}`.trim();
    }

    this.onInterim(`${this.buffer} ${interim}`.trim());
    this._resetSilenceTimer();
  }

  _resetSilenceTimer() {
    this._clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      this._commitBuffer();
    }, this.silenceMs);
  }

  _clearSilenceTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  _commitBuffer() {
    this._clearSilenceTimer();
    const text = this.buffer.trim();
    this.buffer = '';
    this.onInterim('');
    if (text) {
      this.onFinalItem(text);
    }
  }

  _handleError(event) {
    const messages = {
      'not-allowed': 'Permiso de micrófono denegado. Actívalo en los ajustes del navegador.',
      'no-speech': 'No se detectó voz. Inténtalo de nuevo.',
      network: 'Error de red durante el reconocimiento de voz.',
      'audio-capture': 'No se encontró ningún micrófono.',
      aborted: null,
    };

    const message = event.error in messages ? messages[event.error] : `Error de reconocimiento: ${event.error}`;

    if (event.error === 'not-allowed' || event.error === 'audio-capture') {
      this.shouldRestart = false;
      this.isListening = false;
    }

    if (message) {
      this.onError({ code: event.error, message });
    }
  }

  _handleEnd() {
    this.isListening = false;
    if (this.shouldRestart) {
      try {
        this.recognition.start();
        this.isListening = true;
      } catch {
        this.shouldRestart = false;
        this.onStateChange('idle');
      }
    } else {
      this._commitBuffer();
      this.onStateChange('idle');
    }
  }
}
