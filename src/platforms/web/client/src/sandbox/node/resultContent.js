import { showImageOverlay } from './overlays/imageOverlay.js';
import { getToolWindow, getConnections } from '../state.js';
import { createToolWindow, executeNodeAndDependencies } from './toolWindow.js';
import { createPermanentConnection } from '../connections/index.js';

// Helper to duplicate a window with copied mappings + randomised seed and run it
async function duplicateAndRun(windowId) {
    const srcWin = getToolWindow(windowId);
    if (!srcWin) return;

    const OFFSET = 5;
    const dupPos = { x: srcWin.workspaceX + OFFSET, y: srcWin.workspaceY + OFFSET };
    const dupEl = createToolWindow(srcWin.tool, dupPos);

    const dupWinData = getToolWindow(dupEl.id);
    if (dupWinData) {
        dupWinData.parameterMappings = JSON.parse(JSON.stringify(srcWin.parameterMappings || {}));
        // Randomise seeds (reuse util defined in toolWindow.js)
        if (typeof window.randomizeSeedInMappings === 'function') {
            window.randomizeSeedInMappings(dupWinData.parameterMappings);
        } else {
            Object.entries(dupWinData.parameterMappings).forEach(([k, m]) => {
                if (m && m.type === 'static' && /seed/i.test(k)) {
                    m.value = Math.floor(Math.random() * 1e9);
                }
            });
        }
    }

    // --- Duplicate incoming connections ---
    Object.entries(dupWinData.parameterMappings).forEach(([paramKey, mapping]) => {
        if (mapping && mapping.type === 'nodeOutput') {
            const fromWinEl = document.getElementById(mapping.nodeId);
            if (fromWinEl) {
                createPermanentConnection(fromWinEl, dupEl, mapping.outputKey || paramKey);
            }
        }
    });

    // --- Duplicate outgoing connections (if any) ---
    const existingConns = getConnections().filter(c => c.fromWindowId === srcWin.id);
    existingConns.forEach(conn => {
        const toWinEl = document.getElementById(conn.toWindowId);
        if (toWinEl) {
            createPermanentConnection(dupEl, toWinEl, conn.type);
        }
    });

    await executeNodeAndDependencies(dupEl.id);
}

