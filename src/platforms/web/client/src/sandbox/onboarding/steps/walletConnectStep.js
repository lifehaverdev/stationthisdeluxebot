export default class WalletConnectStep {
  constructor() {
    this.id = 'wallet-connect';
  }

  render(root, next, skip) {
    root.innerHTML = `
      <div class="st-onboard-overlay">
        <div class="st-onboard-card">
          <h2>Connect your Wallet</h2>
          <p>StationThis uses on-chain credits (Points) to pay for AI generations. Connect your Ethereum wallet to get started. You can skip and do this later in the Account menu.</p>
          <div class="st-onboard-actions">
            <button class="st-onboard-next">Connect Wallet</button>
            <button class="st-onboard-skip">Skip</button>
          </div>
        </div>
      </div>`;

    const connectBtn = root.querySelector('.st-onboard-next');
    connectBtn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('onboarding:wallet-connect-request'));
      next();
    }, { once: true });

    root.querySelector('.st-onboard-skip').addEventListener('click', skip, { once: true });
  }
} 