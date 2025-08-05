export default class AnchorConnectStep {
  constructor() {
    this.id = 'anchor-connect-tour';
    this.cleanupFns = [];
  }

  render(root, next) {
    this.root = root;
    this.next = next;
    this.findAnchor();
  }

  findAnchor(retries = 40) {
    const win = Array.from(document.querySelectorAll('.tool-window')).find(w => w.textContent.toLowerCase().includes('quickmake'));
    
    // If window is found, check for anchor. If not, retry finding window.
    if (win) {
      const anchor = win.querySelector('.outputs .anchor-point');
      if (anchor) {
        this.showStep(anchor);
        return; // Success!
      }
    }

    // If we're here, either window or anchor was not found. Retry.
    if (retries > 0) {
      setTimeout(() => this.findAnchor(retries - 1), 200);
    } else {
      this.next(); // Give up and skip the step
    }
  }

  showStep(anchor) {
    // Highlight
    anchor.classList.add('st-onboarding-highlight');
    this.cleanupFns.push(() => anchor.classList.remove('st-onboarding-highlight'));

    // Position card
    const rect = anchor.getBoundingClientRect();
    const card = this.makeCard(rect);
    card.querySelector('.st-onboard-skip').addEventListener('click', () => {
      this.cleanup();
      this.next();
    });

    // Advance when user starts dragging
    const onDragStart = () => {
      // Listen for drop to finish
      document.addEventListener('mouseup', onDragEnd, { once: true });
    };
    const onDragEnd = () => {
      this.cleanup();
      // give a moment for tool modal to appear
      setTimeout(() => this.next(), 200);
    };

    anchor.addEventListener('mousedown', onDragStart, { once: true });
    this.cleanupFns.push(() => anchor.removeEventListener('mousedown', onDragStart));
    this.cleanupFns.push(() => document.removeEventListener('mouseup', onDragEnd));
  }

  makeCard(rect) {
    const overlay = document.createElement('div');
    overlay.className = 'st-onboard-overlay no-bg';
    this.root.appendChild(overlay);
    this.cleanupFns.push(() => overlay.remove());

    const card = document.createElement('div');
    card.className = 'st-onboard-card';
    const margin = 12;
    let top = rect.top;
    let left = rect.right + margin;
    if (left + 320 > window.innerWidth) left = rect.left - 340 - margin;
    if (top + 200 > window.innerHeight) top = window.innerHeight - 220;

    card.style.position = 'fixed';
    card.style.top = `${Math.max(20, top)}px`;
    card.style.left = `${Math.max(20, left)}px`;
    card.style.zIndex = 10000;
    card.innerHTML = `
      <h2>Connect Tools</h2>
      <p>This is an <b>output anchor</b>. Drag it to an empty spot on the canvas to connect its result to a new tool.</p>
      <div class="st-onboard-actions" style="justify-content:flex-end;"><button class="st-onboard-skip">Skip Tour</button></div>
    `;
    this.root.appendChild(card);
    this.cleanupFns.push(() => card.remove());
    return card;
  }

  cleanup() {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
    this.root.innerHTML = '';
  }
} 