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
        <button class="image-overlay-prev" style="display:none">&#9664;</button>
        <button class="image-overlay-next" style="display:none">&#9654;</button>
        <span class="image-overlay-counter" style="display:none"></span>
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
      if (e.key === 'ArrowLeft') navigateOverlay(-1);
      if (e.key === 'ArrowRight') navigateOverlay(1);
    });
}

import { debugLog } from '../../config/debugConfig.js';

// Gallery state
let _galleryUrls = [];
let _galleryIndex = 0;

function navigateOverlay(direction) {
    if (_galleryUrls.length < 2) return;
    _galleryIndex = (_galleryIndex + direction + _galleryUrls.length) % _galleryUrls.length;
    const overlay = document.getElementById('image-overlay');
    if (!overlay || overlay.style.display === 'none') return;
    const img = overlay.querySelector('.image-overlay-img');
    img.src = _galleryUrls[_galleryIndex];
    const counter = overlay.querySelector('.image-overlay-counter');
    if (counter) counter.textContent = `${_galleryIndex + 1} / ${_galleryUrls.length}`;
}

/**
 * Show the image overlay. Supports both single image and gallery modes.
 * @param {string|string[]} urlOrUrls - Single URL or array of URLs
 * @param {number} [startIndex=0] - Starting index when an array is provided
 */
export function showImageOverlay(urlOrUrls, startIndex = 0) {
    const urls = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];
    const idx = Math.max(0, Math.min(startIndex, urls.length - 1));

    _galleryUrls = urls;
    _galleryIndex = idx;

    debugLog('IMAGE_OVERLAY_SHOW', '[DEBUG] showImageOverlay called with', urls.length, 'image(s), startIndex:', idx);
    let overlay = document.getElementById('image-overlay');
    if (!overlay) {
        injectImageOverlay();
        overlay = document.getElementById('image-overlay');
    }
    const img = overlay.querySelector('.image-overlay-img');
    img.src = urls[idx];
    overlay.style.display = 'flex';

    // Show/hide gallery nav
    const prevBtn = overlay.querySelector('.image-overlay-prev');
    const nextBtn = overlay.querySelector('.image-overlay-next');
    const counter = overlay.querySelector('.image-overlay-counter');
    const hasGallery = urls.length > 1;

    if (prevBtn) {
        prevBtn.style.display = hasGallery ? 'flex' : 'none';
        prevBtn.onclick = () => navigateOverlay(-1);
    }
    if (nextBtn) {
        nextBtn.style.display = hasGallery ? 'flex' : 'none';
        nextBtn.onclick = () => navigateOverlay(1);
    }
    if (counter) {
        counter.style.display = hasGallery ? 'block' : 'none';
        counter.textContent = `${idx + 1} / ${urls.length}`;
    }

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
    _galleryUrls = [];
    _galleryIndex = 0;

    // Restore connection-line visibility
    document.querySelectorAll('.connection-line.permanent').forEach(el => {
        el.style.visibility = el._prevVisibility || '';
        delete el._prevVisibility;
    });
}
