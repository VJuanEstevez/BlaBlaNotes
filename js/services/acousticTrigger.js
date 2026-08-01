const AudioContextImpl = window.AudioContext || window.webkitAudioContext;

export const isAcousticTriggerSupported = Boolean(
  AudioContextImpl && navigator.mediaDevices?.getUserMedia
);

const FFT_SIZE = 1024;
const SAMPLE_INTERVAL_MS = 25;
/** Ignore anything below this peak, however sharp it is. */
const MIN_PEAK = 0.06;
/** A clap must be this many times louder than the running noise floor. */
const MIN_PEAK_RATIO = 3;
/** Claps are broadband: most of their energy sits above ~2 kHz. */
const MIN_HIGH_FREQUENCY_SHARE = 0.35;
const HIGH_FREQUENCY_HZ = 2000;
/** Dead time after a detection, so one clap is never counted twice. */
const REFRACTORY_MS = 220;
/** Window in which the required claps must all happen. */
const SEQUENCE_WINDOW_MS = 900;
/** How fast the noise floor follows the room; low = slow, stable baseline. */
const BASELINE_SMOOTHING = 0.06;
const WARMUP_MS = 600;

/**
 * Experimental hands-free trigger: listens for a short, sharp transient
 * (a finger snap or clap) and fires without any touch or glance at the
 * screen. Runs entirely on-device through the Web Audio API — no audio is
 * recorded, transcribed or sent anywhere; only a running loudness figure
 * is inspected.
 *
 * Speech is rejected by requiring both a sudden jump over the noise floor
 * and a high-frequency-heavy spectrum, which voices lack.
 */
export class AcousticTrigger {
  constructor({ onTrigger, onError, onStateChange, sensitivity = 0.5, clapsRequired = 2 } = {}) {
    this.onTrigger = onTrigger || (() => {});
    this.onError = onError || (() => {});
    this.onStateChange = onStateChange || (() => {});
    this.sensitivity = sensitivity;
    this.clapsRequired = clapsRequired;

    this.enabled = false;
    this.paused = false;
    this.stream = null;
    this.audioContext = null;
    this.analyser = null;
    this.source = null;
    this.timeData = null;
    this.frequencyData = null;
    this.loopTimer = null;

    this.baseline = 0.02;
    this.lastDetectionAt = 0;
    this.clapTimes = [];
    this.startedAt = 0;
  }

  get isActive() {
    return this.enabled && !this.paused;
  }

  setSensitivity(value) {
    this.sensitivity = Math.min(1, Math.max(0, Number(value) || 0));
  }

  setClapsRequired(count) {
    this.clapsRequired = Math.min(3, Math.max(1, Number(count) || 1));
  }

  /** Higher sensitivity lowers both the absolute and the relative threshold. */
  get peakThreshold() {
    return MIN_PEAK + (1 - this.sensitivity) * 0.22;
  }

  get ratioThreshold() {
    return MIN_PEAK_RATIO + (1 - this.sensitivity) * 3;
  }

  async enable() {
    if (!isAcousticTriggerSupported) {
      this.onError({ code: 'unsupported', message: 'Este navegador no soporta el disparador acústico.' });
      return false;
    }
    if (this.enabled) return true;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (error) {
      this.onError({
        code: 'not-allowed',
        message: 'Sin acceso al micrófono para detectar chasquidos.',
        raw: error,
      });
      return false;
    }

    this.audioContext = new AudioContextImpl();
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume().catch(() => {});
    }

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0;

    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);

    this.timeData = new Float32Array(this.analyser.fftSize);
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);

    this.enabled = true;
    this.paused = false;
    this.baseline = 0.02;
    this.clapTimes = [];
    this.startedAt = Date.now();
    this._startLoop();
    this.onStateChange('waiting');
    return true;
  }

  disable() {
    this.enabled = false;
    this.paused = false;
    this._stopLoop();
    this._teardownAudio();
    this.onStateChange('off');
  }

  /** Releases the analyser while dictation owns the microphone. */
  pause() {
    if (!this.enabled || this.paused) return;
    this.paused = true;
    this._stopLoop();
    this.onStateChange('paused');
  }

  resume() {
    if (!this.enabled || !this.paused) return;
    this.paused = false;
    this.baseline = 0.02;
    this.clapTimes = [];
    this.startedAt = Date.now();
    this._startLoop();
    this.onStateChange('waiting');
  }

  _startLoop() {
    this._stopLoop();
    // An interval rather than requestAnimationFrame: rAF is throttled when the
    // tab is not visible, which is precisely when hands-free matters most.
    this.loopTimer = setInterval(() => this._sample(), SAMPLE_INTERVAL_MS);
  }

  _stopLoop() {
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  _teardownAudio() {
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
    }
    this.source = null;
    this.analyser = null;
    this.audioContext = null;
    this.stream = null;
  }

  /** Share of the spectrum's energy that sits above `HIGH_FREQUENCY_HZ`. */
  _highFrequencyShare() {
    this.analyser.getByteFrequencyData(this.frequencyData);
    const binHz = this.audioContext.sampleRate / this.analyser.fftSize;
    const cutoffBin = Math.floor(HIGH_FREQUENCY_HZ / binHz);

    let total = 0;
    let high = 0;
    for (let i = 0; i < this.frequencyData.length; i++) {
      total += this.frequencyData[i];
      if (i >= cutoffBin) high += this.frequencyData[i];
    }

    return total > 0 ? high / total : 0;
  }

  _sample() {
    if (!this.isActive || !this.analyser) return;

    this.analyser.getFloatTimeDomainData(this.timeData);

    let peak = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const amplitude = Math.abs(this.timeData[i]);
      if (amplitude > peak) peak = amplitude;
    }

    const now = Date.now();
    // Let the noise floor settle before accepting any detection.
    const warmedUp = now - this.startedAt > WARMUP_MS;

    const isTransient =
      warmedUp &&
      peak > this.peakThreshold &&
      peak > this.baseline * this.ratioThreshold &&
      now - this.lastDetectionAt > REFRACTORY_MS;

    if (isTransient && this._highFrequencyShare() >= MIN_HIGH_FREQUENCY_SHARE) {
      this.lastDetectionAt = now;
      this._registerClap(now);
    } else {
      // Only quiet frames feed the baseline, so a clap cannot raise its own floor.
      this.baseline = this.baseline * (1 - BASELINE_SMOOTHING) + peak * BASELINE_SMOOTHING;
    }
  }

  _registerClap(now) {
    this.clapTimes = this.clapTimes.filter((time) => now - time < SEQUENCE_WINDOW_MS);
    this.clapTimes.push(now);

    if (this.clapTimes.length >= this.clapsRequired) {
      this.clapTimes = [];
      this.onStateChange('detected');
      this.onTrigger();
    }
  }
}
