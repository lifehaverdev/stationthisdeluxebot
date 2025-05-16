# PowerShell script to run the ComfyUI Deploy API demo
# Usage: .\run-comfyui-demo.ps1 -ApiKey "your-api-key" [-ApiUrl "https://custom-api-url"]

param (
    [Parameter(Mandatory=$true)]
    [string]$ApiKey,
    
    [Parameter(Mandatory=$false)]
    [string]$ApiUrl = "https://api.comfydeploy.com"
)

# Set environment variables
$env:COMFY_DEPLOY_API_KEY = $ApiKey
$env:COMFY_DEPLOY_API_URL = $ApiUrl

Write-Host "Running ComfyUI Deploy API demo with:"
Write-Host "API URL: $ApiUrl"
Write-Host "API Key: $($ApiKey.Substring(0, 4))...$($ApiKey.Substring($ApiKey.Length - 4))" -ForegroundColor Yellow
Write-Host ""

# Run the demo script
Write-Host "Starting demo..." -ForegroundColor Cyan
node demo-comfyui-api.js

# Clear sensitive environment variables
$env:COMFY_DEPLOY_API_KEY = $null
$env:COMFY_DEPLOY_API_URL = $null

Write-Host ""
Write-Host "Demo complete. Environment variables cleared." -ForegroundColor Green 