/**
 * ClockSync.js — Client-Server Clock Synchronization Engine for SyncBox.
 * Performs a 4-timestamp NTP-style exchange (t1, t2, t3, t4) to measure RTT and clock offset.
 */

class ClockSync {
  constructor() {
    this.offset = 0; // Local-to-server clock offset in milliseconds
    this.rtt = 0;    // Network round-trip time in milliseconds
    this.isSynced = false;
    this.lastSyncTime = null;
    this.autoSyncTimer = null;
    this.onSyncUpdateCallback = null;
  }

  /**
   * Helper to get high-resolution monotonic epoch timestamp in milliseconds.
   */
  getHighResTime() {
    return Date.now();
  }

  /**
   * Performs a single 4-timestamp exchange over Socket.IO.
   */
  syncOnce(socket) {
    return new Promise((resolve, reject) => {
      if (!socket || !socket.connected) {
        return reject(new Error('Socket is not connected.'));
      }

      const t1 = this.getHighResTime();

      // Timeout safety (2 seconds)
      const timer = setTimeout(() => {
        reject(new Error('SYNC_REQUEST timed out.'));
      }, 2000);

      socket.emit('SYNC_REQUEST', { t1 }, (response) => {
        clearTimeout(timer);
        const t4 = this.getHighResTime();

        if (!response || response.t1 === undefined || response.t2 === undefined || response.t3 === undefined) {
          return reject(new Error('Invalid SYNC_REQUEST response payload.'));
        }

        const t2 = response.t2;
        const t3 = response.t3;

        // RTT = (t4 - t1) - (t3 - t2)
        const rtt = Math.max(0, (t4 - t1) - (t3 - t2));
        // Offset = ((t2 - t1) + (t3 - t4)) / 2
        const offset = ((t2 - t1) + (t3 - t4)) / 2;

        resolve({ t1, t2, t3, t4, rtt, offset });
      });
    });
  }

  /**
   * Collects multiple timing samples and selects the lowest-RTT sample.
   */
  async synchronize(socket, sampleCount = 5) {
    if (!socket || !socket.connected) return false;

    const samples = [];
    for (let i = 0; i < sampleCount; i++) {
      try {
        const sample = await this.syncOnce(socket);
        // Reject samples with unusually high RTT (> 300ms)
        if (sample.rtt <= 300) {
          samples.push(sample);
        }
      } catch (err) {
        // Continue attempting remaining samples
      }
    }

    if (samples.length === 0) {
      console.warn('[ClockSync] All timing samples failed or exceeded RTT threshold.');
      return false;
    }

    // Sort samples by RTT ascending and pick the lowest-RTT sample
    samples.sort((a, b) => a.rtt - b.rtt);
    const bestSample = samples[0];

    this.offset = bestSample.offset;
    this.rtt = bestSample.rtt;
    this.isSynced = true;
    this.lastSyncTime = Date.now();

    console.log(`[ClockSync] Synced. Offset: ${this.offset >= 0 ? '+' : ''}${this.offset.toFixed(2)}ms, RTT: ${this.rtt.toFixed(2)}ms (Selected from ${samples.length} valid samples)`);

    if (typeof this.onSyncUpdateCallback === 'function') {
      this.onSyncUpdateCallback({
        offset: this.offset,
        rtt: this.rtt,
        isSynced: this.isSynced
      });
    }

    return true;
  }

  /**
   * Starts periodic resynchronization at specified interval.
   */
  startAutoSync(socket, intervalMs = 15000) {
    this.stopAutoSync();
    if (!socket) return;

    // Run initial sync burst
    this.synchronize(socket).catch(() => {});

    // Schedule periodic refresh
    this.autoSyncTimer = setInterval(() => {
      if (socket.connected) {
        this.synchronize(socket).catch(() => {});
      }
    }, intervalMs);
  }

  /**
   * Stops periodic resynchronization timer.
   */
  stopAutoSync() {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
  }

  /**
   * Returns current estimated server time in milliseconds.
   */
  getServerTime() {
    return this.getHighResTime() + this.offset;
  }

  /**
   * Maps target server time (ms) to local AudioContext.currentTime (seconds).
   */
  toAudioContextTime(serverTimeMs, audioCtx) {
    if (!audioCtx) return 0;
    const deltaMs = serverTimeMs - this.getServerTime();
    return audioCtx.currentTime + (deltaMs / 1000);
  }

  getClockOffset() {
    return this.offset;
  }

  getRoundTripTime() {
    return this.rtt;
  }

  getSyncStats() {
    return {
      offset: this.offset,
      rtt: this.rtt,
      isSynced: this.isSynced,
      lastSyncTime: this.lastSyncTime
    };
  }

  setOnSyncUpdate(callback) {
    this.onSyncUpdateCallback = callback;
  }
}

export const clockSync = new ClockSync();
