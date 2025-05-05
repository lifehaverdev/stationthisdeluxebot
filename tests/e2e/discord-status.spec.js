// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Discord Status Command E2E Test
 * 
 * This test demonstrates the Discord /status command 
 * by simulating the interaction in a Discord-like UI.
 */
test('Discord status command should display bot status information', async ({ page }) => {
  // Load the Discord test harness page
  await page.goto('http://localhost:4000/tests/discord-test-harness');
  
  // Wait for the Discord interface to load
  await page.waitForSelector('.discord-interface', { state: 'visible' });
  
  // Type the status command in the command input
  await page.click('.command-input');
  await page.fill('.command-input', '/status');
  
  // Submit the command
  await page.press('.command-input', 'Enter');
  
  // Wait for the response
  await page.waitForSelector('.status-embed', { state: 'visible' });
  
  // Verify status embed contains expected information
  const embedTitle = await page.textContent('.status-embed .embed-title');
  expect(embedTitle).toContain('StationThis Bot Status');
  
  // Check for uptime information
  const uptimeField = await page.textContent('.status-embed .field-uptime');
  expect(uptimeField).toBeTruthy();
  
  // Check for start time information
  const startTimeField = await page.textContent('.status-embed .field-start-time');
  expect(startTimeField).toBeTruthy();
  
  // Take a screenshot of the status command response
  await page.screenshot({ 
    path: 'test-results/discord-status-command.png',
    fullPage: false
  });
});

// This is a mock test for demonstration purposes
// In a real implementation, we would need a Discord test harness
// that can interact with the Discord bot directly
test.skip('Actual Discord bot should respond to status command', async ({ page }) => {
  // These tests would require an actual Discord API test harness
  // Such a test would simulate the Discord API interaction
  await expect(true).toBeTruthy();
}); 