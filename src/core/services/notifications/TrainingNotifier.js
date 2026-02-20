/**
 * TrainingNotifier - Send training status alerts via Telegram/Discord
 *
 * PURPOSE:
 *   Route training notifications to users through their preferred channel.
 *   Priority: Telegram -> Discord -> (future: web status)
 *
 * USAGE:
 *   const notifier = new TrainingNotifier({
 *     telegramBot,
 *     discordClient,
 *     userLookup: async (userId) => ({ telegramId, discordId }),
 *     logger
 *   });
 *
 *   await notifier.notifyStallDetected(userId, jobInfo, stallAnalysis);
 *   await notifier.notifyTrainingTerminated(userId, jobInfo, result);
 *   await notifier.notifyTrainingComplete(userId, jobInfo, result);
 */

class TrainingNotifier {
  constructor({
    telegramBot = null,
    discordClient = null,
    userLookup = null,
    logger
  } = {}) {
    this.telegramBot = telegramBot;
    this.discordClient = discordClient;
    this.userLookup = userLookup;
    this.logger = logger || console;

    if (!telegramBot && !discordClient) {
      this.logger.warn('[TrainingNotifier] No notification channels configured');
    }
  }

  /**
   * Send a notification to a user through their preferred channel
   *
   * @param {string} userId - Internal user ID
   * @param {string} message - Message text to send
   * @returns {Promise<NotificationResult>}
   */
  async notify(userId, message) {
    const result = {
      success: false,
      channel: 'none',
      error: null
    };

    // Look up user's contact info
    let user = null;
    if (this.userLookup) {
      try {
        user = await this.userLookup(userId);
      } catch (err) {
        this.logger.error(`[TrainingNotifier] User lookup failed: ${err.message}`);
        result.error = `User lookup failed: ${err.message}`;
        return result;
      }
    }

    if (!user) {
      this.logger.warn(`[TrainingNotifier] No user found for ID: ${userId}`);
      result.error = 'User not found';
      return result;
    }

    // Try Telegram first
    if (user.telegramId && this.telegramBot) {
      try {
        await this.telegramBot.sendMessage(user.telegramId, message, {
          parse_mode: 'HTML',
          disable_web_page_preview: true
        });
        result.success = true;
        result.channel = 'telegram';
        this.logger.debug(`[TrainingNotifier] Sent notification via Telegram to ${user.telegramId}`);
        return result;
      } catch (err) {
        this.logger.warn(`[TrainingNotifier] Telegram send failed: ${err.message}`);
        // Fall through to try Discord
      }
    }

    // Try Discord second
    if (user.discordId && this.discordClient) {
      try {
        const discordUser = await this.discordClient.users.fetch(user.discordId);
        await discordUser.send(message);
        result.success = true;
        result.channel = 'discord';
        this.logger.debug(`[TrainingNotifier] Sent notification via Discord to ${user.discordId}`);
        return result;
      } catch (err) {
        this.logger.warn(`[TrainingNotifier] Discord send failed: ${err.message}`);
      }
    }

    // No channel available
    this.logger.warn(`[TrainingNotifier] No notification channel available for user ${userId}`);
    result.error = 'No notification channel available';
    return result;
  }

  /**
   * Notify user that training stall was detected
   *
   * @param {string} userId - Internal user ID
   * @param {object} jobInfo - Job information
   * @param {object} stallAnalysis - Stall detection analysis
   * @returns {Promise<NotificationResult>}
   */
  async notifyStallDetected(userId, jobInfo, stallAnalysis) {
    const graceMins = Math.round((stallAnalysis.gracePeriodRemaining || 0) / 60000);

    const message = this._formatMessage({
      emoji: '⚠️',
      title: 'Training Stall Detected',
      fields: {
        'Job': jobInfo.jobName || jobInfo.jobId || 'Unknown',
        'Progress': stallAnalysis.currentStep && stallAnalysis.totalSteps
          ? `${stallAnalysis.currentStep}/${stallAnalysis.totalSteps} (${((stallAnalysis.currentStep / stallAnalysis.totalSteps) * 100).toFixed(1)}%)`
          : `Step ${stallAnalysis.currentStep || 'Unknown'}`,
        'Issue': stallAnalysis.reason || 'ETA not converging',
        'Action': `Auto-terminating in ${graceMins} minutes unless progress resumes`
      }
    });

    return this.notify(userId, message);
  }

