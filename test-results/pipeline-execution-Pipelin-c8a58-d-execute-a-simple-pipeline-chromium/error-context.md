# Test info

- Name: Pipeline Execution Demonstration >> should create and execute a simple pipeline
- Location: C:\Users\Lifehaver\Desktop\stationthisdeluxebot\tests\e2e\pipeline-execution.spec.js:28:3

# Error details

```
Error: locator.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for locator('.add-tile-button')

    at C:\Users\Lifehaver\Desktop\stationthisdeluxebot\tests\e2e\pipeline-execution.spec.js:33:44
```

# Page snapshot

```yaml
- text: EXP 35% POINTS 75/100 CHARGE      Tuesday 01:41 PM
- list:
  - listitem:
    - link "Home":
      - /url: index.html
  - listitem:
    - link "Generate":
      - /url: generation.html
- text: " (0,0)  (1,0)  Commander Alex Level 7 No workflows available  Credits: 4,250  Energy: 75%  Computing: 42%  StationThis Control Online  v1.0.0 >"
- textbox "Enter command..."
- button ""
- text: " Uptime: 0h 0m 57s"
- heading "Connect to StationThis" [level=2]
- button "×"
- button "API Key"
- button "Connect Wallet"
- button "Guest Access"
- text: API Key
- textbox "API Key"
- text: Enter the API key provided for accessing StationThis.
- button "Connect"
- paragraph: Connect your wallet to access StationThis with your blockchain credentials.
- button "Connect Wallet"
- text: You'll be asked to sign a message to verify wallet ownership.
- paragraph: Access StationThis without logging in. Limited functionality available.
- button "Continue as Guest"
- text: Guest sessions expire after 24 hours and have limited capabilities.
```

# Test source