export function renderResultContent(resultContainer, output) {
    resultContainer.innerHTML = '';

    // If this is a spell with multiple step outputs, build a step selector UI and return early
    if (Array.isArray(output.steps)) {
        const selector = document.createElement('div');
        selector.className = 'spell-step-selector';
        selector.style.marginBottom = '6px';

        const contentHolder = document.createElement('div');

        let currentIndex = 0;

        const renderStep = (idx) => {
            currentIndex = idx;
            contentHolder.innerHTML = '';
            const step = output.steps[idx];
            const stepOutput = step.output || step.outputs || step.data || {};
            // Recurse into renderResultContent to display the step output
            renderResultContent(contentHolder, stepOutput);
            Array.from(selector.querySelectorAll('button')).forEach((b,i)=>{
                b.disabled = i===idx;
            });
        };

        output.steps.forEach((s,i)=>{
            const btn = document.createElement('button');
            btn.textContent = s.name || `step ${i+1}`;
            btn.style.marginRight = '4px';
            btn.addEventListener('click', ()=> renderStep(i));
            selector.appendChild(btn);
        });

        resultContainer.appendChild(selector);
        resultContainer.appendChild(contentHolder);
        renderStep(0);

        return; // Spell handling done, skip the rest of the function
    }

    // Normalise possible batch structures to arrays
    const normalised = (() => {
        if (output.type === 'image') {
            if (Array.isArray(output.urls)) return output.urls;
            if (Array.isArray(output.url))  return output.url;
            if (Array.isArray(output.images)) return output.images.map(i => i.url || i);
            return [output.url];
        } else if (output.type === 'text') {
            if (Array.isArray(output.text)) return output.text;
            return [output.text];
        }
        return [];
    })();

    const renderSingle = (idx) => {
        resultContainer.innerHTML = '';
        const value = normalised[idx];

        if (output.type === 'image') {
            const img = document.createElement('img');
            img.src = value;
            img.className = 'result-image';
            img.style.maxWidth = '100%';
            img.style.maxHeight = '300px';
            img.style.display = 'block';
            img.style.cursor = 'pointer';
            img.addEventListener('click', () => showImageOverlay(value));
            resultContainer.appendChild(img);
        } else if (output.type === 'text') {
            const text = document.createElement('div');
            text.className = 'result-text-output';
            text.textContent = value;

            // Quick copy-to-clipboard UX
            text.title = 'Click to copy';
            text.style.cursor = 'pointer';
            text.addEventListener('click', () => {
                const feedback = () => {
                    const original = text.textContent;
                    text.textContent = 'Copied!';
                    text.style.opacity = '0.6';
                    setTimeout(() => {
                        text.textContent = original;
                        text.style.opacity = '1';
                    }, 800);
                };

                // Try modern API first
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(value).then(feedback).catch(() => {
                        // Fallback: legacy execCommand
                        const textarea = document.createElement('textarea');
                        textarea.value = value;
                        textarea.style.position = 'fixed';
                        textarea.style.opacity = '0';
                        document.body.appendChild(textarea);
                        textarea.select();
                        try {
                            document.execCommand('copy');
                            feedback();
                        } catch (err) {
                            window.prompt('Copy to clipboard: Ctrl+C, Enter', value);
                        }
                        document.body.removeChild(textarea);
                    });
                } else {
                    // Very old browsers
                    window.prompt('Copy to clipboard: Ctrl+C, Enter', value);
                }
            });
            resultContainer.appendChild(text);
        }
    };

    // If we have multiple items, build pager controls
    if (normalised.length > 1) {
        let index = 0;
        const nav = document.createElement('div');
        nav.className = 'batch-nav';
        const prev = document.createElement('button'); prev.textContent = '◀';
        const next = document.createElement('button'); next.textContent = '▶';
        const counter = document.createElement('span'); counter.textContent = ` 1 / ${normalised.length}`;

        const update = () => {
            counter.textContent = ` ${index + 1} / ${normalised.length}`;
            renderSingle(index);
        };
        prev.onclick = () => { index = (index - 1 + normalised.length) % normalised.length; update(); };
        next.onclick = () => { index = (index + 1) % normalised.length; update(); };

        nav.append(prev, counter, next);
        resultContainer.appendChild(nav);
        update();
    } else {
        if (normalised.length) {
            renderSingle(0);
        } else {
            resultContainer.textContent = 'Output available.';
        }
    }

    // Caption support (only for single item)
    if (normalised.length === 1 && output.caption) {
        const captionDiv = document.createElement('div');
        captionDiv.className = 'result-caption';
        captionDiv.textContent = output.caption;
        resultContainer.appendChild(captionDiv);
    }

    // --- Rating UI ---
    if (output.generationId) {
        const ratingContainer = document.createElement('div');
        ratingContainer.className = 'result-rating-container';
        ratingContainer.style.marginTop = '8px';

        // Re-roll button (appears before emojis)
        const rerollBtn = document.createElement('button');
        rerollBtn.textContent = '🎲 re-roll';
        rerollBtn.style.marginRight = '8px';
        rerollBtn.addEventListener('click', async () => {
            rerollBtn.disabled = true;
            const winId = resultContainer.closest('.tool-window')?.id;
            if (winId) {
                await duplicateAndRun(winId);
            }
            rerollBtn.disabled = false;
        });
        ratingContainer.appendChild(rerollBtn);

        const ratings = [
            { key: 'beautiful', emoji: '😻' },
            { key: 'funny',     emoji: '😹' },
            { key: 'sad',       emoji: '😿' }
        ];

        ratings.forEach(r => {
            const btn = document.createElement('button');
            btn.textContent = r.emoji;
            btn.style.fontSize = '24px';
            btn.style.marginRight = '4px';
            btn.title = r.key;

            btn.addEventListener('click', async () => {
                btn.disabled = true;
                try {
                    const csrfRes = await fetch('/api/v1/csrf-token');
                    const { csrfToken } = await csrfRes.json();

                    await fetch('/api/v1/generation/rate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
                        credentials: 'include',
                        body: JSON.stringify({ generationId: output.generationId, rating: r.key })
                    });
                    ratingContainer.textContent = 'Thank you for rating!';
                } catch (err) {
                    console.error('[Rating] Failed to submit rating', err);
                    ratingContainer.textContent = 'Rating failed.';
                }
            });

            ratingContainer.appendChild(btn);
        });

        resultContainer.appendChild(ratingContainer);
    }
} 