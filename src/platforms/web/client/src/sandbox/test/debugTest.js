/**
 * Simple test to verify debug flags are working
 * Run this in the browser console to test
 */

import { debugLog, DEBUG_FLAGS } from '../config/debugConfig.js';

export function testDebugFlags() {
    console.log('=== Testing Debug Flags ===');
    
    // Test each flag
    Object.keys(DEBUG_FLAGS).forEach(flag => {
        console.log(`\nTesting ${flag}:`);
        
        // Test with flag disabled (should not log)
        DEBUG_FLAGS[flag] = false;
        debugLog(flag, `[TEST] ${flag} - This should NOT appear`);
        
        // Test with flag enabled (should log)
        DEBUG_FLAGS[flag] = true;
        debugLog(flag, `[TEST] ${flag} - This SHOULD appear`);
        
        // Reset to disabled
        DEBUG_FLAGS[flag] = false;
    });
    
    console.log('\n=== Debug Flag Test Complete ===');
    console.log('All flags are currently DISABLED (no verbose logging)');
    console.log('Use window.debugToggle.enable("FLAG_NAME") to enable specific flags');
    console.log('Use window.debugToggle.status() to see current status');
}

// Make test available globally
if (typeof window !== 'undefined') {
    window.testDebugFlags = testDebugFlags;
}
