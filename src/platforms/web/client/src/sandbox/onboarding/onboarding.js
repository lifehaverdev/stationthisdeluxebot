/**
 * StationThis Web Onboarding Module
 * Orchestrates the onboarding flow inside the Sandbox.
 * Progress is temporarily stored in localStorage under 'st_onboarding' for local testing.
 * This file should be imported by sandbox/index.js.
 */

import ValuePropStep from './steps/valuePropStep.js';
import UserTypeStep from './steps/userTypeStep.js';
import AccountDropdownStep from './steps/accountDropdownStep.js';
import BuyPointsModalStep from './steps/buyPointsModalStep.js';
import WorkspaceTourStep from './steps/workspaceTourStep.js';
import ToolWindowStep from './steps/toolWindowStep.js';

// Persistence is disabled for testing so onboarding appears on every reload.

const DEFAULT_STATE = { current: 0 };

function readState() {
  return { ...DEFAULT_STATE };
}

function writeState() {
  /* no-op while persistence disabled */
}

class OnboardingEngine {
  constructor(steps) {
    this.steps = steps;
    this.state = readState();
    this.root = null;
  }

  begin() {
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

    // End the onboarding immediately when the user chooses to skip.
    const skip = () => {
      this.finish();
    };
    // clear root before rendering next step
    this.root.innerHTML = '';
    step.render(this.root, next, skip);
  }

  finish() {
    if (this.root) this.root.remove();
    this.root = null;
    window.dispatchEvent(new CustomEvent('onboarding:complete'));
  }
}

const steps = [new ValuePropStep(), new UserTypeStep(), new AccountDropdownStep(), new BuyPointsModalStep(), new WorkspaceTourStep(), new ToolWindowStep()];
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