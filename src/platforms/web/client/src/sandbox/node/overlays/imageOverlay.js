// Inject image overlay modal if not present
export function injectImageOverlay() {
    if (document.getElementById('image-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'image-overlay';
    overlay.className = 'image-overlay';
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

export function showImageOverlay(url) {
    console.log('[DEBUG] showImageOverlay called with url:', url);
    const overlay = document.getElementById('image-overlay');
    if (!overlay) {
        injectImageOverlay();
    }
    const img = overlay.querySelector('.image-overlay-img');
    img.src = url;
    overlay.style.display = 'flex';

    // Wait for image to load, then log sizes
    img.onload = () => {
        const overlayContent = overlay.querySelector('.image-overlay-content');
        const imgContainer = overlay.querySelector('.image-overlay-img-container');
        const overlayParent = overlay.parentElement;
        console.log('[DEBUG] overlay parent (.sandbox-main) size:', overlayParent.offsetWidth, overlayParent.offsetHeight);
        console.log('[DEBUG] overlay size:', overlay.offsetWidth, overlay.offsetHeight);
        console.log('[DEBUG] overlay-content size:', overlayContent.offsetWidth, overlayContent.offsetHeight);
        console.log('[DEBUG] img-container size:', imgContainer.offsetWidth, imgContainer.offsetHeight);
        console.log('[DEBUG] img size:', img.offsetWidth, img.offsetHeight);
        console.log('[DEBUG] window size:', window.innerWidth, window.innerHeight);
    };
    console.log('[DEBUG] overlay.style.display set to flex, overlay:', overlay, 'img:', img);
}

window.showImageOverlay = showImageOverlay;

export function hideImageOverlay() {
    console.log('[DEBUG] hideImageOverlay called');
    const overlay = document.getElementById('image-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    overlay.querySelector('.image-overlay-img').src = '';
} 