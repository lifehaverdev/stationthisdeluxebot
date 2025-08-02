export default class BuyPointsModalStep {
  constructor() {
    this.id = 'buy-points-modal';
    this.cleanupFns = [];
  }

  render(root, next, skip) {
    // Ensure the Get More Points link exists
    const waitForLink = () => {
      const link = document.querySelector('[data-action="get-more-points"]');
      if (!link) {
        if (!this._retries) this._retries = 0;
        if (this._retries++ < 20) {
          setTimeout(waitForLink, 150);
          return;
        }
        next();
        return;
      }
      this.showStep(link, root, next);
    };
    waitForLink();
  }

  showStep(link, root, next) {
    // Click the link to open modal
    link.click();

    const waitForModal = () => {
      const modal = document.getElementById('buy-points-modal');
      if (!modal || modal.style.display === 'none') {
        if (!this._modalRetries) this._modalRetries = 0;
        if (this._modalRetries++ < 20) {
          setTimeout(waitForModal, 150);
          return;
        }
        next();
        return;
      }
      this.renderOverlay(modal, root, next);
    };
    waitForModal();
  }

  renderOverlay(modal, root, next) {
    // Create transparent overlay so modal remains clickable
    const overlay = document.createElement('div');
    overlay.className = 'st-onboard-overlay no-bg';
    root.appendChild(overlay);

    const card = document.createElement('div');
    card.className = 'st-onboard-card';
    card.style.position = 'fixed';
    card.style.top = '50%';
    card.style.left = '50%';
    card.style.transform = 'translate(-50%, -50%)';
    card.style.zIndex = 10000;
    card.innerHTML = `
      <h2>Buying Points</h2>
      <p>Here you can purchase Points with crypto or NFTs. Follow the steps, sign the transactions, and your balance updates automatically.</p>
      <div class="st-onboard-actions" style="justify-content:flex-end;">
        <button class="st-onboard-next">Next</button>
      </div>
    `;
    root.appendChild(card);

    card.querySelector('.st-onboard-next').addEventListener('click', () => {
      this.cleanup(modal);
      next();
    }, { once: true });
  }

  cleanup(modal) {
    // Close modal if still open
    if (modal && modal.style.display !== 'none') {
      const closeBtn = modal.querySelector('.modal-close-btn');
      if (closeBtn) closeBtn.click();
      else modal.style.display = 'none';
    }
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
  }
} 