/**
 * StallDetector - Detect asymptotic training stalls via ETA trend analysis
 *
 * PURPOSE:
 *   Detect when training is slowing down progressively - when ETA stops
 *   converging despite steps completing. This catches the case where
 *   step 3500/4000 says "2 hours remaining" but step 3000 also said "2 hours".
 *
 * USAGE:
 *   const detector = new StallDetector({ gracePeriod: 15 * 60 * 1000 });
 *   detector.recordSample({ step: 3000, eta: 7200, stepsPerSecond: 1.5 });
 *   // ... more samples over time ...
 *   const analysis = detector.analyze();
 *   if (analysis.isStalling) { ... }
 *
 * DETECTION LOGIC:
 *   1. Track ETA over time as training progresses
 *   2. Healthy training: ETA decreases roughly 1:1 with elapsed wall-clock time
 *   3. Stalling training: ETA stays flat or increases despite step progress
 *   4. Also track steps/second - consistent speed drop reinforces diagnosis
 */

class StallDetector {
  constructor({
    minSamples = 4,
    etaConvergenceThreshold = 0.5,
    speedDropThreshold = 0.5,
    gracePeriod = 15 * 60 * 1000, // 15 minutes default
    logger
  } = {}) {
    this.config = {
      minSamples,
      etaConvergenceThreshold,
      speedDropThreshold,
      gracePeriod
    };
    this.logger = logger || console;

    // Sample history
    this.samples = [];
    this.peakSpeed = null;

    // Stall state
    this.stallDetectedAt = null;
    this.stallNotifiedAt = null;
  }

  /**
   * Record a new sample from training progress
   *
   * @param {object} sample
   * @param {number} sample.step - Current training step
   * @param {number} sample.totalSteps - Total steps (optional, for context)
   * @param {number} sample.eta - Estimated time remaining in seconds
   * @param {number} sample.stepsPerSecond - Current training speed
   */
  recordSample({ step, totalSteps = null, eta, stepsPerSecond }) {
    const timestamp = Date.now();

    // Track peak speed
    if (stepsPerSecond !== null && stepsPerSecond !== undefined) {
      if (this.peakSpeed === null || stepsPerSecond > this.peakSpeed) {
        this.peakSpeed = stepsPerSecond;
      }
    }

    this.samples.push({
      timestamp,
      step,
      totalSteps,
      eta,
      stepsPerSecond
    });

    // Keep last 20 samples to avoid unbounded growth
    if (this.samples.length > 20) {
      this.samples.shift();
    }
  }

  /**
   * Analyze samples to detect stalling behavior
   *
   * @returns {StallAnalysis}
   */
  analyze() {
    const result = {
      isStalling: false,
      confidence: 'none',
      reason: null,
      recommendation: 'continue',
      stallDetectedAt: this.stallDetectedAt,
      gracePeriodExpired: false,
      gracePeriodRemaining: null,
      currentStep: null,
      totalSteps: null,
      signals: {
        etaNotConverging: false,
        speedDropping: false
      }
    };

    // Need minimum samples for analysis
    if (this.samples.length < this.config.minSamples) {
      result.reason = `Insufficient samples (${this.samples.length}/${this.config.minSamples})`;
      return result;
    }

    const latest = this.samples[this.samples.length - 1];
    result.currentStep = latest.step;
    result.totalSteps = latest.totalSteps;

    // Check ETA convergence
    const etaAnalysis = this._analyzeEtaConvergence();
    result.signals.etaNotConverging = etaAnalysis.notConverging;

    // Check speed drop
    const speedAnalysis = this._analyzeSpeedDrop();
    result.signals.speedDropping = speedAnalysis.dropping;

    // Determine stall status
    if (etaAnalysis.notConverging && speedAnalysis.dropping) {
      result.isStalling = true;
      result.confidence = 'high';
      result.reason = `${etaAnalysis.reason}; ${speedAnalysis.reason}`;
    } else if (etaAnalysis.notConverging) {
      result.isStalling = true;
      result.confidence = 'medium';
      result.reason = etaAnalysis.reason;
    } else if (speedAnalysis.dropping) {
      // Speed drop alone is just a warning, not a stall
      result.confidence = 'low';
      result.reason = speedAnalysis.reason;
    }

    // Track stall timing
    if (result.isStalling) {
      if (!this.stallDetectedAt) {
        this.stallDetectedAt = Date.now();
        this.logger.warn(`[StallDetector] Stall detected: ${result.reason}`);
      }
      result.stallDetectedAt = this.stallDetectedAt;

      // Check grace period
      const elapsed = Date.now() - this.stallDetectedAt;
      result.gracePeriodRemaining = Math.max(0, this.config.gracePeriod - elapsed);
      result.gracePeriodExpired = elapsed >= this.config.gracePeriod;

      if (result.gracePeriodExpired) {
        result.recommendation = 'terminate';
      } else {
        result.recommendation = 'alert';
      }
    } else {
      // Clear stall state if training recovered
      if (this.stallDetectedAt) {
        this.logger.info('[StallDetector] Training recovered from stall');
        this.stallDetectedAt = null;
        this.stallNotifiedAt = null;
      }
    }

    return result;
  }

