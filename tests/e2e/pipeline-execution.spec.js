// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Pipeline Execution Demonstration Test
 * 
 * This test demonstrates the pipeline execution functionality of the StationThis web platform.
 * It creates workflow tiles, connects them, and verifies that pipeline execution works correctly.
 */

test.describe('Pipeline Execution Demonstration', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the application
    await page.goto('/');
    
    // Wait for the page to load
    await page.waitForLoadState('networkidle');
    
    // Handle authentication modal if it appears
    const authModal = page.locator('.auth-modal');
    if (await authModal.isVisible()) {
      // Click on the "Continue as Guest" option (assuming this exists)
      await page.locator('.guest-access-button').click();
      await expect(authModal).not.toBeVisible();
    }
  });

  test('should create and execute a simple pipeline', async ({ page }) => {
    // Take a screenshot of the initial canvas
    await page.screenshot({ path: 'test-results/pipeline-demo-initial.png' });
    
    // Add first workflow tile (e.g., an image generator)
    await page.locator('.add-tile-button').click();
    await page.locator('.workflow-type-list').locator('text=Image Generator').click();
    
    // Wait for the first tile to appear
    const firstTile = page.locator('.workflow-tile').first();
    await expect(firstTile).toBeVisible();
    
    // Add second workflow tile (e.g., an upscaler)
    await page.locator('.add-tile-button').click();
    await page.locator('.workflow-type-list').locator('text=Image Upscaler').click();
    
    // Wait for the second tile to appear
    const tiles = page.locator('.workflow-tile');
    await expect(tiles).toHaveCount(2);
    const secondTile = tiles.nth(1);
    
    // Position the tiles appropriately
    // First tile - drag to left side
    const firstTileBound = await firstTile.boundingBox();
    if (firstTileBound) {
      await page.mouse.move(
        firstTileBound.x + firstTileBound.width / 2,
        firstTileBound.y + 20
      );
      await page.mouse.down();
      await page.mouse.move(
        200,
        300
      );
      await page.mouse.up();
    }
    
    // Second tile - drag to right side
    const secondTileBound = await secondTile.boundingBox();
    if (secondTileBound) {
      await page.mouse.move(
        secondTileBound.x + secondTileBound.width / 2,
        secondTileBound.y + 20
      );
      await page.mouse.down();
      await page.mouse.move(
        500,
        300
      );
      await page.mouse.up();
    }
    
    // Create a connection between the tiles
    // First, locate the output port on the first tile
    const outputPort = firstTile.locator('.output-port').first();
    await expect(outputPort).toBeVisible();
    
    // Next, locate the input port on the second tile
    const inputPort = secondTile.locator('.input-port').first();
    await expect(inputPort).toBeVisible();
    
    // Create the connection by dragging from output to input port
    const outputPortBound = await outputPort.boundingBox();
    const inputPortBound = await inputPort.boundingBox();
    
    if (outputPortBound && inputPortBound) {
      await page.mouse.move(
        outputPortBound.x + outputPortBound.width / 2,
        outputPortBound.y + outputPortBound.height / 2
      );
      await page.mouse.down();
      await page.mouse.move(
        inputPortBound.x + inputPortBound.width / 2,
        inputPortBound.y + inputPortBound.height / 2
      );
      await page.mouse.up();
    }
    
    // Take a screenshot of the connected tiles
    await page.screenshot({ path: 'test-results/pipeline-demo-connected.png' });
    
    // Verify that a connection was created
    const connection = page.locator('.workflow-connection');
    await expect(connection).toBeVisible();
    
    // Configure the first tile (add a simple prompt)
    await firstTile.click();
    const promptInput = page.locator('.workflow-config-panel').locator('textarea[placeholder="Enter prompt..."]');
    await promptInput.fill('a beautiful landscape');
    await page.locator('.save-config-button').click();
    
    // Execute the pipeline by right-clicking the second tile and selecting "Run Pipeline"
    await secondTile.click({ button: 'right' });
    await page.locator('text=Run Pipeline').click();
    
    // Wait for pipeline execution to start
    await expect(page.locator('.pipeline-status-executing')).toBeVisible();
    
    // Take a screenshot of the executing pipeline
    await page.screenshot({ path: 'test-results/pipeline-demo-executing.png' });
    
    // Wait for pipeline execution to complete (with a generous timeout)
    await expect(page.locator('.pipeline-status-complete')).toBeVisible({ timeout: 30000 });
    
    // Take a screenshot of the completed pipeline
    await page.screenshot({ path: 'test-results/pipeline-demo-complete.png' });
    
    // Verify that both tiles show completed status
    await expect(firstTile.locator('.status-complete')).toBeVisible();
    await expect(secondTile.locator('.status-complete')).toBeVisible();
    
    // Verify the result is visible in the second tile
    await expect(secondTile.locator('.result-preview')).toBeVisible();
    
    // Test saving the pipeline as a template
    await secondTile.click({ button: 'right' });
    await page.locator('text=Save As Template').click();
    
    // Enter a name for the template
    await page.locator('.template-name-input').fill('Image Generation Pipeline');
    await page.locator('.save-template-button').click();
    
    // Verify template saving confirmation
    await expect(page.locator('text=Template saved successfully')).toBeVisible();
    
    // Take a final screenshot
    await page.screenshot({ path: 'test-results/pipeline-demo-template-saved.png' });
  });
}); 