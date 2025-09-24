# Debug Scripts Archive

This directory contains debugging scripts from the epic beacon proxy salt mining debugging journey that was completed on 2025-01-16.

## The Problem We Solved

The original issue was a byte-layout bug in `beaconProxyHelper.js` where locally predicted ERC-1967 beacon proxy addresses didn't match on-chain computed addresses from `Foundation.computeCharterAddress`. This caused mining failures and incorrect address predictions.

## The Debugging Journey

The debugging process involved extensive analysis to understand the exact byte layout of the ERC-1967 beacon proxy initialization code. The key challenge was matching the local prediction logic with the on-chain Solidity implementation.

### Key Debug Scripts

- `debug_bytecode_analysis.js` - Initial bytecode analysis
- `debug_foundation_bytecode.js` - Foundation contract bytecode analysis
- `debug_implementation.js` - Implementation contract analysis
- `debug_initcode.js` - Init code construction debugging
- `debug_memory_layout.js` - Memory layout analysis
- `debug_address_prediction.js` - Address prediction debugging
- `debug_onchain.js` - On-chain verification
- `debug_final.js` - Final verification script

### The Solution

After extensive debugging, the correct init code construction was determined:

- **Prefix**: `0x6100963d8160233d3973` (hardcoded, not calculated)
- **Beacon address**: Direct storage at offset 0x0a (20 bytes)
- **Runtime code parts**: 
  - Runtime 1: offset 0x1e (30 bytes)
  - Runtime 2: offset 0x35 (53 bytes)
  - Runtime 3: offset 0x55 (85 bytes)
- **Args**: Storage at offset 0x75 (117 bytes)
- **Buffer size**: Exactly 185 bytes (0xB9)

**Final hash**: `0xece1ef3a4040739237183de9098f89b3b872d6683b960609bba8a48df7e687d4` ✅

## Current Status

The beacon proxy helper is now correctly implemented and production-ready. These debug scripts are preserved for historical reference and future debugging if needed.

## Related Files

- `src/core/services/alchemy/beaconProxyHelper.js` - Production implementation
- `src/core/services/alchemy/saltMiningWorker.js` - Optimized worker
- `scripts/testing_helpers/test_referral_vault_flow.js` - Test script
