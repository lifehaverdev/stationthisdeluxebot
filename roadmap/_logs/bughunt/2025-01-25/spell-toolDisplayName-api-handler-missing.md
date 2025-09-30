# Bug Hunt Log: Spell toolDisplayName Missing in API Handler

**Date**: 2025-01-25  
**Severity**: S2 (Major feature broken)  
**Status**: FIXED  

## Summary
Spell execution was still failing after the first fix because the `generationOutputsApi.js` POST handler was not extracting and passing the `toolDisplayName` field from the request body to the database creation call.

## Root Cause Analysis
The issue had **two parts**:

1. **First Issue (Fixed)**: `WorkflowExecutionService.js` wasn't sending `toolDisplayName` in the final generation record
2. **Second Issue (This Fix)**: `generationOutputsApi.js` wasn't extracting `toolDisplayName` from request body and passing it to `createGenerationOutput()`

## Evidence from Log
The log shows that `toolDisplayName: 'lazyoni'` was being sent in the request body, but the API handler was ignoring it:

```
toolDisplayName: 'lazyoni',
```

But the `dataToCreate` object in the API handler didn't include this field, causing the database validation to fail.

## Fix Applied
Updated `src/api/internal/generations/generationOutputsApi.js`:

1. **Line 136**: Added `toolDisplayName` to destructuring assignment
2. **Line 182**: Added `...(toolDisplayName && { toolDisplayName })` to `dataToCreate` object

## Files Modified
- `src/api/internal/generations/generationOutputsApi.js` (lines 136, 182)

## Verification Steps
1. Execute a spell
2. Verify spell completes successfully 
3. Verify final results are delivered to web interface
4. Check that generation record is created with proper `toolDisplayName`

## Related Fixes
- First fix: `src/core/services/WorkflowExecutionService.js` (line 369)
- This fix: `src/api/internal/generations/generationOutputsApi.js` (lines 136, 182)

Both fixes are required for spell execution to work properly.
