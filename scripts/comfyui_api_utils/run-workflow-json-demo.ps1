# PowerShell script to run the workflow JSON demo
#
# This script runs demo-workflow-json.js with optional workflow name parameter
#
# Usage:
#   .\run-workflow-json-demo.ps1 [workflow-name]
#
# Example:
#   .\run-workflow-json-demo.ps1 text2img

param (
    [string]$workflowName = ""
)

Write-Host "Running ComfyUI Workflow JSON Demo..." -ForegroundColor Cyan

if ($workflowName) {
    Write-Host "Fetching details for workflow: $workflowName" -ForegroundColor Yellow
    node demo-workflow-json.js $workflowName
} else {
    Write-Host "Fetching details for first available workflow" -ForegroundColor Yellow
    node demo-workflow-json.js
}

Write-Host "Demo completed. Check the 'workflow-jsons' directory for output files." -ForegroundColor Green 