// Inject image overlay modal if not present
export function injectImageOverlay() {
    if (document.getElementById('image-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'image-overlay';
    overlay.className = 'image-overlay';
    // Ensure it sits above connection lines (which use z-index 999-1000)
    overlay.style.zIndex = '3000';
    overlay.style.display = 'none';
    overlay.innerHTML = `
      <div class="image-overlay-content">
        <div class="image-overlay-img-container">
          <img class="image-overlay-img" src="" alt="Full Size" />
        </div>
        <button class="image-overlay-close">&times;</button>
      </div>
    `;
    const sandboxMain = document.querySelector('.sandbox-main');
    if (sandboxMain) {
        sandboxMain.appendChild(overlay);
    }

    // Event listeners for closing overlay
    overlay.querySelector('.image-overlay-close').onclick = hideImageOverlay;
    overlay.addEventListener('click', (e) => {
      // Only close if clicking the overlay background, not the modal content or its children
      if (e.target === overlay) hideImageOverlay();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideImageOverlay();
    });
}

import { debugLog } from '../config/debugConfig.js';

export function showImageOverlay(url) {
    debugLog('IMAGE_OVERLAY_SHOW', '[DEBUG] showImageOverlay called with url:', url);
    const overlay = document.getElementById('image-overlay');
    if (!overlay) {
        injectImageOverlay();
    }
    const img = overlay.querySelector('.image-overlay-img');
    img.src = url;
    overlay.style.display = 'flex';

    // Hide permanent connection lines while overlay is active
    document.querySelectorAll('.connection-line.permanent').forEach(el => {
        el._prevVisibility = el.style.visibility;
        el.style.visibility = 'hidden';
    });

    // Wait for image to load, then log sizes
    img.onload = () => {
        const overlayContent = overlay.querySelector('.image-overlay-content');
        const imgContainer = overlay.querySelector('.image-overlay-img-container');
        const overlayParent = overlay.parentElement;
        debugLog('IMAGE_OVERLAY_SIZES', '[DEBUG] overlay parent (.sandbox-main) size:', overlayParent.offsetWidth, overlayParent.offsetHeight);
        debugLog('IMAGE_OVERLAY_SIZES', '[DEBUG] overlay size:', overlay.offsetWidth, overlay.offsetHeight);
        debugLog('IMAGE_OVERLAY_SIZES', '[DEBUG] overlay-content size:', overlayContent.offsetWidth, overlayContent.offsetHeight);
        debugLog('IMAGE_OVERLAY_SIZES', '[DEBUG] img-container size:', imgContainer.offsetWidth, imgContainer.offsetHeight);
        debugLog('IMAGE_OVERLAY_SIZES', '[DEBUG] img size:', img.offsetWidth, img.offsetHeight);
        debugLog('IMAGE_OVERLAY_SIZES', '[DEBUG] window size:', window.innerWidth, window.innerHeight);
    };
    debugLog('IMAGE_OVERLAY_SHOW', '[DEBUG] overlay.style.display set to flex, overlay:', overlay, 'img:', img);
}

window.showImageOverlay = showImageOverlay;

export function hideImageOverlay() {
    debugLog('IMAGE_OVERLAY_HIDE', '[DEBUG] hideImageOverlay called');
    const overlay = document.getElementById('image-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    overlay.querySelector('.image-overlay-img').src = '';

    // Restore connection-line visibility
    document.querySelectorAll('.connection-line.permanent').forEach(el => {
        el.style.visibility = el._prevVisibility || '';
        delete el._prevVisibility;
    });
} 