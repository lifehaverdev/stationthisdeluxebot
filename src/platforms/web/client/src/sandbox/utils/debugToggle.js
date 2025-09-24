/**
 * Debug toggle utility for runtime control of debug flags
 * Usage: window.debugToggle.enable('CLICK_HANDLER') or window.debugToggle.disable('CLICK_HANDLER')
 */

import { DEBUG_FLAGS } from '../config/debugConfig.js';

class DebugToggle {
    constructor() {
        this.flags = DEBUG_FLAGS;
    }

    /**
     * Enable a specific debug flag
     * @param {string} flagName - The flag to enable
     */
    enable(flagName) {
        if (this.flags.hasOwnProperty(flagName)) {
            this.flags[flagName] = true;
            console.log(`[DebugToggle] Enabled ${flagName}`);
        } else {
            console.warn(`[DebugToggle] Unknown flag: ${flagName}`);
        }
    }

    /**
     * Disable a specific debug flag
     * @param {string} flagName - The flag to disable
     */
    disable(flagName) {
        if (this.flags.hasOwnProperty(flagName)) {
            this.flags[flagName] = false;
            console.log(`[DebugToggle] Disabled ${flagName}`);
        } else {
            console.warn(`[DebugToggle] Unknown flag: ${flagName}`);
        }
    }

    /**
     * Toggle a specific debug flag
     * @param {string} flagName - The flag to toggle
     */
    toggle(flagName) {
        if (this.flags.hasOwnProperty(flagName)) {
            this.flags[flagName] = !this.flags[flagName];
            console.log(`[DebugToggle] ${this.flags[flagName] ? 'Enabled' : 'Disabled'} ${flagName}`);
        } else {
            console.warn(`[DebugToggle] Unknown flag: ${flagName}`);
        }
    }

    /**
     * Enable all debug flags
     */
    enableAll() {
        Object.keys(this.flags).forEach(flag => {
            this.flags[flag] = true;
        });
        console.log('[DebugToggle] Enabled all debug flags');
    }

    /**
     * Disable all debug flags
     */
    disableAll() {
        Object.keys(this.flags).forEach(flag => {
            this.flags[flag] = false;
        });
        console.log('[DebugToggle] Disabled all debug flags');
    }

    /**
     * Show current status of all flags
     */
    status() {
        console.log('[DebugToggle] Current debug flags status:');
        Object.entries(this.flags).forEach(([flag, enabled]) => {
            console.log(`  ${flag}: ${enabled ? 'ON' : 'OFF'}`);
        });
    }

    /**
     * List available flags
     */
    list() {
        console.log('[DebugToggle] Available flags:');
        Object.keys(this.flags).forEach(flag => {
            console.log(`  ${flag}`);
        });
    }
}

// Create global instance
const debugToggle = new DebugToggle();

// Make it available globally for easy access
if (typeof window !== 'undefined') {
    window.debugToggle = debugToggle;
}

export default debugToggle;
