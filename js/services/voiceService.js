const SpeechRecognitionImpl =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

export const isSpeechSupported = Boolean(SpeechRecognitionImpl);

/** Shortest pause that still counts as "end of phrase" in continuous mode. */
const MIN_PHRASE_PAUSE_MS = 900;
/** How often the keep-alive watchdog checks that the engine is still awake. */
const WATCHDOG_INTERVAL_MS = 3000;
/** Restarts allowed inside the sliding window before we give up. */
const MAX_RESTARTS = 10;
const RESTART_WINDOW_MS = 10000;

/** Spoken separators that force the current phrase to be saved right away. */
const EXPLICIT_BREAK_RE = /\s*\b(?:siguiente|nuevo elemento|nueva nota|punto y aparte|y aparte)\b\s*$/i;

/**
 * Wraps the Web Speech API with continuous listening and a rolling
 * silence timer: every time speech is detected the timer resets, and
 * when it fires the accumulated transcript is handed off as one
 * finished item so the app can save it and start capturing the next one.
 *
 * In continuous mode the session is additionally kept alive across the
 * engine's own auto-stops (Chrome closes the stream after a few seconds of
 * silence), so a long dictation is only split by natural pauses, never
 * interrupted.
 */
export class VoiceService {
  constructor({ lang, silenceMs, continuous = false, onInterim, onFinalItem, onStateChange, onError }) {
    this.lang = lang;
    this.silenceMs = silenceMs;
    this.continuous = continuous;
    this.onInterim = onInterim || (() => {});
    this.onFinalItem = onFinalItem || (() => {});
    this.onStateChange = onStateChange || (() => {});
    this.onError = onError || (() => {});

    this.recognition = null;
    this.isListening = false;
    this.shouldRestart = false;
    this.silenceTimer = null;
    this.watchdogTimer = null;
    this.buffer = '';
    this.lastActivityAt = 0;
    this.restartTimestamps = [];

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

  setContinuous(enabled) {
    this.continuous = Boolean(enabled);
  }

  /**
   * Pause after which the buffered phrase is saved. Continuous mode splits on
   * shorter, natural pauses because the session never ends afterwards, so a
   * long silence threshold would merge unrelated sentences into one item.
   */
  get phrasePauseMs() {
    if (!this.continuous) return this.silenceMs;
    return Math.max(MIN_PHRASE_PAUSE_MS, Math.min(this.silenceMs, 2000));
  }

  start() {
    if (!isSpeechSupported) {
      this.onError({ code: 'unsupported', message: 'Este navegador no soporta reconocimiento de voz.' });
      return;
    }
    if (this.isListening) return;

    this.buffer = '';
    this.shouldRestart = true;
    this.restartTimestamps = [];
    this.lastActivityAt = Date.now();

    try {
      this.recognition.start();
      this.isListening = true;
      this._startWatchdog();
      this.onStateChange('listening');
    } catch (error) {
      this.shouldRestart = false;
      this.onError({ code: 'start-failed', message: 'No se pudo iniciar el micrófono.', raw: error });
    }
  }

  stop() {
    this.shouldRestart = false;
    this._clearSilenceTimer();
    this._stopWatchdog();
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

    this.lastActivityAt = Date.now();

    if (finalChunk) {
      this.buffer = `${this.buffer} ${finalChunk}`.trim();

      // A spoken separator ends the phrase immediately, without waiting for silence.
      if (EXPLICIT_BREAK_RE.test(this.buffer)) {
        this.buffer = this.buffer.replace(EXPLICIT_BREAK_RE, '').trim();
        this._commitBuffer();
        return;
      }
    }

    this.onInterim(`${this.buffer} ${interim}`.trim());
    this._resetSilenceTimer();
  }

  _resetSilenceTimer() {
    this._clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      this._commitBuffer();
    }, this.phrasePauseMs);
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

  /**
   * Some engines stop firing `onend` after a long silence, leaving a session
   * that looks alive but is deaf. The watchdog notices the gap and restarts.
   */
  _startWatchdog() {
    this._stopWatchdog();
    if (!this.continuous) return;

    this.watchdogTimer = setInterval(() => {
      if (!this.shouldRestart) return;
      const idleFor = Date.now() - this.lastActivityAt;
      if (this.isListening && idleFor > Math.max(this.silenceMs * 3, 15000)) {
        this.lastActivityAt = Date.now();
        try {
          this.recognition.stop(); // `onend` puts the session back up.
        } catch {
          /* the engine was already down; `onend` will handle it */
        }
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  _stopWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  /** Guards against a restart storm when the engine keeps failing instantly. */
  _canRestart() {
    const now = Date.now();
    this.restartTimestamps = this.restartTimestamps.filter((time) => now - time < RESTART_WINDOW_MS);
    if (this.restartTimestamps.length >= MAX_RESTARTS) return false;
    this.restartTimestamps.push(now);
    return true;
  }

  _handleError(event) {
    const messages = {
      'not-allowed': 'Permiso de micrófono denegado. Actívalo en los ajustes del navegador.',
      'no-speech': this.continuous ? null : 'No se detectó voz. Inténtalo de nuevo.',
      network: 'Error de red durante el reconocimiento de voz.',
      'audio-capture': 'No se encontró ningún micrófono.',
      aborted: null,
    };

    const message = event.error in messages ? messages[event.error] : `Error de reconocimiento: ${event.error}`;

    if (event.error === 'not-allowed' || event.error === 'audio-capture') {
      this.shouldRestart = false;
      this.isListening = false;
      this._stopWatchdog();
    }

    if (message) {
      this.onError({ code: event.error, message });
    }
  }

  _handleEnd() {
    this.isListening = false;

    if (!this.shouldRestart) {
      this._stopWatchdog();
      this._commitBuffer();
      this.onStateChange('idle');
      return;
    }

    // Outside continuous mode the phrase in flight is saved on every
    // engine restart; in continuous mode the buffer survives so a sentence
    // split across two sessions stays a single item.
    if (!this.continuous) {
      this._commitBuffer();
    }

    if (!this._canRestart()) {
      this.shouldRestart = false;
      this._stopWatchdog();
      this._commitBuffer();
      this.onStateChange('idle');
      this.onError({ code: 'restart-loop', message: 'El micrófono se reinicia demasiado a menudo. Escucha detenida.' });
      return;
    }

    try {
      this.recognition.start();
      this.isListening = true;
      this.lastActivityAt = Date.now();
    } catch {
      this.shouldRestart = false;
      this._stopWatchdog();
      this._commitBuffer();
      this.onStateChange('idle');
    }
  }
}
