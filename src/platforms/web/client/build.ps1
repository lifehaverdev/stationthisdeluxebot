# PowerShell build script for StationThis web canvas demonstration

Write-Host "Building StationThis web canvas demonstration..." -ForegroundColor Green

# Install dependencies if needed
if (-not (Test-Path -Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install
}

# Build the bundle
Write-Host "Building bundle..." -ForegroundColor Yellow
npm run build

Write-Host "Build complete! Open index.html in your browser to view the demonstration." -ForegroundColor Green 