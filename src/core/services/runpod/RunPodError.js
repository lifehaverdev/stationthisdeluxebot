class RunPodError extends Error {
  constructor(message, { status, code, cause, requestId, jobId } = {}) {
    super(message);
    this.name = 'RunPodError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.jobId = jobId;
    if (cause) {
      this.cause = cause;
    }
  }
}

module.exports = RunPodError;
