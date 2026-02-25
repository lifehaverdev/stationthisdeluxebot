/**
 * ExecutionClient — lightweight API client for tool execution and spell casting.
 *
 * Lightweight API client for tool execution and spell casting.
 * Uses the shared CSRF-aware fetch helpers from lib/api.js.
 */

import { postWithCsrf } from '../lib/api.js';

export async function execute(payload) {
  const res = await postWithCsrf('/api/v1/generation/execute', payload);
  const data = await res.json();

  if (!res.ok) {
    let msg = data.error?.message || `Execution failed with status ${res.status}`;
    msg = msg.replace(/sk-[a-zA-Z0-9-]{20,}/g, 'sk-************************************');
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  const final = data.status === 'completed' || data.deliveryMode === 'immediate' || data.status === 'success';
  const outputs = data.outputs || (data.response ? { response: data.response } : undefined);

  return { final, status: data.status, generationId: data.generationId, castId: data.castId, outputs, costUsd: data.costUsd, raw: data };
}

export async function castSpell({ slug, context = {} }) {
  if (!slug) throw new Error('castSpell requires slug');

  const res = await postWithCsrf('/api/v1/spells/cast', { slug, context });

  if (res.status === 202) return { status: 'queued', final: false };

  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error?.message || `Spell cast failed with status ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return {
    final: true,
    status: data.status || 'completed',
    outputs: data.outputs || data.responsePayload || {},
    raw: data,
  };
}

export default { execute, castSpell };
