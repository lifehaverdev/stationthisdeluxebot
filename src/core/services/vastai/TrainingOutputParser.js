/**
 * TrainingOutputParser - Extract progress information from training logs
 *
 * PURPOSE:
 *   Parse raw training output to extract structured progress data. Different
 *   training frameworks (ai-toolkit, Kohya, diffusers) have different log formats.
 *   This parser uses regex patterns to handle the common cases.
 *
 * USAGE:
 *   const parser = new TrainingOutputParser();
 *   const result = parser.parse(outputString);
 *   // result.lastStep, result.totalSteps, result.lastLoss, etc.
 *
 * PARSED DATA:
 *   - lastStep: Most recent training step number
 *   - totalSteps: Total steps configured (if found)
 *   - progressPercent: Calculated progress percentage
 *   - lastLoss: Most recent loss value
 *   - lossHistory: Array of {step, loss} entries
 *   - lastLearningRate: Most recent learning rate
 *   - checkpointsSaved: Count of checkpoint save events
 *   - checkpointPaths: Paths of saved checkpoints
 *   - errors: Array of error messages found
 *   - warnings: Array of warning messages found
 *   - gpuUtilization: GPU usage if reported
 *   - memoryUsage: Memory stats if reported
 *   - samplesGenerated: Count of sample image generations
 *   - stepsPerSecond: Training speed if calculable
 *   - estimatedTimeRemaining: ETA in seconds if calculable
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SUPPORTED PATTERNS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * AI-TOOLKIT (Ostris):
 *   step 123/2000 | loss: 0.1234 | lr: 2e-4 | ...
 *   Saving checkpoint at step 1000
 *
 * KOHYA SS:
 *   steps: 123, loss: 0.1234
 *   epoch 1/10, step 123/2000
 *   saving checkpoint: output/model-000123.safetensors
 *
 * DIFFUSERS:
 *   Step: 123, Loss: 0.1234
 *   Iteration 123: loss=0.1234
 *
 * TQDM PROGRESS BARS:
 *   123/2000 [00:30<01:00, 3.21it/s, loss=0.1234]
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ADDING NEW PATTERNS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * To add support for a new training framework:
 * 1. Add regex patterns to the appropriate arrays (STEP_PATTERNS, LOSS_PATTERNS, etc.)
 * 2. Each pattern should use named capture groups where possible
 * 3. Test with sample output from the framework
 * 4. Patterns are tried in order; more specific patterns should come first
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// PATTERN DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

// Step progress patterns
const STEP_PATTERNS = [
  // ai-toolkit: "step 123/2000"
  /step\s*(\d+)\s*\/\s*(\d+)/gi,

  // ai-toolkit tqdm: "test_run:  52%|█████▏    | 103/200 [" (with pipe separator before step)
  /\|\s*(\d+)\s*\/\s*(\d+)\s*\[/gm,

  // Kohya: "steps: 123" or "step 123"
  /steps?[:\s]+(\d+)/gi,

  // diffusers: "Step: 123" or "Iteration 123"
  /(?:step|iteration)[:\s]+(\d+)/gi,

  // tqdm: "123/2000 [" at start of line
  /^\s*(\d+)\s*\/\s*(\d+)\s*\[/gm,

  // Generic: any "N/M" that looks like progress
  /\b(\d+)\s*\/\s*(\d+)\s*(?:steps?|iter)/gi
];

// Loss value patterns
const LOSS_PATTERNS = [
  // Standard: "loss: 0.1234" or "loss=0.1234"
  /\bloss[:\s=]+([0-9.e+-]+)/gi,

  // Train loss: "train_loss: 0.1234"
  /\btrain_loss[:\s=]+([0-9.e+-]+)/gi,

  // With prefix: "avg_loss=0.1234"
  /\b(?:avg_|mean_)?loss[:\s=]+([0-9.e+-]+)/gi,

  // tqdm style: "loss=0.1234"
  /\bloss=([0-9.e+-]+)/gi
];

// Learning rate patterns
const LR_PATTERNS = [
  // Standard: "lr: 2e-4" or "lr=0.0002"
  /\blr[:\s=]+([0-9.e+-]+)/gi,

  // Full name: "learning_rate: 0.0002"
  /\blearning_rate[:\s=]+([0-9.e+-]+)/gi
];

// Checkpoint save patterns
const CHECKPOINT_PATTERNS = [
  // ai-toolkit: "Saving checkpoint at step 1000"
  /saving\s+checkpoint(?:\s+at\s+step\s+(\d+))?/gi,

  // Kohya: "saving checkpoint: path/to/file.safetensors"
  /saving\s+checkpoint[:\s]+(.+\.safetensors)/gi,

  // Generic: "Saved model to path"
  /saved?\s+(?:model|checkpoint)\s+(?:to\s+)?([^\s]+\.safetensors)/gi,

  // "checkpoint saved" variations
  /checkpoint\s+saved/gi,

  // "Writing to file.safetensors"
  /writing\s+(?:to\s+)?([^\s]+\.safetensors)/gi
];

// Error patterns
const ERROR_PATTERNS = [
  // Python exceptions
  /(?:error|exception|traceback):\s*(.+)/gi,

  // CUDA errors
  /cuda\s+(?:error|out of memory)(.+)?/gi,

  // Runtime errors
  /runtimeerror:\s*(.+)/gi,

  // OOM
  /out\s+of\s+memory/gi,

  // NaN detection
  /(?:loss|gradient)\s+(?:is\s+)?nan/gi,

  // General error lines
  /^.*error.*$/gim
];

// Warning patterns
const WARNING_PATTERNS = [
  /warning:\s*(.+)/gi,
  /\bwarn\b:\s*(.+)/gi,
  /deprecat(?:ed|ion)/gi
];

// GPU utilization patterns
const GPU_PATTERNS = [
  // nvidia-smi style: "GPU-Util: 98%"
  /gpu[_-]?util(?:ization)?[:\s=]+(\d+)%?/gi,

  // Memory: "Memory: 20.5GB/24GB"
  /(?:gpu\s+)?memory[:\s=]+([0-9.]+)\s*(?:gb|mb)?\s*\/\s*([0-9.]+)\s*(?:gb|mb)?/gi,

  // VRAM: "VRAM: 20480MB"
  /vram[:\s=]+([0-9.]+)\s*(?:gb|mb)/gi
];

// Speed patterns (iterations per second)
// Note: Some patterns return it/s directly, others need conversion from s/it
const SPEED_PATTERNS = [
  // tqdm: "3.21it/s"
  { pattern: /([0-9.]+)\s*it\/s/gi, isSecondsPerIter: false },

  // ai-toolkit tqdm: "2.36s/it" (seconds per iteration - needs conversion)
  { pattern: /([0-9.]+)\s*s\/it/gi, isSecondsPerIter: true },

  // "steps/sec: 1.5"
  { pattern: /steps?\/(?:sec|second)[:\s=]+([0-9.]+)/gi, isSecondsPerIter: false },

  // "1.5 steps/s"
  { pattern: /([0-9.]+)\s*steps?\/s/gi, isSecondsPerIter: false }
];

// Non-training line patterns (model loading, downloading, etc.)
// Lines matching these are filtered out before step regex matching
// to prevent model-loading tqdm bars from being misidentified as training progress.
const NON_TRAINING_LINE_PATTERNS = [
  /loading\s+checkpoint\s+shards/i,
  /downloading/i,
  /fetching\s+\d+\s+files/i,
  /loading\s+safetensors/i,
  /loading\s+(?:T5|CLIP|VAE|UNet|text\s+encoder|transformer)/i,
  /quantizing/i,
  /making\s+pip/i,
  /tokenizer/i,
  /resolving\s+data\s+files/i,
  /^map:/i,
];

// Sample generation patterns
const SAMPLE_PATTERNS = [
  /generating\s+sample/gi,
  /sample\s+generated/gi,
  /saving\s+sample\s+image/gi,
  /validation\s+image/gi,
  // ai-toolkit: "Generating Images: 100%|██████████| 10/10"
  /generating\s+images.*100%/gi,
  // ai-toolkit baseline samples
  /generating\s+baseline\s+samples/gi
];

class TrainingOutputParser {
  constructor({ logger } = {}) {
    this.logger = logger;
  }

  /**
   * Parse training output and extract structured progress data
   *
   * @param {string} output - Raw training output (stdout/stderr)
   * @returns {ParsedTrainingOutput}
   */
  parse(output) {
    if (!output || typeof output !== 'string') {
      return this._emptyResult();
    }

    const result = this._emptyResult();

    // Parse each category
    this._parseSteps(output, result);
    this._parseLoss(output, result);
    this._parseLearningRate(output, result);
    this._parseCheckpoints(output, result);
    this._parseErrors(output, result);
    this._parseWarnings(output, result);
    this._parseGpu(output, result);
    this._parseSpeed(output, result);
    this._parseSamples(output, result);

    // Calculate derived values
    this._calculateDerived(result);

    return result;
  }

  /**
   * Parse incremental output and merge with existing state
   *
   * @param {string} newOutput - New output since last parse
   * @param {ParsedTrainingOutput} existingState - Previous parsed state
   * @returns {ParsedTrainingOutput}
   */
  parseIncremental(newOutput, existingState) {
    const newParsed = this.parse(newOutput);

    // Merge with existing state
    return {
      ...existingState,
      lastStep: newParsed.lastStep ?? existingState.lastStep,
      totalSteps: newParsed.totalSteps ?? existingState.totalSteps,
      lastLoss: newParsed.lastLoss ?? existingState.lastLoss,
      lossHistory: [...existingState.lossHistory, ...newParsed.lossHistory],
      lastLearningRate: newParsed.lastLearningRate ?? existingState.lastLearningRate,
      checkpointsSaved: existingState.checkpointsSaved + newParsed.checkpointsSaved,
      checkpointPaths: [...existingState.checkpointPaths, ...newParsed.checkpointPaths],
      errors: [...existingState.errors, ...newParsed.errors],
      warnings: [...existingState.warnings, ...newParsed.warnings],
      gpuUtilization: newParsed.gpuUtilization ?? existingState.gpuUtilization,
      memoryUsage: newParsed.memoryUsage ?? existingState.memoryUsage,
      samplesGenerated: existingState.samplesGenerated + newParsed.samplesGenerated,
      stepsPerSecond: newParsed.stepsPerSecond ?? existingState.stepsPerSecond,
      progressPercent: newParsed.progressPercent ?? existingState.progressPercent,
      estimatedTimeRemaining: newParsed.estimatedTimeRemaining ?? existingState.estimatedTimeRemaining
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE PARSING METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  _emptyResult() {
    return {
      lastStep: null,
      totalSteps: null,
      progressPercent: null,
      lastLoss: null,
      lossHistory: [],
      lastLearningRate: null,
      checkpointsSaved: 0,
      checkpointPaths: [],
      errors: [],
      warnings: [],
      gpuUtilization: null,
      memoryUsage: null,
      samplesGenerated: 0,
      stepsPerSecond: null,
      estimatedTimeRemaining: null
    };
  }

  _filterTrainingLines(output) {
    return output
      .split('\n')
      .filter(line => !NON_TRAINING_LINE_PATTERNS.some(pat => pat.test(line)))
      .join('\n');
  }

  _parseSteps(output, result) {
    // Filter out non-training lines (model loading tqdm bars, downloads, etc.)
    // to prevent misidentifying them as training step progress.
    const filtered = this._filterTrainingLines(output);

    let maxStep = null;
    let totalSteps = null;

    for (const pattern of STEP_PATTERNS) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;
      let match;

      while ((match = pattern.exec(filtered)) !== null) {
        const currentStep = parseInt(match[1], 10);
        const total = match[2] ? parseInt(match[2], 10) : null;

        if (!Number.isNaN(currentStep) && (maxStep === null || currentStep > maxStep)) {
          maxStep = currentStep;
        }
        if (total && !Number.isNaN(total) && (totalSteps === null || total > totalSteps)) {
          totalSteps = total;
        }
      }
    }

    result.lastStep = maxStep;
    result.totalSteps = totalSteps;
  }

  _parseLoss(output, result) {
    const lossValues = [];

    for (const pattern of LOSS_PATTERNS) {
      pattern.lastIndex = 0;
      let match;

      while ((match = pattern.exec(output)) !== null) {
        const loss = parseFloat(match[1]);
        if (!Number.isNaN(loss) && Number.isFinite(loss)) {
          lossValues.push(loss);
        }
      }
    }

    if (lossValues.length > 0) {
      result.lastLoss = lossValues[lossValues.length - 1];

      // Build loss history (sample every 10th value to avoid huge arrays)
      const step = Math.max(1, Math.floor(lossValues.length / 100));
      for (let i = 0; i < lossValues.length; i += step) {
        result.lossHistory.push({
          index: i,
          loss: lossValues[i]
        });
      }
      // Always include the last value
      if (lossValues.length > 0 && result.lossHistory.length > 0) {
        const lastEntry = result.lossHistory[result.lossHistory.length - 1];
        if (lastEntry.index !== lossValues.length - 1) {
          result.lossHistory.push({
            index: lossValues.length - 1,
            loss: lossValues[lossValues.length - 1]
          });
        }
      }
    }
  }

  _parseLearningRate(output, result) {
    for (const pattern of LR_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      let lastLr = null;

      while ((match = pattern.exec(output)) !== null) {
        const lr = parseFloat(match[1]);
        if (!Number.isNaN(lr) && Number.isFinite(lr)) {
          lastLr = lr;
        }
      }

      if (lastLr !== null) {
        result.lastLearningRate = lastLr;
        break;
      }
    }
  }

  _parseCheckpoints(output, result) {
    const paths = new Set();
    let count = 0;

    for (const pattern of CHECKPOINT_PATTERNS) {
      pattern.lastIndex = 0;
      let match;

      while ((match = pattern.exec(output)) !== null) {
        count++;
        // If pattern captured a path
        if (match[1] && match[1].includes('.safetensors')) {
          paths.add(match[1].trim());
        }
      }
    }

    result.checkpointsSaved = count;
    result.checkpointPaths = Array.from(paths);
  }

  _parseErrors(output, result) {
    const errors = new Set();

    for (const pattern of ERROR_PATTERNS) {
      pattern.lastIndex = 0;
      let match;

      while ((match = pattern.exec(output)) !== null) {
        const errorMsg = match[0].trim().substring(0, 200);
        errors.add(errorMsg);
      }
    }

    result.errors = Array.from(errors);
  }

  _parseWarnings(output, result) {
    const warnings = new Set();

    for (const pattern of WARNING_PATTERNS) {
      pattern.lastIndex = 0;
      let match;

      while ((match = pattern.exec(output)) !== null) {
        const warnMsg = match[0].trim().substring(0, 200);
        warnings.add(warnMsg);
      }
    }

    result.warnings = Array.from(warnings);
  }

  _parseGpu(output, result) {
    for (const pattern of GPU_PATTERNS) {
      pattern.lastIndex = 0;
      let match;

      while ((match = pattern.exec(output)) !== null) {
        if (match[2]) {
          // Memory pattern with used/total
          result.memoryUsage = {
            used: parseFloat(match[1]),
            total: parseFloat(match[2])
          };
        } else {
          // Utilization percentage
          const util = parseInt(match[1], 10);
          if (!Number.isNaN(util)) {
            result.gpuUtilization = util;
          }
        }
      }
    }
  }

  _parseSpeed(output, result) {
    for (const { pattern, isSecondsPerIter } of SPEED_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      let lastSpeed = null;

      while ((match = pattern.exec(output)) !== null) {
        let speed = parseFloat(match[1]);
        if (!Number.isNaN(speed) && Number.isFinite(speed) && speed > 0) {
          // Convert seconds/iteration to iterations/second if needed
          if (isSecondsPerIter) {
            speed = 1 / speed;
          }
          lastSpeed = speed;
        }
      }

      if (lastSpeed !== null) {
        result.stepsPerSecond = lastSpeed;
        break;
      }
    }
  }

  _parseSamples(output, result) {
    let count = 0;

    for (const pattern of SAMPLE_PATTERNS) {
      pattern.lastIndex = 0;
      let match;

      while ((match = pattern.exec(output)) !== null) {
        count++;
      }
    }

    result.samplesGenerated = count;
  }

  _calculateDerived(result) {
    // Calculate progress percentage
    if (result.lastStep !== null && result.totalSteps !== null && result.totalSteps > 0) {
      result.progressPercent = Math.min(100, (result.lastStep / result.totalSteps) * 100);
    }

    // Calculate ETA
    if (result.stepsPerSecond !== null && result.stepsPerSecond > 0) {
      if (result.lastStep !== null && result.totalSteps !== null) {
        const remainingSteps = result.totalSteps - result.lastStep;
        if (remainingSteps > 0) {
          result.estimatedTimeRemaining = Math.round(remainingSteps / result.stepsPerSecond);
        }
      }
    }
  }
}

module.exports = TrainingOutputParser;
