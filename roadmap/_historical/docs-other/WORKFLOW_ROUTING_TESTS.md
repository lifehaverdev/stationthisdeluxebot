> Imported from docs/testing/WORKFLOW_ROUTING_TESTS.md on 2025-08-21

# Workflow Routing Tests

## Overview
This document outlines the testing approach for the workflow name standardization and machine-specific routing implementation. The tests verify that workflows are correctly routed to the most appropriate machines based on workflow type.

## Test Cases

### 1. Name Standardization Tests

#### Test 1.1: Standard Name Mapping
**Description**: Verify that workflow names are properly standardized according to the mapping table
**Steps**:
1. Initialize the WorkflowsService
2. Call standardizeWorkflowName() with various input formats:
   - API names: "text2img", "inpaint", "controlnet"
   - Database names: "makeImage", "train"
   - Alternative formats: "Text to Image", "text-to-image"
**Expected Results**: All variations should map to the standardized names

#### Test 1.2: Unknown Workflow Names
**Description**: Verify that unknown workflow names are properly formatted
**Steps**:
1. Call standardizeWorkflowName() with names not in the mapping table
**Expected Results**: Names should be standardized following the formatting rules (lowercase, underscores, etc.)

### 2. Machine Routing Tests

#### Test 2.1: Specific Machine Routing
**Description**: Verify that workflows are routed to specific machines based on routing rules
**Steps**:
1. Initialize WorkflowsService
2. Call getMachineForWorkflow() with various workflow types:
   - "text2img" → Should route to StationthisHun
   - "inpaint" → Should route to inpainter machine
   - "img2vid" → Should route to TRIPO machine
**Expected Results**: Each workflow should be routed to the correct machine specified in the routing configuration

#### Test 2.2: Default Machine Fallback
**Description**: Verify that workflows without specific routing use the default machine
**Steps**:
1. Call getMachineForWorkflow() with a workflow type not in the routing rules
**Expected Results**: Should return the default machine ID

#### Test 2.3: Handling Unavailable Machines
**Description**: Verify behavior when configured machines are unavailable
**Steps**:
1. Temporarily modify a machine status to "error" in the test environment
2. Call getMachineForWorkflow() for a workflow that would normally use that machine
**Expected Results**: Should fall back to default machine or another available machine

### 3. Integration Tests

#### Test 3.1: End-to-End Workflow Execution
**Description**: Verify that the entire workflow execution process uses the correct machine
**Steps**:
1. Use demo-workflow-execution.js with various workflow types
2. Check logs to confirm:
   - Workflow name is standardized
   - Correct machine is selected
   - Request is submitted to the correct machine
**Expected Results**: Each workflow should execute on the intended machine

#### Test 3.2: Error Handling
**Description**: Verify proper error handling when machine routing fails
**Steps**:
1. Configure an invalid machine ID in the routing configuration
2. Execute a workflow that would use that machine
**Expected Results**: System should gracefully fall back to default machine with appropriate warning logs

#### Test 3.3: Machine Availability Handling
**Description**: Verify that the system adapts to machine availability changes
**Steps**:
1. Execute a workflow when its configured machine is available
2. Simulate the machine becoming unavailable
3. Execute the same workflow again
**Expected Results**: System should adapt to the change in availability and route to an alternative machine

## Execution Instructions

To run these tests, use the following command:

```powershell
# Run basic name standardization tests
node tests/workflow-name-standardization.test.js

# Run machine routing tests
node tests/workflow-machine-routing.test.js

# Run end-to-end execution tests 
node run-demo.js workflow --workflow="text2img" --prompt="test prompt" --execute=true
```

## Test Results

Document test results in this section after execution:

| Test ID | Test Date | Result | Notes |
|---------|-----------|--------|-------|
| 1.1 | TBD | Pending | |
| 1.2 | TBD | Pending | |
| 2.1 | TBD | Pending | |
| 2.2 | TBD | Pending | |
| 2.3 | TBD | Pending | |
| 3.1 | TBD | Pending | |
| 3.2 | TBD | Pending | |
| 3.3 | TBD | Pending | | 