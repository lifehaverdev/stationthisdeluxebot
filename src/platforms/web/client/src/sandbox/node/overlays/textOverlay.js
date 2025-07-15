// === TEXT OVERLAY FOR PROMPT FIELDS ===

let textOverlaySaveCallback = null;

function injectTextOverlay() {
    if (document.getElementById('text-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'text-overlay';
    overlay.className = 'text-overlay';
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
    const textarea = overlay.querySelector('.text-overlay-textarea');
    if (textOverlaySaveCallback) {
        textOverlaySaveCallback(textarea.value);
        textOverlaySaveCallback = null;
    }
}

export function bindPromptFieldOverlays() {
    console.log('[textOverlay.js] bindPromptFieldOverlays called');
    const paramNames = [
        'input_prompt',
        'input_negative',
        'input_negative_prompt',
        'input_text' // As per your suggestion
    ];

    paramNames.forEach(paramName => {
        const containers = document.querySelectorAll(`div.parameter-input[data-param-name="${paramName}"]`);
        containers.forEach(container => {
            const field = container.querySelector('input[type="text"]');
            if (!field || field._overlayBound) return;

            console.log('[textOverlay.js] Binding overlay to field:', field);
            field._overlayBound = true;
            field.addEventListener('focus', function(e) {
                e.preventDefault();
                showTextOverlay(field.value, (newValue) => {
                    field.value = newValue;
                    field.dispatchEvent(new Event('input', { bubbles: true }));
                });
            });
        });
    });
} 