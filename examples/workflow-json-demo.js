/**
 * Workflow JSON Demonstration Script
 * 
 * This script demonstrates how to use the enhanced WorkflowsService and ComfyUIService
 * to retrieve, parse and analyze the JSON contents of ComfyUI workflows.
 */

const WorkflowsService = require('../src/core/services/workflows');
const ComfyUIService = require('../src/core/services/comfyui');
require('dotenv').config();

/**
 * Display workflow JSON information
 */
async function demonstrateWorkflowJSON() {
  console.log('=== ComfyUI Workflow JSON Demo ===');
  
  try {
    // Initialize services
    const workflowsService = new WorkflowsService({
      logger: {
        info: (msg) => console.log(`[INFO] ${msg}`),
        warn: (msg) => console.warn(`[WARN] ${msg}`),
        error: (msg) => console.error(`[ERROR] ${msg}`)
      }
    });
    
    const comfyService = new ComfyUIService();
    
    // First, fetch all workflows to populate cache
    console.log('\n1. Fetching all workflows...');
    await workflowsService.initialize();
    const workflows = await workflowsService.getWorkflows();
    console.log(`   Found ${workflows.length} workflows`);
    
    // Display basic workflow information
    console.log('\n2. Available workflows:');
    workflows.forEach((workflow, index) => {
      console.log(`   ${index+1}. ${workflow.name} (${workflow.id})`);
    });
    
    // Choose a workflow to analyze
    if (workflows.length === 0) {
      console.log('No workflows available to analyze.');
      return;
    }
    
    const targetWorkflow = workflows[0]; // Use the first workflow for demonstration
    console.log(`\n3. Analyzing workflow: ${targetWorkflow.name}`);
    
    // Get workflow JSON content
    console.log('\n   Fetching workflow JSON content...');
    const workflowJson = await workflowsService.getWorkflowJson(targetWorkflow.name);
    
    if (!workflowJson) {
      console.log('   No JSON content available for this workflow.');
      return;
    }
    
    // Parse and analyze the workflow nodes
    const nodeAnalysis = workflowsService.parseWorkflowNodes(workflowJson);
    
    console.log(`\n4. Workflow structure analysis for "${targetWorkflow.name}":`);
    console.log(`   - Total nodes: ${nodeAnalysis.nodeCount}`);
    console.log('   - Node types:');
    Object.entries(nodeAnalysis.nodeTypes).forEach(([type, count]) => {
      console.log(`     * ${type}: ${count}`);
    });
    
    // Display input nodes (important for understanding workflow parameters)
    console.log('\n5. Input nodes (parameters that can be modified):');
    nodeAnalysis.inputNodes.forEach((node, idx) => {
      console.log(`   ${idx+1}. ${node.type} (${node.id}):`);
      Object.entries(node.inputs).forEach(([inputName, inputValue]) => {
        const displayValue = typeof inputValue === 'object' 
          ? JSON.stringify(inputValue).substring(0, 50) + '...'
          : inputValue;
        console.log(`      - ${inputName}: ${displayValue}`);
      });
    });
    
    // Display output nodes
    console.log('\n6. Output nodes:');
    nodeAnalysis.outputNodes.forEach((node, idx) => {
      console.log(`   ${idx+1}. ${node.type} (${node.id})`);
    });
    
    // Demonstrate direct API usage via ComfyUIService
    console.log('\n7. Direct API usage example:');
    if (targetWorkflow.apiData && targetWorkflow.apiData.latest_version_id) {
      console.log(`   Getting workflow version using ComfyUIService...`);
      const versionId = targetWorkflow.apiData.latest_version_id;
      const workflowVersion = await comfyService.getWorkflowVersion(versionId);
      
      console.log(`   Workflow version info:`);
      console.log(`   - Version ID: ${workflowVersion.id}`);
      console.log(`   - Created: ${workflowVersion.created_at}`);
      console.log(`   - API spec available: ${workflowVersion.api ? 'Yes' : 'No'}`);
    }
    
    console.log('\n=== Demo completed successfully ===');
  } catch (error) {
    console.error('Demo failed with error:', error);
  }
}

// Run the demonstration
demonstrateWorkflowJSON(); 