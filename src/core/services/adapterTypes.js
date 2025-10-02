/**
 * @typedef {Object} ToolResult
 * @property {'image'|'text'|'video'|'files'|'spell'} type - Normalized output type.
 * @property {any} data - Provider-normalized payload for the client.
 * @property {number} [costUsd] - Optional cost information.
 * @property {string} [status] - 'succeeded' | 'failed' | 'processing'.
 *
 * @typedef {Object} ToolAdapter
 * @property {(immediateInputs: any) => Promise<ToolResult>} [execute] - Run an immediate (synchronous) tool and return its result.
 * @property {(asyncInputs: any) => Promise<{runId: string, meta?: any}>} [startJob] - Kick off an asynchronous job. Should return a provider-specific runId that will later map to webhook payloads.
 * @property {(runId: string) => Promise<import('./adapterTypes').ToolResult>} [pollJob] - Optional polling fallback for providers that don’t push webhooks.
 * @property {(payload: any) => import('./adapterTypes').ToolResult} [parseWebhook] - Convert raw webhook data to normalized ToolResult (required for webhook tools).
 */

// This file only contains typedefs for documentation/intellisense in a JS codebase.
