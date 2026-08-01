import { normalize, levenshtein } from '../utils/text.js';

const SpeechRecognitionImpl =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

export const isWakeWordSupported = Boolean(SpeechRecognitionImpl);

export const DEFAULT_WAKE_WORD = 'oye blabla';

/** Delay before the passive recogniser is brought back up after it ends. */
const RESTART_DELAY_MS = 400;
const MAX_RESTARTS = 12;
const RESTART_WINDOW_MS = 15000;
/** Only the tail of the transcript is inspected, keeping the match cheap. */
const TAIL_WORDS = 6;
/** Characters that may differ and still count as the wake word. */
const FUZZY_TOLERANCE = 2;

/**
 * Passive listener that watches for a custom activation phrase and nothing
 * else. It runs on its own recognition instance so the main dictation engine
 * stays untouched; the app pauses this service while dictation is active,
 * because both cannot hold the microphone reliably at the same time.
 *
 * Experimental: browser speech engines are cloud-backed, so passive listening
 * means a continuous stream leaves the device. The setting is opt-in for
 * exactly that reason.
 */
export class WakeWordService {
  constructor({ lang, phrase = DEFAULT_WAKE_WORD, onDetect, onError, onStateChange } = {}) {
    this.lang = lang;
    this.phrase = normalize(phrase) || DEFAULT_WAKE_WORD;
    this.onDetect = onDetect || (() => {});
    this.onError = onError || (() => {});
    this.onStateChange = onStateChange || (() => {});

    this.recognition = null;
    this.enabled = false;
    this.paused = false;
    this.running = false;
    this.restartTimer = null;
    this.restartTimestamps = [];

    if (isWakeWordSupported) this._setup();
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

  get isActive() {
    return this.enabled && !this.paused;
  }

  setLang(lang) {
    this.lang = lang;
    if (this.recognition) this.recognition.lang = lang;
  }

  setPhrase(phrase) {
    this.phrase = normalize(phrase) || DEFAULT_WAKE_WORD;
  }

  enable() {
    if (!isWakeWordSupported) {
      this.onError({ code: 'unsupported', message: 'Este navegador no soporta la palabra de activación.' });
      return false;
    }
    this.enabled = true;
    this.paused = false;
    this.restartTimestamps = [];
    this._run();
    return true;
  }

  disable() {
    this.enabled = false;
    this._halt();
    this.onStateChange('off');
  }

  /** Frees the microphone while the main dictation engine is running. */
  pause() {
    if (!this.enabled || this.paused) return;
    this.paused = true;
    this._halt();
    this.onStateChange('paused');
  }

  resume() {
    if (!this.enabled || !this.paused) return;
    this.paused = false;
    this.restartTimestamps = [];
    this._run();
  }

  _run() {
    if (!this.isActive || this.running) return;
    try {
      this.recognition.start();
      this.running = true;
      this.onStateChange('waiting');
    } catch {
      // Already starting: `onend` will retry.
    }
  }

  _halt() {
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
    if (this.recognition && this.running) {
      try {
        this.recognition.abort();
      } catch {
        /* nothing left to abort */
      }
    }
    this.running = false;
  }

  /**
   * Compares the tail of the transcript against the wake phrase, allowing a
   * couple of characters of drift so "oye bla bla" or "oye blablá" still fire.
   */
  _matches(transcript) {
    const heard = normalize(transcript);
    if (!heard) return false;
    if (heard.includes(this.phrase)) return true;

    const words = heard.split(/\s+/).filter(Boolean);
    const phraseWords = this.phrase.split(/\s+/).length;

    for (let size = phraseWords; size <= phraseWords + 1; size++) {
      for (let start = Math.max(0, words.length - TAIL_WORDS); start + size <= words.length; start++) {
        const candidate = words.slice(start, start + size).join(' ');
        if (levenshtein(candidate, this.phrase) <= FUZZY_TOLERANCE) return true;
      }
    }

    return false;
  }

  _handleResult(event) {
    if (!this.isActive) return;

    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }

    if (!this._matches(transcript)) return;

    // Stop before notifying so the dictation engine finds the mic free.
    this._halt();
    this.onStateChange('detected');
    this.onDetect();
  }

  _handleError(event) {
    if (event.error === 'not-allowed' || event.error === 'audio-capture') {
      this.enabled = false;
      this._halt();
      this.onError({
        code: event.error,
        message: 'Sin acceso al micrófono para la palabra de activación.',
      });
      this.onStateChange('off');
    }
    // `no-speech` and `aborted` are expected during passive listening.
  }

  _handleEnd() {
    this.running = false;
    if (!this.isActive) return;

    const now = Date.now();
    this.restartTimestamps = this.restartTimestamps.filter((time) => now - time < RESTART_WINDOW_MS);
    if (this.restartTimestamps.length >= MAX_RESTARTS) {
      this.enabled = false;
      this.onError({ code: 'restart-loop', message: 'Escucha pasiva detenida: el micrófono no se mantiene abierto.' });
      this.onStateChange('off');
      return;
    }
    this.restartTimestamps.push(now);

    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => this._run(), RESTART_DELAY_MS);
  }
}
