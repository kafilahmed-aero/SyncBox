/**
 * AudioEngine.js — Browser Web Audio API engine for SyncBox.
 * Manages AudioContext lifecycle, AudioBuffer decoding, AudioBufferSourceNode local playback, and playbackRate drift correction.
 */

class AudioEngine {
  constructor() {
    this.audioCtx = null;
    this.currentBuffer = null;
    this.metadata = null;
    
    // Playback Engine Properties
    this.activeSource = null;
    this.playbackState = 'STOPPED'; // 'STOPPED' | 'PLAYING' | 'PAUSED'
    this.startTime = 0;
    this.startOffset = 0;
    this.sourceGeneration = 0;
    this.onEndedCallback = null;
    this.playbackRateValue = 1.0;

    // Load per-device physical offset calibration from localStorage (defaults to 0.0s)
    let savedOffset = 0.0;
    try {
      const stored = localStorage.getItem('syncbox_user_offset');
      if (stored !== null && !isNaN(Number(stored))) {
        savedOffset = Number(stored);
      }
    } catch (e) {}
    this.userOffsetSec = savedOffset;
  }

  /**
   * Returns or initializes the AudioContext instance.
   * NEVER called automatically on page load.
   */
  getAudioContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error('Web Audio API is not supported in this browser environment.');
      }
      this.audioCtx = new AudioContextClass();
    }
    return this.audioCtx;
  }

  /**
   * Activates/resumes the AudioContext upon user gesture.
   */
  async activate() {
    try {
      const ctx = this.getAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      if (ctx.state !== 'running') {
        throw new Error(`AudioContext state is '${ctx.state}', expected 'running'.`);
      }
      return true;
    } catch (err) {
      console.error('[SyncBox AudioEngine] Activation failed:', err);
      throw err;
    }
  }

  /**
   * Reads a local File object into an ArrayBuffer and decodes it using AudioContext.decodeAudioData().
   */
  async loadAndDecodeAudioFile(file) {
    if (!file) {
      throw new Error('No file provided');
    }

    // Stop existing playback before loading new buffer
    this.stop();

    const ctx = this.getAudioContext();

    // 1. Read file as ArrayBuffer
    const arrayBuffer = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read local audio file.'));
      reader.readAsArrayBuffer(file);
    });

    // 2. Decode AudioData to AudioBuffer
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    // 3. Store AudioBuffer and Metadata
    this.currentBuffer = audioBuffer;
    this.metadata = {
      name: file.name,
      size: file.size,
      type: file.type,
      duration: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      numberOfChannels: audioBuffer.numberOfChannels
    };

    return this.metadata;
  }

  /**
   * Safely stops and disconnects the active AudioBufferSourceNode without triggering natural completion logic.
   */
  stopActiveSourceOnly() {
    if (this.activeSource) {
      const sourceToStop = this.activeSource;
      this.activeSource = null;
      sourceToStop.isIntentionalStop = true;
      try {
        sourceToStop.stop();
        sourceToStop.disconnect();
      } catch (err) {
        // Ignore if already stopped
      }
    }
  }

  /**
   * Safely modifies active AudioBufferSourceNode's playbackRate for Phase 7 soft drift correction.
   * Clamped to safe range [0.5, 2.0].
   */
  setPlaybackRate(rate = 1.0) {
    const clampedRate = Math.max(0.5, Math.min(2.0, Number(rate) || 1.0));
    this.playbackRateValue = clampedRate;

    if (this.activeSource && this.activeSource.playbackRate) {
      try {
        this.activeSource.playbackRate.value = clampedRate;
      } catch (err) {
        console.error('[SyncBox AudioEngine] Error setting playbackRate:', err);
      }
    }
  }

  /**
   * Returns current playbackRate value.
   */
  getPlaybackRate() {
    return this.playbackRateValue;
  }

  /**
   * Safe feature-detection for Web Audio API hardware output timing properties.
   */
  getOutputLatencyDetails() {
    if (!this.audioCtx) {
      return {
        baseLatencySec: 0,
        outputLatencySec: 0,
        totalLatencySec: 0,
        baseSupported: false,
        outputSupported: false,
        timestampSupported: false,
        outputTimestamp: null
      };
    }

    const baseSupported = typeof this.audioCtx.baseLatency === 'number';
    const outputSupported = typeof this.audioCtx.outputLatency === 'number';
    const timestampSupported = typeof this.audioCtx.getOutputTimestamp === 'function';

    const baseLatencySec = baseSupported ? Number(this.audioCtx.baseLatency) || 0 : 0;
    const outputLatencySec = outputSupported ? Number(this.audioCtx.outputLatency) || 0 : 0;
    const totalLatencySec = baseLatencySec + outputLatencySec;

    let outputTimestamp = null;
    if (timestampSupported) {
      try {
        outputTimestamp = this.audioCtx.getOutputTimestamp();
      } catch (err) {
        outputTimestamp = null;
      }
    }

    return {
      baseLatencySec,
      outputLatencySec,
      totalLatencySec,
      baseSupported,
      outputSupported,
      timestampSupported,
      outputTimestamp
    };
  }

  /**
   * Returns current user calibration offset in seconds.
   */
  getUserOffset() {
    return this.userOffsetSec || 0.0;
  }

  /**
   * Sets per-device calibration offset in seconds and persists in localStorage.
   */
  setUserOffset(offsetSec) {
    const val = Math.max(-5.0, Math.min(5.0, Number(offsetSec) || 0.0));
    this.userOffsetSec = val;
    try {
      localStorage.setItem('syncbox_user_offset', String(val.toFixed(2)));
    } catch (e) {}
  }

  /**
   * Returns total hardware audio output latency in seconds (baseLatency + outputLatency)
   * using safe feature detection across desktop and mobile browsers.
   */
  getOutputLatency() {
    return this.getOutputLatencyDetails().totalLatencySec;
  }

  /**
   * Returns estimated physical sound position reaching the speakers in seconds
   * by compensating for hardware audio output pipeline latency and per-device user offset.
   */
  getAcousticPosition() {
    const rawPos = this.getCurrentPosition();
    if (this.playbackState !== 'PLAYING') return rawPos;
    const latencySec = this.getOutputLatency();
    const netPos = rawPos - (latencySec * this.playbackRateValue) + this.userOffsetSec;
    return Math.max(0, netPos);
  }

  /**
   * Starts immediate playback of loaded AudioBuffer from current startOffset.
   */
  async play() {
    if (!this.currentBuffer) {
      throw new Error('No audio file loaded');
    }

    const ctx = this.getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    // Stop active source if any
    this.stopActiveSourceOnly();
    this.playbackRateValue = 1.0; // Reset rate to 1.0 on play

    // Increment generation ID to identify current source
    this.sourceGeneration += 1;
    const currentGen = this.sourceGeneration;

    // Instantiate new one-shot AudioBufferSourceNode
    const source = ctx.createBufferSource();
    source.buffer = this.currentBuffer;
    source.playbackRate.value = 1.0;
    source.connect(ctx.destination);
    source.isIntentionalStop = false;
    source.generation = currentGen;

    this.startTime = ctx.currentTime;
    this.activeSource = source;
    this.playbackState = 'PLAYING';

    // Attach natural end event handler
    source.onended = () => {
      if (source.isIntentionalStop || source.generation !== this.sourceGeneration) {
        return;
      }

      // Natural Track Completion
      this.playbackState = 'STOPPED';
      this.startOffset = 0;
      this.startTime = 0;
      this.playbackRateValue = 1.0;
      this.activeSource = null;

      if (this.onEndedCallback) {
        this.onEndedCallback();
      }
    };

    // Clamp offset before starting
    if (this.startOffset >= this.currentBuffer.duration) {
      this.startOffset = 0;
    }

    source.start(0, this.startOffset);
    return true;
  }

  /**
   * Schedules Web Audio API playback start at targetAudioCtxTime (seconds) from positionSeconds.
   */
  async playScheduled(targetAudioCtxTime, positionSeconds = 0) {
    if (!this.currentBuffer) {
      throw new Error('No audio file loaded');
    }

    const ctx = this.getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    // Stop active source if any
    this.stopActiveSourceOnly();
    this.playbackRateValue = 1.0; // Reset rate to 1.0 on scheduled play

    // Increment generation ID to identify current source
    this.sourceGeneration += 1;
    const currentGen = this.sourceGeneration;

    // Instantiate new one-shot AudioBufferSourceNode
    const source = ctx.createBufferSource();
    source.buffer = this.currentBuffer;
    source.playbackRate.value = 1.0;
    source.connect(ctx.destination);
    source.isIntentionalStop = false;
    source.generation = currentGen;

    this.startTime = targetAudioCtxTime;
    this.startOffset = Math.max(0, Number(positionSeconds) || 0);
    this.activeSource = source;
    this.playbackState = 'PLAYING';

    // Attach natural end event handler
    source.onended = () => {
      if (source.isIntentionalStop || source.generation !== this.sourceGeneration) {
        return;
      }

      // Natural Track Completion
      this.playbackState = 'STOPPED';
      this.startOffset = 0;
      this.startTime = 0;
      this.playbackRateValue = 1.0;
      this.activeSource = null;

      if (this.onEndedCallback) {
        this.onEndedCallback();
      }
    };

    // Clamp offset before starting
    if (this.startOffset >= this.currentBuffer.duration) {
      this.startOffset = 0;
    }

    // Schedule Web Audio API hardware start
    source.start(targetAudioCtxTime, this.startOffset);
    return true;
  }

  /**
   * Pauses active playback and preserves current position.
   */
  pause() {
    if (this.playbackState !== 'PLAYING') return;

    if (this.audioCtx) {
      const elapsed = Math.max(0, this.audioCtx.currentTime - this.startTime);
      const totalDuration = this.currentBuffer ? this.currentBuffer.duration : 0;
      this.startOffset = Math.min(this.startOffset + (elapsed * this.playbackRateValue), totalDuration);
    }

    this.stopActiveSourceOnly();
    this.playbackRateValue = 1.0; // Reset rate on pause
    this.playbackState = 'PAUSED';
  }

  /**
   * Stops playback and resets position to 0.
   */
  stop() {
    this.stopActiveSourceOnly();
    this.startOffset = 0;
    this.startTime = 0;
    this.playbackRateValue = 1.0; // Reset rate on stop
    this.playbackState = 'STOPPED';
  }

  /**
   * Seeks playback to specified position in seconds.
   */
  seek(targetPosition) {
    if (!this.currentBuffer) return;

    const duration = this.currentBuffer.duration;
    const clampedPos = Math.max(0, Math.min(targetPosition, duration));
    const isPlaying = this.playbackState === 'PLAYING';

    this.stopActiveSourceOnly();
    this.startOffset = clampedPos;
    this.playbackRateValue = 1.0; // Reset rate on seek

    if (isPlaying) {
      this.play().catch(err => {
        console.error('[SyncBox AudioEngine] Seek restart failed:', err);
      });
    }
  }

  /**
   * Returns current playback position in seconds using Web Audio API clock math.
   */
  getCurrentPosition() {
    if (!this.currentBuffer) return 0;

    if (this.playbackState === 'PLAYING' && this.audioCtx) {
      const elapsed = Math.max(0, this.audioCtx.currentTime - this.startTime);
      const duration = this.currentBuffer.duration;
      return Math.min(this.startOffset + (elapsed * this.playbackRateValue), duration);
    }

    return this.startOffset;
  }

  /**
   * Returns duration of loaded AudioBuffer in seconds.
   */
  getDuration() {
    return this.currentBuffer ? this.currentBuffer.duration : 0;
  }

  /**
   * Returns current playback state string ('STOPPED' | 'PLAYING' | 'PAUSED').
   */
  getPlaybackState() {
    return this.playbackState;
  }

  /**
   * Returns stored AudioBuffer.
   */
  getAudioBuffer() {
    return this.currentBuffer;
  }

  /**
   * Returns audio metadata.
   */
  getMetadata() {
    return this.metadata;
  }

  /**
   * Sets callback for natural song completion.
   */
  setOnEndedCallback(cb) {
    this.onEndedCallback = cb;
  }

  /**
   * Resets active AudioBuffer and metadata.
   */
  clearAudioBuffer() {
    this.stop();
    this.currentBuffer = null;
    this.metadata = null;
  }

  /**
   * Returns current AudioContext state string.
   */
  getState() {
    return this.audioCtx ? this.audioCtx.state : 'uninitialized';
  }

  /**
   * Returns true if AudioContext is initialized and currently running.
   */
  isReady() {
    return this.audioCtx !== null && this.audioCtx.state === 'running';
  }

  /**
   * Closes AudioContext instance.
   */
  async close() {
    this.clearAudioBuffer();
    if (this.audioCtx) {
      await this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}

export const audioEngine = new AudioEngine();