  /**
   * Notify user that training was terminated (stall timeout)
   *
   * @param {string} userId - Internal user ID
   * @param {object} jobInfo - Job information
   * @param {object} result - Termination result
   * @returns {Promise<NotificationResult>}
   */
  async notifyTrainingTerminated(userId, jobInfo, result) {
    const message = this._formatMessage({
      emoji: '🛑',
      title: 'Training Terminated',
      fields: {
        'Job': jobInfo.jobName || jobInfo.jobId || 'Unknown',
        'Reason': result.reason || 'Stall detected, grace period expired',
        'Final Checkpoint': result.lastCheckpoint
          ? `Step ${result.lastCheckpoint.step || 'unknown'} (${result.lastCheckpoint.sizeFormatted || 'unknown size'})`
          : 'None saved',
        'Status': result.uploadedTo
          ? `Model uploaded to ${result.uploadedTo}`
          : 'Model will be uploaded as incomplete'
      }
    });

    return this.notify(userId, message);
  }

  /**
   * Notify user that training completed successfully
   *
   * @param {string} userId - Internal user ID
   * @param {object} jobInfo - Job information
   * @param {object} result - Completion result
   * @returns {Promise<NotificationResult>}
   */
  async notifyTrainingComplete(userId, jobInfo, result) {
    const message = this._formatMessage({
      emoji: '✅',
      title: 'Training Complete',
      fields: {
        'Job': jobInfo.jobName || jobInfo.jobId || 'Unknown',
        'Steps': result.totalSteps ? `${result.totalSteps} completed` : 'Unknown',
        'Duration': result.durationFormatted || 'Unknown',
        'Final Loss': result.finalLoss !== null ? result.finalLoss.toFixed(4) : 'Unknown',
        'Model': result.modelUrl || 'Uploading...'
      }
    });

    return this.notify(userId, message);
  }

  /**
   * Notify user of training error
   *
   * @param {string} userId - Internal user ID
   * @param {object} jobInfo - Job information
   * @param {object} error - Error details
   * @returns {Promise<NotificationResult>}
   */
  async notifyTrainingError(userId, jobInfo, error) {
    const message = this._formatMessage({
      emoji: '❌',
      title: 'Training Error',
      fields: {
        'Job': jobInfo.jobName || jobInfo.jobId || 'Unknown',
        'Error': error.message || error.toString() || 'Unknown error',
        'Recovery': error.checkpoint
          ? `Last checkpoint at step ${error.checkpoint.step} will be preserved`
          : 'No checkpoint available'
      }
    });

    return this.notify(userId, message);
  }

  /**
   * Notify user of training progress (optional periodic updates)
   *
   * @param {string} userId - Internal user ID
   * @param {object} jobInfo - Job information
   * @param {object} progress - Progress information
   * @returns {Promise<NotificationResult>}
   */
  async notifyProgress(userId, jobInfo, progress) {
    const percent = progress.totalSteps
      ? ((progress.currentStep / progress.totalSteps) * 100).toFixed(1)
      : null;

    const message = this._formatMessage({
      emoji: '🔄',
      title: 'Training Progress',
      fields: {
        'Job': jobInfo.jobName || jobInfo.jobId || 'Unknown',
        'Progress': percent
          ? `${progress.currentStep}/${progress.totalSteps} (${percent}%)`
          : `Step ${progress.currentStep}`,
        'Loss': progress.loss !== null ? progress.loss.toFixed(4) : 'N/A',
        'ETA': progress.eta ? this._formatDuration(progress.eta) : 'Calculating...'
      }
    });

    return this.notify(userId, message);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Format a notification message
   * Uses simple text format that works on both Telegram and Discord
   */
  _formatMessage({ emoji, title, fields }) {
    const lines = [`${emoji} <b>${title}</b>`, ''];

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null) {
        lines.push(`<b>${key}:</b> ${value}`);
      }
    }

    return lines.join('\n');
  }

  _formatDuration(seconds) {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
}

module.exports = TrainingNotifier;
