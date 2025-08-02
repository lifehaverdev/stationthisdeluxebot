export default class AccountDropdownStep {
  constructor() {
    this.id = 'account-dropdown';
    this.cleanupFns = [];
  }

  render(root, next, skip) {
    const waitForBtn = () => {
      const btn = document.querySelector('.account-web3-btn');
      if (!btn) {
        // Wait a bit longer for AccountDropdown to mount
        if (!this._waitRetries) this._waitRetries = 0;
        if (this._waitRetries++ < 20) {
          setTimeout(waitForBtn, 150);
          return;
        }
        // Give up and continue onboarding
        next();
        return;
      }
      this.showStep(btn, root, next);
    };
    waitForBtn();
  }

  showStep(btn, root, next) {
    // Ensure dropdown open via click, but delay slightly so AccountDropdown attachEvents completes
    setTimeout(() => {
      if (btn.getAttribute('aria-expanded') !== 'true') {
        btn.click();
      }
    }, 50);

    const menu = btn.parentElement.querySelector('.account-dropdown-menu');

    // Cleanup: close menu if still open
    this.cleanupFns.push(() => {
      if (menu) menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    });

    btn.classList.add('st-onboarding-highlight');
    this.cleanupFns.push(() => btn.classList.remove('st-onboarding-highlight'));

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
      <h2>Your Account</h2>
      <p>This dropdown shows your wallet address, points balance, referral vaults and more. History, settings & buying more points are here too.</p>
      <div class="st-onboard-actions" style="justify-content:flex-end;">
        <button class="st-onboard-next">Next</button>
      </div>
    `;
    root.appendChild(card);

    card.querySelector('.st-onboard-next').addEventListener('click', () => {
      this.cleanup();
      next();
    }, { once: true });
  }

  cleanup() {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
  }
} 