export default class SpellIntroStep {
  constructor() {
    this.id = 'spell-intro-tour';
    this.cleanupFns = [];
  }

  render(root, next) {
    this.root = root;
    this.next = next;
    this.findConnection();
  }

  findConnection(retries = 20) {
    // Wait for a connection line to appear
    const line = document.querySelector('.connection-line');
    if (!line) {
      if (retries > 0) setTimeout(() => this.findConnection(retries - 1), 200);
      else this.next(); // skip if no connection
      return;
    }

    // Also wait for the FAB to be visible
    const fab = document.querySelector('.mint-spell-fab');
    if (!fab || fab.style.display === 'none') {
      if (retries > 0) setTimeout(() => this.findConnection(retries - 1), 200);
      else this.next();
      return;
    }
    this.showStep(fab);
  }

  showStep(fab) {
    // Highlight FAB
    fab.classList.add('st-onboarding-highlight');
    this.cleanupFns.push(() => fab.classList.remove('st-onboarding-highlight'));

    // Position card
    const rect = fab.getBoundingClientRect();
    const card = this.makeCard(rect);
    card.querySelector('.st-onboard-next').addEventListener('click', () => {
      this.cleanup();
      this.next();
    });
  }

  makeCard(rect) {
    const overlay = document.createElement('div');
    overlay.className = 'st-onboard-overlay no-bg';
    this.root.appendChild(overlay);
    this.cleanupFns.push(() => overlay.remove());

    const card = document.createElement('div');
    card.className = 'st-onboard-card';
    const margin = 12;
    let top = rect.top - 220; // Position above the FAB
    let left = rect.left - 340;

    card.style.position = 'fixed';
    card.style.top = `${Math.max(20, top)}px`;
    card.style.left = `${Math.max(20, left)}px`;
    card.style.zIndex = 10000;
    card.innerHTML = `
      <h2>You've made a Spell!</h2>
      <p>Connecting tools like this creates a reusable workflow, or a <b>Spell</b>. You can save this by selecting the tools and clicking the <b>Mint Spell</b> button.</p>
      <div class="st-onboard-actions" style="justify-content:flex-end;"><button class="st-onboard-next">Got it!</button></div>
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