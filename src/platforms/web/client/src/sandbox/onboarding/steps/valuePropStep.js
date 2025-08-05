export default class ValuePropStep {
  constructor() {
    this.id = 'value-prop';
  }

  /**
   * Renders the overlay for this step.
   * @param {HTMLElement} root - container element provided by engine
   * @param {Function} next - call when step completed
   * @param {Function} skip - call when user skips
   */
  render(root, next, skip) {
    root.innerHTML = `
      <div class="st-onboard-overlay">
        <div class="st-onboard-card">
          <h2>Welcome to NOEMA</h2>
          <p>Manifest ideas—generate, remix & monetise media across Telegram, Discord & Web Canvas with AI workflows and on-chain credits.</p>
          <div class="st-onboard-actions">
            <button class="st-onboard-next">Next</button>
            <button class="st-onboard-skip">Skip</button>
          </div>
        </div>
      </div>`;

    root.querySelector('.st-onboard-next').addEventListener('click', next, { once: true });
    root.querySelector('.st-onboard-skip').addEventListener('click', skip, { once: true });
  }
} 