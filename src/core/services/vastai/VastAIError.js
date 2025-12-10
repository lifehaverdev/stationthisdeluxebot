class VastAIError extends Error {
  constructor(message, { status, code, cause, requestId } = {}) {
    super(message);
    this.name = 'VastAIError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    if (cause) {
      this.cause = cause;
    }
  }
}

module.exports = VastAIError;
