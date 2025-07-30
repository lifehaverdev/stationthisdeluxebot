/**
 * StationThis Web Onboarding Module
 * Orchestrates the onboarding flow inside the Sandbox.
 * Progress is temporarily stored in localStorage under 'st_onboarding' for local testing.
 * This file should be imported by sandbox/index.js.
 */

import ValuePropStep from './steps/valuePropStep.js';
import UserTypeStep from './steps/userTypeStep.js';
import WalletConnectStep from './steps/walletConnectStep.js';

const STORAGE_KEY = 'st_onboarding';
const DEFAULT_STATE = { current: 0, complete: false };

function readState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { ...DEFAULT_STATE };
  } catch (_) {
    return { ...DEFAULT_STATE };
  }
}

function writeState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

class OnboardingEngine {
  constructor(steps) {
    this.steps = steps;
    this.state = readState();
    this.root = null;
  }

  begin() {
    if (this.state.complete) return;
    if (this.root) return; // already running
    this.root = document.createElement('div');
    this.root.className = 'st-onboard-root';
    document.body.appendChild(this.root);
    this.runStep();
  }

  runStep() {
    if (this.state.current >= this.steps.length) {
      this.finish();
      return;
    }
    const step = this.steps[this.state.current];
    const next = () => {
      this.state.current += 1;
      writeState(this.state);
      this.runStep();
    };
    const skip = next; // same behavior for now
    // clear root before rendering next step
    this.root.innerHTML = '';
    step.render(this.root, next, skip);
  }

  finish() {
    this.state.complete = true;
    writeState(this.state);
    if (this.root) this.root.remove();
    this.root = null;
    window.dispatchEvent(new CustomEvent('onboarding:complete'));
  }
}

const steps = [new ValuePropStep(), new UserTypeStep(), new WalletConnectStep()];
const engine = new OnboardingEngine(steps);

export function show() {
  engine.begin();
}

// Auto-start after DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => engine.begin());
} else {
  // DOM already ready
  engine.begin();
} 