# StationThis E2E Testing with Playwright

This directory contains end-to-end tests for the StationThis web platform using Playwright.

## Setup

1. Ensure Playwright is installed:
   ```bash
   npm install
   npx playwright install
   ```

2. To run tests:
   ```bash
   npm run test:e2e
   ```

3. To run tests with UI mode (for visual debugging):
   ```bash
   npm run test:e2e:ui
   ```

4. To run tests in debug mode:
   ```bash
   npm run test:e2e:debug
   ```

## Test Structure

- All test files should use the format `*.spec.js` or `*.spec.ts`
- Each component or feature should have its own test file
- Follow the demo-first approach from our [Testing Protocol](/plans/web/testing_protocol.md)

## Creating Tests

1. Create a new file in this directory named after the component/feature you're testing
2. Import Playwright test utilities:
   ```javascript
   const { test, expect } = require('@playwright/test');
   ```
3. Structure your tests to demonstrate real user behavior
4. Include screenshots or video recording
5. Verify both visual and functional aspects

## Example

```javascript
test('user can interact with canvas', async ({ page }) => {
  await page.goto('/');
  await page.click('#canvas-element');
  await expect(page.locator('.menu')).toBeVisible();
  await page.screenshot({ path: 'test-results/canvas-menu.png' });
});
```

## CI Integration

Tests are automatically run in CI. Videos and screenshots are saved as artifacts.

## Resources

- [Playwright Documentation](https://playwright.dev/docs/intro)
- [StationThis Testing Protocol](/plans/web/testing_protocol.md) 