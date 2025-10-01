/**
 * @typedef {Object} ToolResult
 * @property {'image'|'text'|'video'|'files'|'spell'} type - Normalized output type.
 * @property {any} data - Provider-normalized payload for the client.
 * @property {number} [costUsd] - Optional cost information.
 * @property {string} [status] - 'succeeded' | 'failed' | 'processing'.
 *
 * @typedef {Object} ToolAdapter
 * @property {(immediateInputs: any) => Promise<ToolResult>} [execute] - Run an immediate (synchronous) tool and return its result.
 * @property {(asyncInputs: any) => Promise<{runId: string, meta?: any}>} [startJob] - Kick off a long-running job that will complete asynchronously.
 * @property {(runId: string) => Promise<ToolResult>} [pollJob] - Optional polling method to retrieve job result.
 * @property {(payload: any) => ToolResult} [parseWebhook] - Optional parser to convert webhook payloads into normalized ToolResult.
 */

// This file only contains typedefs for documentation/intellisense in a JS codebase.
