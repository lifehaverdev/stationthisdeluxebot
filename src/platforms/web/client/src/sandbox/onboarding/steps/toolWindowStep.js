export default class ToolWindowStep {
  constructor() {
    this.id = 'tool-window-tour';
  }

  render(root, next) {
    this.root = root;
    this.next = next;
    this.findWindow();
  }

  findWindow(retries = 20) {
    const win = Array.from(document.querySelectorAll('.tool-window')).find(w => w.textContent.toLowerCase().includes('quickmake')) || document.querySelector('.tool-window');
    if (!win && retries > 0) {
      setTimeout(() => this.findWindow(retries - 1), 200);
      return;
    }
    if (!win) { this.next(); return; }
    this.showStep(win);
  }

  showStep(win) {
    win.classList.add('st-onboarding-highlight');
    this.cleanupFn = () => win.classList.remove('st-onboarding-highlight');

    const rect = win.getBoundingClientRect();
    const card = this.makeCard(rect);
    card.querySelector('.st-onboard-skip').addEventListener('click', () => {
      this.cleanup();
      this.next();
    });

    // Detect execute click to finish
    const execBtn = win.querySelector('button, .execute-btn');
    if (execBtn) {
      const onExec = () => {
        execBtn.removeEventListener('click', onExec, true);
        this.cleanup();
        this.next();
      };
      execBtn.addEventListener('click', onExec, true);
      this.cleanupExec = () => execBtn.removeEventListener('click', onExec, true);
    }
  }

  makeCard(rect) {
    const overlay = document.createElement('div');
    overlay.className = 'st-onboard-overlay no-bg';
    this.root.appendChild(overlay);
    this.cleanupOverlay = () => overlay.remove();

    const card = document.createElement('div');
    card.className = 'st-onboard-card';
    const margin = 12;
    let top = rect.top;
    let left = rect.right + margin;
    if (left + 320 > window.innerWidth) {
      left = rect.left - 340 - margin;
    }
    if (left < 20) left = 20;
    if (top + 200 > window.innerHeight) top = window.innerHeight - 220;
    if (top < 20) top = 20;

    card.style.position = 'fixed';
    card.style.top = `${top}px`;
    card.style.left = `${left}px`;
    card.style.zIndex = 10000;
    card.innerHTML = `
      <h2>Run the Tool</h2>
      <p>Fill in the prompt and any other parameters, then press <b>Execute</b> to generate your image. You can tweak parameters and re-run as much as you like.</p>
      <div class="st-onboard-actions" style="justify-content:flex-end;"><button class="st-onboard-skip">Skip Tour</button></div>
    `;
    this.root.appendChild(card);
    this.cleanupCard = () => card.remove();
    return card;
  }

  cleanup() {
    if (this.cleanupFn) this.cleanupFn();
    if (this.cleanupOverlay) this.cleanupOverlay();
    if (this.cleanupCard) this.cleanupCard();
    if (this.cleanupExec) this.cleanupExec();
    this.root.innerHTML = '';
  }
} 