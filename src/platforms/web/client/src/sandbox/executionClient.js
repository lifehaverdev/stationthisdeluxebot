// Lightweight ExecutionClient for browser sandbox
// Provides execute(payload) that normalises responses similar to server-side client.

export async function execute(payload) {
  // CSRF token fetch
  const csrfRes = await fetch('/api/v1/csrf-token', { credentials: 'include' });
  const { csrfToken } = await csrfRes.json();

  const res = await fetch('/api/v1/generation/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
    credentials: 'include',
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error?.message || `Execution failed with status ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  const final = data.status === 'completed' || data.deliveryMode === 'immediate' || data.status === 'success';
  const outputs = data.outputs || (data.response ? { response: data.response } : undefined);

  return {
    final,
    status: data.status,
    generationId: data.generationId,
    outputs,
    raw: data,
  };
}

// Cast a spell via external API and normalise minimal output
export async function castSpell({ slug, context = {} }) {
  if (!slug) throw new Error('castSpell requires slug');
  const csrfRes = await fetch('/api/v1/csrf-token', { credentials: 'include' });
  const { csrfToken } = await csrfRes.json();

  const res = await fetch('/api/v1/spells/cast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
    credentials: 'include',
    body: JSON.stringify({ slug, context }),
  });

  if (res.status === 202) {
    return { status: 'queued', final: false };
  }
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error?.message || `Spell cast failed with status ${res.status}`);
    err.status = res.status; err.data = data; throw err;
  }
  return { final: true, status: data.status || 'completed', outputs: data.outputs || data.responsePayload || {}, raw: data };
}

export default { execute, castSpell }; 