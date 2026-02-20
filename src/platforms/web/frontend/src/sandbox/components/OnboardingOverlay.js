import { Component, h } from '@monygroupcorp/microact';
import { eventBus } from '@monygroupcorp/microact';

const STORAGE_KEY = 'st_onboarding';

/**
 * OnboardingOverlay — 6-step onboarding flow rendered as a microact overlay.
 *
 * Delegates step rendering to the old vanilla step classes (loaded at runtime
 * from /sandbox/onboarding/) which render imperatively into a container div.
 * This wrapper manages lifecycle, step progression, and persistence.
 *
 * Props:
 *   onComplete — called when onboarding finishes
 */
export class OnboardingOverlay extends Component {
  constructor(props) {
    super(props);
    this.state = { step: 0, ready: false, finished: false };
    this._steps = [];
    this._containerRef = null;
  }

  async didMount() {
    // Load step modules
    try {
      const stepPaths = [
        'onboarding/steps/valuePropStep.js',
        'onboarding/steps/userTypeStep.js',
        'onboarding/steps/accountDropdownStep.js',
        'onboarding/steps/buyPointsModalStep.js',
        'onboarding/steps/workspaceTourStep.js',
        'onboarding/steps/toolsBarStep.js',
      ];
      const modules = await Promise.all(
        stepPaths.map(p => import(/* @vite-ignore */ '/sandbox/' + p))
      );
      this._steps = modules.map(m => new (m.default)());
      this.setState({ ready: true });
      this._renderCurrentStep();
    } catch (e) {
      console.error('[Onboarding] Failed to load steps:', e);
      this._finish();
    }
  }

  _renderCurrentStep() {
    const { step } = this.state;
    if (step >= this._steps.length || !this._containerRef) {
      this._finish();
      return;
    }
    this._containerRef.innerHTML = '';
    this._steps[step].render(
      this._containerRef,
      () => this._next(),
      () => this._finish()
    );
  }

  _next() {
    const next = this.state.step + 1;
    if (next >= this._steps.length) {
      this._finish();
      return;
    }
    this.setState({ step: next });
    this._renderCurrentStep();
  }

  _finish() {
    this.setState({ finished: true });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ completed: true })); } catch {}
    eventBus.emit('onboarding:complete');
    this.props.onComplete?.();
  }

  static shouldShow() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data.completed) return false;
      }
    } catch {}
    return true;
  }

  static get styles() {
    return `
      .onboard-overlay {
        position: fixed; inset: 0; z-index: 2000;
        background: rgba(0,0,0,0.85);
        display: flex; align-items: center; justify-content: center;
      }
      .onboard-container {
        max-width: 600px; width: 90%; max-height: 85vh; overflow-y: auto;
      }
    `;
  }

  render() {
    if (this.state.finished) return null;

    return h('div', { className: 'onboard-overlay' },
      h('div', {
        className: 'onboard-container',
        ref: (el) => { this._containerRef = el; }
      },
        !this.state.ready ? h('div', { style: 'color:#666;text-align:center' }, 'Loading...') : null
      )
    );
  }
}
