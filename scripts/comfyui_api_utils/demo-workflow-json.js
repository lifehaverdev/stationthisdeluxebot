/**
 * Demo script to fetch ComfyUI workflows with their complete JSON structures
 * 
 * This script demonstrates how to:
 * 1. Fetch all available workflows
 * 2. Get detailed workflow information including JSON structure
 * 3. Parse workflow structure to understand nodes and connections
 * 4. Extract and analyze workflow input/output requirements
 */



const WorkflowsService = require('./src/core/services/workflows');
const ComfyUIService = require('./src/core/services/comfyui');

// Utility function to determine node type from inputs
// This now uses the enhanced WorkflowsService to infer node types
function inferNodeType(nodeId, node, workflowsService) {
  // Create a minimal workflow JSON structure containing just this node
  const minimalWorkflow = {
    nodes: {
      [nodeId]: node
    }
  };
  
  // Use the service to parse the node
  const parsedStructure = workflowsService.parseWorkflowStructure(minimalWorkflow);
  
  // Extract the node type from the parsed structure's nodeTypes
  if (parsedStructure.nodeTypes && parsedStructure.nodeTypes.length > 0) {
    return parsedStructure.nodeTypes[0];
  }
  
  // Fallback to the original behavior if the service couldn't determine the type
  if (node.class_type) return node.class_type;
  
  return `Unknown_${nodeId}`;
}

