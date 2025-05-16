# PowerShell script to run the ComfyUI Deploy workflow execution demo
# Usage: .\run-workflow-demo.ps1 -ApiKey "your-api-key" [-ApiUrl "https://custom-api-url"] [-Workflow "workflow-pattern"] [-Prompt "your prompt"] [-Execute $true]

param (
    [Parameter(Mandatory=$true)]
    [string]$ApiKey,
    
    [Parameter(Mandatory=$false)]
    [string]$ApiUrl = "https://api.comfydeploy.com",
    
    [Parameter(Mandatory=$false)]
    [string]$Workflow = "text2img",
    
    [Parameter(Mandatory=$false)]
    [string]$Prompt = "a beautiful landscape with mountains and a lake, high detail, photorealistic",
    
    [Parameter(Mandatory=$false)]
    [bool]$Execute = $false
)

# Set environment variables
$env:COMFY_DEPLOY_API_KEY = $ApiKey
$env:COMFY_DEPLOY_API_URL = $ApiUrl

Write-Host "Running ComfyUI Deploy workflow execution demo with:"
Write-Host "API URL: $ApiUrl"
Write-Host "API Key: $($ApiKey.Substring(0, 4))...$($ApiKey.Substring($ApiKey.Length - 4))" -ForegroundColor Yellow
Write-Host "Workflow: $Workflow" -ForegroundColor Cyan
Write-Host "Prompt: $Prompt" -ForegroundColor Cyan
Write-Host "Execute: $Execute" -ForegroundColor $(if ($Execute) {"Green"} else {"Yellow"})
Write-Host ""

# Build command arguments
$args = "--workflow=`"$Workflow`" --prompt=`"$Prompt`" --execute=$Execute"

# Run the demo script
Write-Host "Starting workflow execution demo..." -ForegroundColor Cyan
node demo-workflow-execution.js $args

# Clear sensitive environment variables
$env:COMFY_DEPLOY_API_KEY = $null
$env:COMFY_DEPLOY_API_URL = $null

Write-Host ""
Write-Host "Demo complete. Environment variables cleared." -ForegroundColor Green 