```ts
   1 | // @ts-check
   2 | const { test, expect } = require('@playwright/test');
   3 |
   4 | /**
   5 |  * Pipeline Execution Demonstration Test
   6 |  * 
   7 |  * This test demonstrates the pipeline execution functionality of the StationThis web platform.
   8 |  * It creates workflow tiles, connects them, and verifies that pipeline execution works correctly.
   9 |  */
   10 |
   11 | test.describe('Pipeline Execution Demonstration', () => {
   12 |   test.beforeEach(async ({ page }) => {
   13 |     // Navigate to the application
   14 |     await page.goto('/');
   15 |     
   16 |     // Wait for the page to load
   17 |     await page.waitForLoadState('networkidle');
   18 |     
   19 |     // Handle authentication modal if it appears
   20 |     const authModal = page.locator('.auth-modal');
   21 |     if (await authModal.isVisible()) {
   22 |       // Click on the "Continue as Guest" option (assuming this exists)
   23 |       await page.locator('.guest-access-button').click();
   24 |       await expect(authModal).not.toBeVisible();
   25 |     }
   26 |   });
   27 |
   28 |   test('should create and execute a simple pipeline', async ({ page }) => {
   29 |     // Take a screenshot of the initial canvas
   30 |     await page.screenshot({ path: 'test-results/pipeline-demo-initial.png' });
   31 |     
   32 |     // Add first workflow tile (e.g., an image generator)
>  33 |     await page.locator('.add-tile-button').click();
      |                                            ^ Error: locator.click: Test timeout of 60000ms exceeded.
   34 |     await page.locator('.workflow-type-list').locator('text=Image Generator').click();
   35 |     
   36 |     // Wait for the first tile to appear
   37 |     const firstTile = page.locator('.workflow-tile').first();
   38 |     await expect(firstTile).toBeVisible();
   39 |     
   40 |     // Add second workflow tile (e.g., an upscaler)
   41 |     await page.locator('.add-tile-button').click();
   42 |     await page.locator('.workflow-type-list').locator('text=Image Upscaler').click();
   43 |     
   44 |     // Wait for the second tile to appear
   45 |     const tiles = page.locator('.workflow-tile');
   46 |     await expect(tiles).toHaveCount(2);
   47 |     const secondTile = tiles.nth(1);
   48 |     
   49 |     // Position the tiles appropriately
   50 |     // First tile - drag to left side
   51 |     const firstTileBound = await firstTile.boundingBox();
   52 |     if (firstTileBound) {
   53 |       await page.mouse.move(
   54 |         firstTileBound.x + firstTileBound.width / 2,
   55 |         firstTileBound.y + 20
   56 |       );
   57 |       await page.mouse.down();
   58 |       await page.mouse.move(
   59 |         200,
   60 |         300
   61 |       );
   62 |       await page.mouse.up();
   63 |     }
   64 |     
   65 |     // Second tile - drag to right side
   66 |     const secondTileBound = await secondTile.boundingBox();
   67 |     if (secondTileBound) {
   68 |       await page.mouse.move(
   69 |         secondTileBound.x + secondTileBound.width / 2,
   70 |         secondTileBound.y + 20
   71 |       );
   72 |       await page.mouse.down();
   73 |       await page.mouse.move(
   74 |         500,
   75 |         300
   76 |       );
   77 |       await page.mouse.up();
   78 |     }
   79 |     
   80 |     // Create a connection between the tiles
   81 |     // First, locate the output port on the first tile
   82 |     const outputPort = firstTile.locator('.output-port').first();
   83 |     await expect(outputPort).toBeVisible();
   84 |     
   85 |     // Next, locate the input port on the second tile
   86 |     const inputPort = secondTile.locator('.input-port').first();
   87 |     await expect(inputPort).toBeVisible();
   88 |     
   89 |     // Create the connection by dragging from output to input port
   90 |     const outputPortBound = await outputPort.boundingBox();
   91 |     const inputPortBound = await inputPort.boundingBox();
   92 |     
   93 |     if (outputPortBound && inputPortBound) {
   94 |       await page.mouse.move(
   95 |         outputPortBound.x + outputPortBound.width / 2,
   96 |         outputPortBound.y + outputPortBound.height / 2
   97 |       );
   98 |       await page.mouse.down();
   99 |       await page.mouse.move(
  100 |         inputPortBound.x + inputPortBound.width / 2,
  101 |         inputPortBound.y + inputPortBound.height / 2
  102 |       );
  103 |       await page.mouse.up();
  104 |     }
  105 |     
  106 |     // Take a screenshot of the connected tiles
  107 |     await page.screenshot({ path: 'test-results/pipeline-demo-connected.png' });
  108 |     
  109 |     // Verify that a connection was created
  110 |     const connection = page.locator('.workflow-connection');
  111 |     await expect(connection).toBeVisible();
  112 |     
  113 |     // Configure the first tile (add a simple prompt)
  114 |     await firstTile.click();
  115 |     const promptInput = page.locator('.workflow-config-panel').locator('textarea[placeholder="Enter prompt..."]');
  116 |     await promptInput.fill('a beautiful landscape');
  117 |     await page.locator('.save-config-button').click();
  118 |     
  119 |     // Execute the pipeline by right-clicking the second tile and selecting "Run Pipeline"
  120 |     await secondTile.click({ button: 'right' });
  121 |     await page.locator('text=Run Pipeline').click();
  122 |     
  123 |     // Wait for pipeline execution to start
  124 |     await expect(page.locator('.pipeline-status-executing')).toBeVisible();
  125 |     
  126 |     // Take a screenshot of the executing pipeline
  127 |     await page.screenshot({ path: 'test-results/pipeline-demo-executing.png' });
  128 |     
  129 |     // Wait for pipeline execution to complete (with a generous timeout)
  130 |     await expect(page.locator('.pipeline-status-complete')).toBeVisible({ timeout: 30000 });
  131 |     
  132 |     // Take a screenshot of the completed pipeline
  133 |     await page.screenshot({ path: 'test-results/pipeline-demo-complete.png' });
```