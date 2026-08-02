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
    // Bumped on every `_setup()` call so a stray event from an instance we've
    // already replaced can never reach the handlers below.
    this.sessionId = 0;
    // Index (into the current session's `event.results`) already folded into
    // `buffer`. Some engines redeliver an already-finalized result after a
    // restart or a `stop()`; without this guard that redelivery gets appended
    // a second time and the user sees their word duplicated.
    this.processedFinalIndex = 0;

    if (isSpeechSupported) {
      this._setup();
    }
  }

  /** Creates a fresh recognition instance for a new session. Reusing the same
   *  instance across restarts is a known source of duplicated final results
   *  in Chrome; a new instance plus the session-id guard rules that out. */
  _setup() {
    this.sessionId += 1;
    const sessionId = this.sessionId;
    this.processedFinalIndex = 0;

    this.recognition = new SpeechRecognitionImpl();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = this.lang;

    this.recognition.onresult = (event) => {
      if (sessionId === this.sessionId) this._handleResult(event);
    };
    this.recognition.onerror = (event) => {
      if (sessionId === this.sessionId) this._handleError(event);
    };
    this.recognition.onend = () => {
      if (sessionId === this.sessionId) this._handleEnd();
    };
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

    // A fresh instance for this session (see `_setup`'s comment).
    this._setup();

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
      // `recognition.stop()` is asynchronous: the engine keeps processing
      // whatever audio it already captured and still fires one more
      // `onresult` with the trailing final phrase before `onend`. Committing
      // synchronously here AND letting `_handleEnd` commit again once that
      // trailing result arrives is exactly what saved the same phrase twice.
      // `_handleEnd` is the single, authoritative commit now.
      this.recognition.stop();
    } else {
      this._commitBuffer();
    }

    this.isListening = false;
    this.onStateChange('idle');
  }

  _handleResult(event) {
    let interim = '';
    let finalChunk = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        // Some engines redeliver a result index already folded into the
        // buffer (e.g. right after a `stop()`/restart); skipping it here is
        // what actually stops the duplicated word, independent of the
        // double-commit fixed in `stop()`/`_handleEnd`.
        if (i < this.processedFinalIndex) continue;
        finalChunk += result[0].transcript;
        this.processedFinalIndex = i + 1;
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
      // Fresh instance for the restarted session (see `_setup`'s comment).
      this._setup();
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