  /**
   * Check if user has been notified about current stall
   */
  hasNotified() {
    return this.stallNotifiedAt !== null;
  }

  /**
   * Mark that user has been notified
   */
  markNotified() {
    this.stallNotifiedAt = Date.now();
  }

  /**
   * Reset detector state (e.g., for a new job)
   */
  reset() {
    this.samples = [];
    this.peakSpeed = null;
    this.stallDetectedAt = null;
    this.stallNotifiedAt = null;
  }

  /**
   * Get current state summary for logging/debugging
   */
  getState() {
    const latest = this.samples[this.samples.length - 1];
    return {
      sampleCount: this.samples.length,
      peakSpeed: this.peakSpeed,
      currentSpeed: latest?.stepsPerSecond ?? null,
      currentEta: latest?.eta ?? null,
      stallDetectedAt: this.stallDetectedAt,
      stallNotifiedAt: this.stallNotifiedAt
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE ANALYSIS METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Analyze whether ETA is converging (decreasing) over time
   *
   * Healthy: ETA should decrease roughly 1:1 with elapsed wall-clock time
   * Stalling: ETA stays flat or increases despite time passing
   */
  _analyzeEtaConvergence() {
    const result = { notConverging: false, reason: null };

    // Get samples with valid ETA
    const withEta = this.samples.filter(s => s.eta !== null && s.eta !== undefined);
    if (withEta.length < 3) {
      return result;
    }

    // Compare oldest vs newest in our window
    const older = withEta[0];
    const newer = withEta[withEta.length - 1];

    const elapsedMs = newer.timestamp - older.timestamp;
    const elapsedSec = elapsedMs / 1000;

    // How much did ETA decrease?
    const etaDecrease = older.eta - newer.eta;

    // How much SHOULD it have decreased? (roughly equal to elapsed time for healthy training)
    const expectedDecrease = elapsedSec;

    // If ETA decreased by less than threshold of expected, it's not converging
    const convergenceRatio = expectedDecrease > 0 ? etaDecrease / expectedDecrease : 1;

    if (convergenceRatio < this.config.etaConvergenceThreshold) {
      result.notConverging = true;

      // Format for human readability
      const etaChangeStr = etaDecrease >= 0
        ? `decreased by ${this._formatDuration(etaDecrease)}`
        : `increased by ${this._formatDuration(-etaDecrease)}`;

      result.reason = `ETA not converging: ${etaChangeStr} over ${this._formatDuration(elapsedSec)} ` +
        `(expected ~${this._formatDuration(expectedDecrease)} decrease)`;
    }

    return result;
  }

  /**
   * Analyze whether training speed is dropping significantly
   */
  _analyzeSpeedDrop() {
    const result = { dropping: false, reason: null };

    if (this.peakSpeed === null) {
      return result;
    }

    // Get recent speed samples
    const withSpeed = this.samples.filter(s => s.stepsPerSecond !== null && s.stepsPerSecond !== undefined);
    if (withSpeed.length < 2) {
      return result;
    }

    const latest = withSpeed[withSpeed.length - 1];
    const dropRatio = latest.stepsPerSecond / this.peakSpeed;

    if (dropRatio < (1 - this.config.speedDropThreshold)) {
      result.dropping = true;
      result.reason = `Speed dropped ${((1 - dropRatio) * 100).toFixed(0)}% from peak ` +
        `(${this.peakSpeed.toFixed(2)} → ${latest.stepsPerSecond.toFixed(2)} steps/sec)`;
    }

    return result;
  }

  _formatDuration(seconds) {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return `${hours}h${mins}m`;
  }
}

module.exports = StallDetector;
