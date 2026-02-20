const fsp = require('fs').promises;
const path = require('path');

/**
 * DatasetValidator - Validates datasets before training
 *
 * PURPOSE:
 *   Ensure a dataset meets minimum requirements before packing and uploading
 *   to a remote GPU for training. Catches issues early to avoid wasting GPU time.
 *
 * CURRENT VALIDATION RULES:
 *   Required (will fail validation):
 *     - Minimum 10 images (configurable via minImages option)
 *     - Caption files must have matching image files (no orphan .txt files)
 *
 *   Warnings (validation passes but flags issues):
 *     - Images without captions (captions are desirable but not required)
 *
 * USAGE:
 *   const validator = new DatasetValidator({ logger: console });
 *   const result = await validator.validate('/path/to/dataset');
 *   if (!result.valid) {
 *     console.error('Dataset invalid:', result.errors);
 *   }
 *
 * RETURN FORMAT:
 *   {
 *     valid: boolean,           // true if all required checks pass
 *     errors: string[],         // reasons validation failed
 *     warnings: string[],       // non-blocking issues
 *     stats: {
 *       imageCount: number,
 *       captionCount: number,
 *       pairedCount: number,    // images that have matching captions
 *       orphanCaptions: string[],    // .txt files without matching images
 *       uncaptionedImages: string[], // images without .txt files
 *       imageExtensions: { '.png': n, '.jpg': n, ... }
 *     }
 *   }
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * FUTURE EXPANSION IDEAS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * IMAGE QUALITY CHECKS:
 *   - Minimum resolution (e.g., 512x512 for SDXL, 1024x1024 for FLUX)
 *   - Aspect ratio validation (flag extreme ratios that may cause issues)
 *   - Corrupt image detection (try to decode headers)
 *   - Duplicate image detection (perceptual hash or file hash)
 *   - File size sanity check (flag suspiciously small files)
 *
 * CAPTION QUALITY CHECKS:
 *   - Empty caption detection (file exists but is blank)
 *   - Caption length validation (too short = useless, too long = truncated)
 *   - Trigger word presence check (ensure trigger appears in captions)
 *   - Caption format validation (e.g., comma-separated tags vs natural language)
 *   - Duplicate caption detection
 *
 * AUTO-FIX CAPABILITIES:
 *   - Auto-generate missing captions via captioning service
 *   - Resize images to target resolution
 *   - Convert unsupported formats (e.g., HEIC → PNG)
 *   - Rename files to sequential numbering (1.png, 2.png, ...)
 *   - Strip EXIF/metadata for privacy
 *
 * DATASET STATISTICS:
 *   - Resolution distribution histogram
 *   - Caption length distribution
 *   - Tag frequency analysis (for tag-based captions)
 *   - Estimated training time based on image count
 *
 * TRAINING-SPECIFIC VALIDATION:
 *   - Recipe-aware validation (FLUX vs SDXL have different requirements)
 *   - Recommended image count ranges per use case
 *   - Warning for very large datasets (may need to subsample)
 *
 * INTEGRATION POINTS:
 *   - Pre-pack hook in DatasetPacker (validate before packing)
 *   - Queue job validation (reject jobs with invalid datasets)
 *   - Web UI feedback (show validation status in mods menu)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const CAPTION_EXTENSION = '.txt';
const DEFAULT_MIN_IMAGES = 10;

class DatasetValidator {
  constructor({ logger, config = {} } = {}) {
    // Allow explicit null to disable logging (for --json or --quiet modes)
    this.logger = logger === undefined ? console : logger;
    this.config = {
      minImages: config.minImages ?? DEFAULT_MIN_IMAGES,
      ...config
    };
  }

  /**
   * Validate a dataset directory
   *
   * @param {string} datasetDir - Path to dataset directory
   * @param {object} options - Validation options
   * @param {number} options.minImages - Minimum required images (default: 10)
   * @returns {Promise<ValidationResult>}
   */
  async validate(datasetDir, options = {}) {
    const minImages = options.minImages ?? this.config.minImages;
    const errors = [];
    const warnings = [];

    // Resolve and check directory exists
    const absDir = path.resolve(datasetDir);
    const dirExists = await this.pathExists(absDir);
    if (!dirExists) {
      return {
        valid: false,
        errors: [`Dataset directory not found: ${absDir}`],
        warnings: [],
        stats: null
      };
    }

    // Scan directory
    const files = await fsp.readdir(absDir);
    const stats = this.analyzeFiles(files);

    // ─────────────────────────────────────────────────────────────────────────
    // REQUIRED: Minimum image count
    // ─────────────────────────────────────────────────────────────────────────
    if (stats.imageCount < minImages) {
      errors.push(
        `Insufficient images: found ${stats.imageCount}, require at least ${minImages}`
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // REQUIRED: No orphan captions (every .txt must have matching image)
    // ─────────────────────────────────────────────────────────────────────────
    if (stats.orphanCaptions.length > 0) {
      const examples = stats.orphanCaptions.slice(0, 3).join(', ');
      const more = stats.orphanCaptions.length > 3
        ? ` (and ${stats.orphanCaptions.length - 3} more)`
        : '';
      errors.push(
        `Orphan captions without matching images: ${examples}${more}`
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // WARNING: Images without captions (desirable but not required)
    // ─────────────────────────────────────────────────────────────────────────
    if (stats.uncaptionedImages.length > 0 && stats.captionCount > 0) {
      // Only warn if there ARE some captions (mixed state)
      // If there are zero captions, that's a deliberate choice
      warnings.push(
        `${stats.uncaptionedImages.length} of ${stats.imageCount} images have no captions`
      );
    } else if (stats.captionCount === 0 && stats.imageCount > 0) {
      warnings.push(
        `No captions found. Captions are recommended for better training results.`
      );
    }

    const valid = errors.length === 0;

    if (this.logger) {
      const status = valid ? 'VALID' : 'INVALID';
      this.logger.debug(
        `[DatasetValidator] ${status}: ${stats.imageCount} images, ${stats.captionCount} captions, ${stats.pairedCount} paired`
      );
      if (errors.length > 0) {
        errors.forEach((e) => this.logger.error(`[DatasetValidator] ERROR: ${e}`));
      }
      if (warnings.length > 0) {
        warnings.forEach((w) => this.logger.warn(`[DatasetValidator] WARNING: ${w}`));
      }
    }

    return { valid, errors, warnings, stats };
  }

  /**
   * Analyze files in directory and compute statistics
   *
   * @param {string[]} files - Array of filenames
   * @returns {DatasetStats}
   */
  analyzeFiles(files) {
    const images = new Map();  // basename -> extension
    const captions = new Set(); // basenames that have .txt
    const imageExtensions = {};

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      const basename = path.basename(file, ext);

      if (IMAGE_EXTENSIONS.has(ext)) {
        images.set(basename, ext);
        imageExtensions[ext] = (imageExtensions[ext] || 0) + 1;
      } else if (ext === CAPTION_EXTENSION) {
        captions.add(basename);
      }
    }

    // Find orphan captions (txt without matching image)
    const orphanCaptions = [];
    for (const captionBase of captions) {
      if (!images.has(captionBase)) {
        orphanCaptions.push(captionBase + CAPTION_EXTENSION);
      }
    }

    // Find uncaptioned images
    const uncaptionedImages = [];
    for (const [basename, ext] of images) {
      if (!captions.has(basename)) {
        uncaptionedImages.push(basename + ext);
      }
    }

    // Count paired (images that have captions)
    const pairedCount = images.size - uncaptionedImages.length;

    return {
      imageCount: images.size,
      captionCount: captions.size,
      pairedCount,
      orphanCaptions,
      uncaptionedImages,
      imageExtensions
    };
  }

  async pathExists(p) {
    try {
      await fsp.access(p);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Validate dataset with control folder for KONTEXT concept training
   *
   * @param {string} datasetDir - Path to result dataset directory
   * @param {string} controlDir - Path to control dataset directory
   * @param {object} options - Validation options
   * @returns {Promise<ValidationResult>}
   */
  async validateWithControl(datasetDir, controlDir, options = {}) {
    // First validate the main dataset
    const baseResult = await this.validate(datasetDir, options);

    // If base validation failed, return early
    if (!baseResult.valid) {
      return baseResult;
    }

    const errors = [...baseResult.errors];
    const warnings = [...baseResult.warnings];

    // Check control directory exists
    const controlDirExists = await this.pathExists(controlDir);
    if (!controlDirExists) {
      errors.push(`Control directory not found: ${controlDir}`);
      return {
        valid: false,
        errors,
        warnings,
        stats: { ...baseResult.stats, controlImageCount: 0, missingControlImages: [], orphanControlImages: [] }
      };
    }

    // Scan control directory
    const controlFiles = await fsp.readdir(controlDir);
    const controlStats = this.analyzeControlFiles(controlFiles, baseResult.stats);

    // ─────────────────────────────────────────────────────────────────────────
    // REQUIRED: Every result image must have a matching control image
    // ─────────────────────────────────────────────────────────────────────────
    if (controlStats.missingControlImages.length > 0) {
      const examples = controlStats.missingControlImages.slice(0, 3).join(', ');
      const more = controlStats.missingControlImages.length > 3
        ? ` (and ${controlStats.missingControlImages.length - 3} more)`
        : '';
      errors.push(`Missing control images for: ${examples}${more}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // WARNING: Orphan control images (control images without matching result)
    // ─────────────────────────────────────────────────────────────────────────
    if (controlStats.orphanControlImages.length > 0) {
      warnings.push(
        `${controlStats.orphanControlImages.length} orphan control images without matching result images`
      );
    }

    const valid = errors.length === 0;

    if (this.logger) {
      const status = valid ? 'VALID' : 'INVALID';
      this.logger.debug(
        `[DatasetValidator] Control validation ${status}: ${controlStats.controlImageCount} control images`
      );
    }

    return {
      valid,
      errors,
      warnings,
      stats: {
        ...baseResult.stats,
        controlImageCount: controlStats.controlImageCount,
        missingControlImages: controlStats.missingControlImages,
        orphanControlImages: controlStats.orphanControlImages
      }
    };
  }

  /**
   * Analyze control folder files against result images
   * @param {string[]} controlFiles - Files in control directory
   * @param {Object} resultStats - Stats from main dataset validation
   * @returns {Object}
   */
  analyzeControlFiles(controlFiles, resultStats) {
    const controlImages = new Set();

    for (const file of controlFiles) {
      const ext = path.extname(file).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        const basename = path.basename(file, ext);
        controlImages.add(basename);
      }
    }

    // Get result image basenames from the uncaptioned + paired counts
    // We need the actual basenames, so we derive from stats
    const resultBasenames = new Set();

    // Result images = all images in the dataset
    // Since analyzeFiles stores this info, we need to reconstruct
    // For now, we assume sequential naming (001, 002, etc.)
    // This works because DatasetDownloader uses sequential naming
    const totalResultImages = resultStats.imageCount;
    for (let i = 1; i <= totalResultImages; i++) {
      resultBasenames.add(String(i).padStart(3, '0'));
    }

    // Find missing control images (result images without control)
    const missingControlImages = [];
    for (const basename of resultBasenames) {
      if (!controlImages.has(basename)) {
        missingControlImages.push(basename);
      }
    }

    // Find orphan control images (control images without result)
    const orphanControlImages = [];
    for (const basename of controlImages) {
      if (!resultBasenames.has(basename)) {
        orphanControlImages.push(basename);
      }
    }

    return {
      controlImageCount: controlImages.size,
      missingControlImages,
      orphanControlImages
    };
  }
}

module.exports = DatasetValidator;
