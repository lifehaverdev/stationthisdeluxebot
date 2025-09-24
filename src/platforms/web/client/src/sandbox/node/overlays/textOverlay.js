// === TEXT OVERLAY FOR PROMPT FIELDS ===

let textOverlaySaveCallback = null;

function injectTextOverlay() {
    if (document.getElementById('text-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'text-overlay';
    overlay.className = 'text-overlay';
    overlay.style.zIndex = '3000';
    overlay.style.display = 'none';
    overlay.innerHTML = `
      <div class="text-overlay-content">
        <button class="text-overlay-close">&times;</button>
        <textarea class="text-overlay-textarea"></textarea>
      </div>
    `;
    const sandboxMain = document.querySelector('.sandbox-main');
    if (sandboxMain) {
        sandboxMain.appendChild(overlay);
    }
    // Event listeners for closing overlay
    overlay.querySelector('.text-overlay-close').onclick = hideTextOverlay;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) hideTextOverlay();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideTextOverlay();
    });
}

export function showTextOverlay(initialValue, onSave) {
    injectTextOverlay();
    const overlay = document.getElementById('text-overlay');
    const textarea = overlay.querySelector('.text-overlay-textarea');
    textarea.value = initialValue || '';
    overlay.style.display = 'flex';

    // Hide connection lines
    document.querySelectorAll('.connection-line.permanent').forEach(el => {
        el._prevVisibility = el.style.visibility;
        el.style.visibility = 'hidden';
    });
    textarea.focus();
    textOverlaySaveCallback = onSave;
}

// For debugging purposes, expose showTextOverlay to the window
if (typeof window !== 'undefined') {
    window.showTextOverlay = showTextOverlay;
}

function hideTextOverlay() {
    const overlay = document.getElementById('text-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';

    // Restore connection lines
    document.querySelectorAll('.connection-line.permanent').forEach(el => {
        el.style.visibility = el._prevVisibility || '';
        delete el._prevVisibility;
    });
    const textarea = overlay.querySelector('.text-overlay-textarea');
    if (textOverlaySaveCallback) {
        textOverlaySaveCallback(textarea.value);
        textOverlaySaveCallback = null;
    }
}

import { debugLog } from '../../config/debugConfig.js';

export function bindPromptFieldOverlays() {
    debugLog('TEXT_OVERLAY', '[textOverlay.js] bindPromptFieldOverlays called');
    // Bind to any parameter whose name suggests longer text – prompt, text, instructions
    const containers = document.querySelectorAll('div.parameter-input');
    containers.forEach(container => {
        const paramName = container.dataset.paramName || '';
        if (!/(prompt|text|instruction)/i.test(paramName)) return;

        const field = container.querySelector('input[type="text"]');
        if (!field || field._overlayBound) return;

        debugLog('TEXT_OVERLAY', '[textOverlay.js] Binding overlay to field:', field);
        field._overlayBound = true;
        field.addEventListener('focus', function(e) {
            e.preventDefault();
            showTextOverlay(field.value, (newValue) => {
                field.value = newValue;
                field.dispatchEvent(new Event('input', { bubbles: true }));
            });
        });
    });
} 