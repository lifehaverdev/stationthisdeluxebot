// CollectionReviewWindow.js
// Lightweight sandbox window for reviewing cooked pieces one-by-one.
// Opens via CookMenuModal Overview "Review" button.

import { renderResultContent } from '../node/resultContent.js';

export function createCollectionReviewWindow(collection, position = { x: 220, y: 120 }) {
  const win = document.createElement('div');
  win.className = 'review-window tool-window';
  win.style.left = `${position.x}px`;
  win.style.top = `${position.y}px`;
  win.style.width = '340px';
  win.style.background = '#1a1a1a';
  win.style.color = '#fff';
  win.style.padding = '10px';
  win.style.border = '1px solid #444';
  win.style.borderRadius = '8px';

  // ---- Header ----
  const header = document.createElement('div');
  header.textContent = `${collection.name || 'Collection'} · Review`;
  header.style.fontWeight = 'bold';
  header.style.marginBottom = '6px';
  header.style.cursor = 'move';
  header.style.userSelect = 'none';
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.title = 'Close';
  header.appendChild(closeBtn);
  win.appendChild(header);

  // Simple drag via header
  let dragOff = { x: 0, y: 0 }, dragging = false;
  header.addEventListener('mousedown', e => {
    dragging = true;
    dragOff.x = e.clientX - win.offsetLeft;
    dragOff.y = e.clientY - win.offsetTop;
    header.style.cursor = 'grabbing';
  });
  document.addEventListener('mousemove', e => {
    if (dragging) {
      win.style.left = `${e.clientX - dragOff.x}px`;
      win.style.top = `${e.clientY - dragOff.y}px`;
    }
  });
  document.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      header.style.cursor = 'move';
    }
  });

  closeBtn.onclick = () => win.remove();

  // ---- Body ----
  const body = document.createElement('div');
  win.appendChild(body);

  function setBodyContent(html) {
    body.innerHTML = html;
  }

  // Initial state with Start button
  setBodyContent(`<div style="text-align:center;"><button class="start-review-btn">Start Reviewing</button></div>`);

  async function fetchOldestUnreviewed() {
    try {
      const res = await fetch(`/api/v1/collections/${encodeURIComponent(collection.collectionId)}/pieces/unreviewed?ts=${Date.now()}`, {
        credentials: 'include',
        headers: { 'cache-control': 'no-cache' }
      });
      if (!res.ok) throw new Error('fetch failed');
      const json = await res.json();
      const gens = json.generations || [];
      return gens[0] || null;
    } catch (e) {
      console.warn('[ReviewWindow] fetch error', e);
      return null;
    }
  }

  async function markReviewOutcome(generationId, outcome, existingMetadata = {}) {
    try {
      const csrfRes = await fetch('/api/v1/csrf-token', { credentials: 'include' });
      const { csrfToken = '' } = await csrfRes.json();
      await fetch(`/api/v1/collections/${encodeURIComponent(collection.collectionId)}/pieces/${encodeURIComponent(generationId)}/review`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) },
        credentials: 'include',
        body: JSON.stringify({ outcome })
      });
    } catch (e) {
      console.warn('[ReviewWindow] review mark fail', e);
    }
  }

  async function loadNext() {
    setBodyContent('<div style="text-align:center;">Loading…</div>');
    const gen = await fetchOldestUnreviewed();
    if (!gen) {
      setBodyContent('<div style="text-align:center;">No unreviewed pieces 🎉</div>');
      return;
    }

    // Build display
    const container = document.createElement('div');

    // Result content
    const resultDiv = document.createElement('div');
    resultDiv.className = 'result-container';
    container.appendChild(resultDiv);

    // Try to detect output data similar to test window
    let outputData;
    if (Array.isArray(gen.outputs?.images) && gen.outputs.images[0]?.url) {
      outputData = { type: 'image', url: gen.outputs.images[0].url };
    } else if (gen.outputs?.imageUrl) {
      outputData = { type: 'image', url: gen.outputs.imageUrl };
    } else if (gen.outputs?.response) {
      outputData = { type: 'text', text: gen.outputs.response };
    } else if (gen.outputs?.text) {
      outputData = { type: 'text', text: gen.outputs.text };
    } else if (Array.isArray(gen.responsePayload)) {
       // Look into responsePayload array for images or text
       for (const item of gen.responsePayload) {
         const images = item?.data?.images;
         if (Array.isArray(images) && images[0]?.url) {
           outputData = { type: 'image', url: images[0].url };
           break;
         }
         const txt = item?.data?.text || item?.data?.response;
         if (txt) {
           outputData = { type: 'text', text: txt };
           break;
         }
       }
    } else {
      outputData = { type: 'unknown', ...gen.outputs };
    }
    renderResultContent(resultDiv, outputData);

    // Trait metadata display (if present)
    const metaDiv = document.createElement('pre');
    metaDiv.style.whiteSpace = 'pre-wrap';
    metaDiv.style.fontSize = '12px';
    let metaObj = gen.metadata?.selectedTraits;
    if (!metaObj || (typeof metaObj === 'object' && Object.keys(metaObj).length === 0)) {
      metaObj = gen.metadata?.paramSnapshot || gen.metadata || {};
    }
    metaDiv.textContent = JSON.stringify(metaObj, null, 2);
    // Traits summary
    const traitsSummary = document.createElement('div');
    traitsSummary.style.marginTop = '6px';
    if (gen.metadata?.selectedTraits && Object.keys(gen.metadata.selectedTraits).length) {
      traitsSummary.innerHTML = Object.entries(gen.metadata.selectedTraits)
        .map(([k,v])=>`<strong>${k}</strong>: ${v}`)
        .join(' | ');
    } else {
      traitsSummary.textContent = '(traits unknown)';
    }
    container.appendChild(traitsSummary);

    // Show-more for paramOverrides
    const paramToggleBtn = document.createElement('button');
    paramToggleBtn.textContent = 'show params';
    paramToggleBtn.style.marginTop = '4px';
    const paramPre = document.createElement('pre');
    paramPre.style.whiteSpace='pre-wrap';
    paramPre.style.fontSize='11px';
    paramPre.style.display='none';
    paramPre.textContent = JSON.stringify(gen.metadata?.paramSnapshot || {}, null, 2);
    paramToggleBtn.onclick = ()=>{
      const open = paramPre.style.display !== 'none';
      paramPre.style.display = open ? 'none':'block';
      paramToggleBtn.textContent = open ? 'show params':'hide params';
    };
    container.appendChild(paramToggleBtn);
    container.appendChild(paramPre);
    // Accept / Reject buttons
    const btnRow = document.createElement('div');
    btnRow.style.marginTop = '8px';
    const acceptBtn = document.createElement('button');
    acceptBtn.textContent = 'Accept ✅';
    acceptBtn.style.marginRight = '6px';
    const rejectBtn = document.createElement('button');
    rejectBtn.textContent = 'Reject ❌';
    btnRow.append(acceptBtn, rejectBtn);
    container.appendChild(btnRow);

    acceptBtn.onclick = async () => {
      await markReviewOutcome(gen._id, 'accepted', gen.metadata || {});
      await loadNext();
    };
    rejectBtn.onclick = async () => {
      await markReviewOutcome(gen._id, 'rejected', gen.metadata || {});
      await loadNext();
    };

    body.innerHTML = '';
    body.appendChild(container);
  }

  // Start button listener (delegated)
  body.addEventListener('click', e => {
    if (e.target.classList.contains('start-review-btn')) {
      loadNext();
    }
  });

  document.querySelector('.sandbox-canvas')?.appendChild(win);
} 