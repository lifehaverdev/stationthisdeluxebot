// Video overlay for displaying videos in fullscreen
export function injectVideoOverlay() {
  if (document.getElementById('video-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'video-overlay';
  // Re-use existing image overlay classes for consistent styling
  overlay.className = 'image-overlay';
  overlay.style.zIndex = '3000';
  overlay.style.display = 'none';
  overlay.innerHTML = `
    <div class="image-overlay-content">
      <div class="image-overlay-img-container">
        <video class="video-overlay-el" src="" controls style="width:80%;max-height:80vh;object-fit:contain;"></video>
      </div>
      <button class="image-overlay-close">&times;</button>
    </div>
  `;

  const sandboxMain = document.querySelector('.sandbox-main');
  if (sandboxMain) {
    sandboxMain.appendChild(overlay);
  }

  overlay.querySelector('.image-overlay-close').onclick = hideVideoOverlay;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) hideVideoOverlay();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideVideoOverlay();
  });
}

export function showVideoOverlay(url, loop = false) {
  if (!document.getElementById('video-overlay')) {
    injectVideoOverlay();
  }
  const overlay = document.getElementById('video-overlay');
  const vid = overlay.querySelector('.video-overlay-el');
  vid.src = url;
  vid.loop = loop;
  overlay.style.display = 'flex';

  // Hide permanent connection lines while overlay is active
  document.querySelectorAll('.connection-line.permanent').forEach(el => {
    el._prevVisibility = el.style.visibility;
    el.style.visibility = 'hidden';
  });
}

export function hideVideoOverlay() {
  const overlay = document.getElementById('video-overlay');
  if (!overlay) return;
  overlay.style.display = 'none';
  const vid = overlay.querySelector('.video-overlay-el');
  vid.pause();
  vid.src = '';

  // Restore connection-line visibility
  document.querySelectorAll('.connection-line.permanent').forEach(el => {
    el.style.visibility = el._prevVisibility || '';
    delete el._prevVisibility;
  });
}

// Expose helper for debugging
if (typeof window !== 'undefined') {
  window.showVideoOverlay = showVideoOverlay;
}