// Main execution function
async function main() {
  try {
    console.log('Starting ComfyUI Workflow Fetch Demo...');
    
    // Initialize services with console.log as logger
    const workflows = new WorkflowsService({ logger: console });
    const comfyui = new ComfyUIService({ logger: console.log });
    
    // Ensure the workflow service is initialized
    await workflows.initialize();
    
    // Get all available workflows
    const allWorkflows = await workflows.getWorkflows();
    console.log(`Found ${allWorkflows.length} workflows`);
    
    // Display workflows summary
    console.log('\nWorkflows Summary:');
    allWorkflows.forEach(workflow => {
      console.log(`- ${workflow.displayName} (${workflow.name})`);
      console.log(`  ID: ${workflow.id}`);
      console.log(`  Deployments: ${workflow.deploymentIds.length}`);
      console.log(`  Inputs: ${workflow.inputs.join(', ') || 'none'}`);
      if (workflow.outputType) {
        console.log(`  Output Type: ${workflow.outputType}`);
      }
      if (workflow.hasLoraLoader !== undefined) {
        console.log(`  Supports Lora: ${workflow.hasLoraLoader ? 'Yes' : 'No'}`);
      }
      console.log('');
    });
    
    // Choose a workflow for detailed analysis (use the first one or specify by name)
    const workflowName = process.argv[2] || (allWorkflows.length > 0 ? allWorkflows[0].name : null);
    
    if (!workflowName) {
      console.log('No workflows available to analyze');
      return;
    }
    
    console.log(`\nFetching detailed information for workflow: ${workflowName}`);
    const workflowWithDetails = await workflows.getWorkflowWithDetails(workflowName);
    
    if (!workflowWithDetails) {
      console.log(`Workflow "${workflowName}" not found`);
      return;
    }
    
    // Get required inputs for the workflow using the enhanced API
    console.log('\n=== WORKFLOW REQUIRED INPUTS ===');
    const requiredInputs = await workflows.getWorkflowRequiredInputs(workflowName);
    if (requiredInputs.length === 0) {
      console.log('No required inputs detected');
    } else {
      console.log(`Found ${requiredInputs.length} required inputs:`);
      requiredInputs.forEach(input => {
        console.log(`- ${input.inputName} (${input.inputType})`);
        if (input.defaultValue !== null) {
          console.log(`  Default: ${JSON.stringify(input.defaultValue).substring(0, 60)}${JSON.stringify(input.defaultValue).length > 60 ? '...' : ''}`);
        }
      });
    }
    
    // Get output type for the workflow
    console.log('\n=== WORKFLOW OUTPUT TYPE ===');
    const outputType = await workflows.getWorkflowOutputType(workflowName);
    console.log(`Workflow produces: ${outputType}`);
    
    // Check if workflow supports lora
    console.log('\n=== LORA SUPPORT ===');
    const hasLoraSupport = await workflows.hasLoraLoaderSupport(workflowName);
    console.log(`Workflow ${hasLoraSupport ? 'supports' : 'does not support'} Lora Trigger system`);
    
    // Create default input payload
    console.log('\n=== DEFAULT INPUT PAYLOAD ===');
    const defaultPayload = await workflows.createDefaultInputPayload(workflowName);
    console.log(JSON.stringify(defaultPayload, null, 2));
    
    // Demonstrate validation
    console.log('\n=== INPUT VALIDATION ===');
    
    // Valid payload (using defaults)
    const validationResult = await workflows.validateInputPayload(workflowName, defaultPayload);
    console.log('Default payload validation result:');
    console.log(JSON.stringify(validationResult, null, 2));
    
    // Invalid payload (missing inputs)
    const incompletePayload = {};
    const invalidResult = await workflows.validateInputPayload(workflowName, incompletePayload);
    console.log('\nIncomplete payload validation result:');
    console.log(JSON.stringify(invalidResult, null, 2));
    
    // Demonstrate merging with user inputs
    console.log('\n=== MERGING WITH USER INPUTS ===');
    const userInputs = {
      // Choose one input to override from the default payload
      ...Object.keys(defaultPayload).length > 0 ? 
        { [Object.keys(defaultPayload)[0]]: 'User provided value' } : 
        { dummy_input: 'No real inputs available' }
    };
    console.log('User inputs:');
    console.log(JSON.stringify(userInputs, null, 2));
    
    const mergedPayload = await workflows.mergeWithDefaultInputs(workflowName, userInputs);
    console.log('\nMerged payload:');
    console.log(JSON.stringify(mergedPayload, null, 2));
    
    // Check if we have the workflow JSON structure
    if (!workflowWithDetails.workflow_json || !workflowWithDetails.workflow_json.nodes) {
      console.log('\nWorkflow JSON structure not available for detailed node analysis');
      return;
    }
    
    // Define nodes variable
    const nodes = workflowWithDetails.workflow_json.nodes;
    
    // Print the raw nodes structure
    console.log('\n=== RAW WORKFLOW NODES STRUCTURE ===');
    console.log('Raw Nodes Object:', JSON.stringify(nodes, null, 2));
    
    // Print all the nodes in detail
    console.log('\n=== WORKFLOW NODES DETAILS ===');
    console.log(`Total nodes found: ${Object.keys(nodes).length}`);
    
    // Print node types summary first
    const nodeTypes = {};
    Object.entries(nodes).forEach(([nodeId, node]) => {
      const type = inferNodeType(nodeId, node, workflows);
      nodeTypes[type] = (nodeTypes[type] || 0) + 1;
    });
    
    console.log('\nNode Types Summary:');
    Object.entries(nodeTypes).forEach(([type, count]) => {
      console.log(`- ${type}: ${count}`);
    });
    
    // Process workflow links to understand connections
    const links = workflowWithDetails.workflow_json.links || [];
    console.log(`\nTotal links: ${links.length}`);
    
    // Create a map of node connections
    const nodeConnections = {};
    links.forEach(link => {
      // Make sure the link is valid and has required fields
      if (Array.isArray(link) && link.length >= 6) {
        // Extract information from the link array
        // Some APIs might return different formats, so we handle that gracefully
        let fromNodeId, toNodeId, linkType;
        
        try {
          fromNodeId = String(link[1]);
          toNodeId = String(link[3]);
          linkType = String(link[5]);
          
          // Skip if any required fields are missing or the nodes don't exist
          if (!fromNodeId || !toNodeId || !linkType || 
              !nodes[fromNodeId] || !nodes[toNodeId]) {
            return;
          }
          
          // Initialize nodeConnections entries if they don't exist
          if (!nodeConnections[fromNodeId]) {
            nodeConnections[fromNodeId] = { outputs: {} };
          }
          if (!nodeConnections[toNodeId]) {
            nodeConnections[toNodeId] = { inputs: {} };
          }
          
          // Track outputs from this node
          if (!nodeConnections[fromNodeId].outputs) {
            nodeConnections[fromNodeId].outputs = {};
          }
          if (!nodeConnections[fromNodeId].outputs[toNodeId]) {
            nodeConnections[fromNodeId].outputs[toNodeId] = [];
          }
          nodeConnections[fromNodeId].outputs[toNodeId].push(linkType);
          
          // Track inputs to this node
          if (!nodeConnections[toNodeId].inputs) {
            nodeConnections[toNodeId].inputs = {};
          }
          if (!nodeConnections[toNodeId].inputs[fromNodeId]) {
            nodeConnections[toNodeId].inputs[fromNodeId] = [];
          }
          nodeConnections[toNodeId].inputs[fromNodeId].push(linkType);
        } catch (error) {
          console.log(`Error processing link: ${JSON.stringify(link)}`);
        }
      }
    });
    
    // Print detailed information for each node
    console.log('\nDetailed Node Information:');
    Object.entries(nodes).forEach(([nodeId, node]) => {
      const nodeType = inferNodeType(nodeId, node, workflows);
      console.log(`\nNode ID: ${nodeId}`);
      console.log(`  Type: ${nodeType}`);
      
      // Print inputs if available
      if (node.inputs) {
        console.log('  Inputs:');
        Object.entries(node.inputs).forEach(([inputName, inputValue]) => {
          // Format input value for display
          let displayValue;
          if (typeof inputValue === 'object') {
            displayValue = JSON.stringify(inputValue).substring(0, 60);
            if (displayValue.length >= 60) displayValue += '...';
          } else {
            displayValue = String(inputValue).substring(0, 60);
            if (displayValue.length >= 60) displayValue += '...';
          }
          console.log(`    ${inputName}: ${displayValue}`);
        });
      }
      
      // Print connections
      if (nodeConnections[nodeId]) {
        if (nodeConnections[nodeId].inputs && Object.keys(nodeConnections[nodeId].inputs).length > 0) {
          console.log('  Receives from:');
          Object.entries(nodeConnections[nodeId].inputs).forEach(([fromNodeId, types]) => {
            const fromNodeType = inferNodeType(fromNodeId, nodes[fromNodeId], workflows);
            console.log(`    Node ${fromNodeId} (${fromNodeType}) → ${types.join(', ')}`);
          });
        }
        
        if (nodeConnections[nodeId].outputs && Object.keys(nodeConnections[nodeId].outputs).length > 0) {
          console.log('  Sends to:');
          Object.entries(nodeConnections[nodeId].outputs).forEach(([toNodeId, types]) => {
            const toNodeType = inferNodeType(toNodeId, nodes[toNodeId], workflows);
            console.log(`    Node ${toNodeId} (${toNodeType}) ← ${types.join(', ')}`);
          });
        }
      }
      
      // Print position if available
      if (node._meta && node._meta.pos) {
        console.log(`  Position: [${node._meta.pos[0]}, ${node._meta.pos[1]}]`);
      }
    });
    
    // Parse the workflow structure
    const workflowStructure = workflows.parseWorkflowStructure(workflowWithDetails.workflow_json);
    
    // Display workflow structure information
    console.log('\nWorkflow Structure Summary:');
    console.log(`Node Count: ${workflowStructure.nodeCount}`);
    console.log(`Node Types: ${workflowStructure.nodeTypes.join(', ')}`);
    console.log(`Has Prompt Node: ${workflowStructure.hasPromptNode}`);
    console.log(`Has KSampler Node: ${workflowStructure.hasKSamplerNode}`);
    console.log(`Output Type: ${workflowStructure.outputType}`);
    console.log(`Has Lora Loader: ${workflowStructure.hasLoraLoader}`);
    
    // Display input nodes
    console.log('\nInput Nodes:');
    if (workflowStructure.inputNodes.length === 0) {
      console.log('  No dedicated input nodes detected');
    } else {
      workflowStructure.inputNodes.forEach(node => {
        console.log(`- ${node.type} (ID: ${node.id})`);
        console.log('  Inputs:', JSON.stringify(node.inputs, null, 2));
      });
    }
    
    // Display external input nodes
    console.log('\nExternal Input Nodes (ComfyUIDeployExternal):');
    if (workflowStructure.externalInputNodes.length === 0) {
      console.log('  No external input nodes detected');
    } else {
      workflowStructure.externalInputNodes.forEach(node => {
        console.log(`- ${node.inputName} (Type: ${node.inputType}, Node ID: ${node.id})`);
        if (node.defaultValue !== null) {
          console.log(`  Default: ${JSON.stringify(node.defaultValue).substring(0, 60)}${JSON.stringify(node.defaultValue).length > 60 ? '...' : ''}`);
        }
      });
    }
    
    // Display output nodes
    console.log('\nOutput Nodes:');
    if (workflowStructure.outputNodes.length === 0) {
      console.log('  No dedicated output nodes detected');
    } else {
      workflowStructure.outputNodes.forEach(node => {
        console.log(`- ${node.type} (ID: ${node.id}, Output Type: ${node.outputType || 'unknown'})`);
      });
    }
    
    // Save workflow JSON to file
    const fs = require('fs');
    const path = require('path');
    const outputDir = path.join(__dirname, 'workflow-jsons');
    
    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const outputFile = path.join(outputDir, `${workflowName}-workflow.json`);
    fs.writeFileSync(outputFile, JSON.stringify(workflowWithDetails.workflow_json, null, 2));
    console.log(`\nWorkflow JSON saved to: ${outputFile}`);
    
  } catch (error) {
    console.error('Error in workflow demo:', error);
  }
}

// Run the demo
main().then(() => {
  console.log('Demo completed');
}).catch(error => {
  console.error('Demo failed:', error);
}); 