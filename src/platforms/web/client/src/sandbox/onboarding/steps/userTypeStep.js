export default class UserTypeStep {
  constructor() {
    this.id = 'user-type';
  }

  render(root, next, skip) {
    root.innerHTML = `
      <div class="st-onboard-overlay">
        <div class="st-onboard-card">
          <h2>Your creative journey</h2>
          <p>Tell us what kind of user you are so we can tailor your experience.</p>
          <div class="st-onboard-selections">
            <button data-type="pro">🎨 Professional Artist</button>
            <button data-type="hobby">🖌️ Hobbyist</button>
            <button data-type="enthusiast">🚀 StationThis Enthusiast</button>
            <button data-type="noob">✨ Total Noob</button>
          </div>
          <div class="st-onboard-actions">
            <button class="st-onboard-skip">Skip</button>
          </div>
        </div>
      </div>`;

    // attach listeners on selection buttons
    root.querySelectorAll('.st-onboard-selections button').forEach(btn => {
      btn.addEventListener('click', () => {
        const selected = btn.dataset.type;
        // store locally; later ship to backend
        localStorage.setItem('st_user_type', selected);
        next();
      }, { once: true });
    });

    root.querySelector('.st-onboard-skip').addEventListener('click', skip, { once: true });
  }
} 