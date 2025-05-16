# StationThis Testing Script for Playwright

# Check for Playwright installation
$playwrightInstalled = npm list -g @playwright/test

if ($playwrightInstalled -match "empty") {
    Write-Host "Installing Playwright..." -ForegroundColor Yellow
    npm install -g @playwright/test
    npx playwright install
} else {
    Write-Host "Playwright is already installed." -ForegroundColor Green
}

# Function to display menu
function Show-Menu {
    Write-Host "StationThis Playwright Testing Menu" -ForegroundColor Cyan
    Write-Host "==================================" -ForegroundColor Cyan
    Write-Host "1: Run all tests"
    Write-Host "2: Run tests with UI"
    Write-Host "3: Run tests in debug mode"
    Write-Host "4: Show last report"
    Write-Host "5: Install browsers"
    Write-Host "Q: Quit"
    Write-Host ""
}

# Main menu loop
do {
    Show-Menu
    $choice = Read-Host "Enter your choice"
    
    switch ($choice) {
        '1' {
            Write-Host "Running all tests..." -ForegroundColor Yellow
            npm run test:e2e
        }
        '2' {
            Write-Host "Running tests with UI..." -ForegroundColor Yellow
            npm run test:e2e:ui
        }
        '3' {
            Write-Host "Running tests in debug mode..." -ForegroundColor Yellow
            npm run test:e2e:debug
        }
        '4' {
            Write-Host "Showing last report..." -ForegroundColor Yellow
            npx playwright show-report
        }
        '5' {
            Write-Host "Installing browsers..." -ForegroundColor Yellow
            npx playwright install
        }
        'Q' {
            Write-Host "Exiting..." -ForegroundColor Red
            return
        }
        Default {
            Write-Host "Invalid choice. Please try again." -ForegroundColor Red
        }
    }
    
    Write-Host "Press any key to continue..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    Clear-Host
} while ($true) 