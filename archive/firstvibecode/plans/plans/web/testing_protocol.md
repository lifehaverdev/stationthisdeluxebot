🧠 AGENT INITIATION PROTOCOL: DEMO-FIRST TESTING STRATEGY USING PLAYWRIGHT

🗂️ META
Title: Testing Protocol for StationThis Web (Playwright Integration)
Date: 2025-04-29
Author: system-agent
Intent: Establish testing rules, behaviors, and expectations using Playwright
Type: architectural-testing-rule
Target: Web platform (canvas system and frontend workflows)
Status: IMPLEMENTED ✅ (See docs/handoffs/HANDOFF-PHASE4-WEB-PLAYWRIGHT-TESTING.md)

🎯 PRIMARY GOAL:
Adopt a demonstration-oriented, real-interaction testing strategy for the StationThis Web frontend using [Playwright](https://playwright.dev). All UI development should proceed **with tests that simulate real user behavior** and can be run headlessly or visually.

---

## 🎮 Philosophy: Demonstration-Driven Development
- Testing is not just about coverage — it's about confidence.
- Features should ship with **proof of behavior** in the form of an automated, visual test.
- Tests double as **documentation** for agent workflows and human understanding.

---

## 🔧 Playwright Benefits
- Full browser automation across Chromium, Firefox, and WebKit
- Headless + visible test runs
- Simulation of real user actions: clicks, taps, drag/drop, keyboard input
- Screenshot and video recording
- Works seamlessly with Vite and native JavaScript frontends

---

## 🛠️ Required Setup
- Install Playwright:
  ```bash
  npm install --save-dev playwright
  npx playwright install
  ```
- Configure test runner in `playwright.config.js`
- Create tests in `/tests/` directory using `.spec.js` or `.spec.ts`

---

## 📏 Testing Rules
1. **All UI Components Must Be Playwright-Tested**
   - Draggable tiles, HUD displays, auth modal, workflow launches, etc.
2. **Every agent-built feature must ship with a `.spec.js` file**
   - Name must match the component or feature it covers
3. **Canvas interactions must be tested in headless and visual mode**
   - e.g., click water → open menu → choose workflow → spawn tile
4. **Test files must be runnable with a single `npm run test:e2e`**
5. **Each spec should include at least one screenshot or state validation**
6. **Video capture must be enabled on CI/agent runs**
   - Optional: attach to handoff file for review

---

## 📦 Future Automation Goals
- Hook Playwright into CI for regression tests
- Enable agents to auto-generate video demos of features
- Use tests as the canonical source of behavior truth for frontend agents

---

## 🚀 Implementation Notes
- Initial implementation focused on workspace, HUD, and tile interactions
- Created isolated test server that matches actual UI structure
- Added support for screenshots, videos, and debug tools
- See full implementation details in handoff document

---

📁 Save this file to:
  `/plans/web/testing_protocol.md`

---

📦 FUTURE USE
This document becomes a required enforcement layer. All agents submitting UI work must reference this protocol and provide working Playwright demonstrations. No major UI change is considered "complete" without it. 