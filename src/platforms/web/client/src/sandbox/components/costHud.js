/**
 * Cost HUD Component
 * 
 * Displays total cost across all windows in the workspace
 * Fixed position in sandbox corner, updates live as nodes finish executing
 */

import { getTotalWorkspaceCost, resetAllCosts } from '../state.js';
import { getLatestExchangeRates } from '../node/toolWindow.js';

// Debug helper function gated by window.DEBUG_COST_LOGS
function hudDebug(...args) {
    if (typeof window !== 'undefined' && window.DEBUG_COST_LOGS) {
        console.log('[CostHUD]', ...args);
    }
}

class CostHUD {
    constructor() {
        this.element = null;
        this.currentDenomination = 'POINTS';
        this.exchangeRates = null;
        this.isVisible = true;
        
        this.init();
    }

    init() {
        this.createHUD();
        this.loadDenominationPreference();
        this.loadExchangeRates();
        this.attachEventListeners();
        this.updateDisplay();
        
        // Start only exchange rate refresh interval (no more 2-second polling)
        this.startExchangeRateRefresh();
    }

    createHUD() {
        // Create HUD container
        this.element = document.createElement('div');
        this.element.id = 'cost-hud';
        this.element.className = 'cost-hud';
        
        // Create HUD content
        this.element.innerHTML = `
            <div class="cost-hud-content">
                <div class="cost-hud-header">
                    <span class="cost-hud-title">TOTAL COST</span>
                    <button class="cost-hud-reset" title="Reset all costs">↻</button>
                </div>
                <div class="cost-hud-amount" id="cost-hud-amount">0 POINTS</div>
                <div class="cost-hud-details" id="cost-hud-details"></div>
            </div>
        `;

        // Add to DOM
        document.body.appendChild(this.element);

        // Add CSS styles
        this.addStyles();
    }

    addStyles() {
        if (document.getElementById('cost-hud-styles')) return;

        const style = document.createElement('style');
        style.id = 'cost-hud-styles';
        style.textContent = `
            .cost-hud {
                position: fixed;
                top: 80px;
                right: 20px;
                z-index: 90;
                background: rgba(0, 0, 0, 0.9);
                border: 1px solid #333;
                border-radius: 8px;
                padding: 12px 16px;
                color: white;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 17px;
                min-width: 150px;
                backdrop-filter: blur(10px);
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                transition: all 0.2s ease;
                cursor: pointer;
            }

            .cost-hud:hover {
                background: rgba(0, 0, 0, 0.95);
                border-color: #555;
            }

            .cost-hud-content {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .cost-hud-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 4px;
            }

            .cost-hud-title {
                font-size: 13px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: #888;
            }

            .cost-hud-reset {
                background: none;
                border: none;
                color: #888;
                cursor: pointer;
                font-size: 19px;
                padding: 2px 4px;
                border-radius: 3px;
                transition: all 0.2s ease;
            }

            .cost-hud-reset:hover {
                color: #fff;
                background: rgba(255, 255, 255, 0.1);
            }

            .cost-hud-amount {
                font-size: 22px;
                font-weight: 700;
                color: #fff;
                line-height: 1.2;
            }

            .cost-hud-details {
                font-size: 13px;
                color: #888;
                line-height: 1.3;
            }

            .cost-hud.hidden {
                opacity: 0;
                pointer-events: none;
                transform: translateY(-10px);
            }
        `;
        document.head.appendChild(style);
    }

    loadDenominationPreference() {
        const saved = localStorage.getItem('costDenom');
        if (saved && ['POINTS', 'MS2', 'USD', 'CULT'].includes(saved)) {
            this.currentDenomination = saved;
        }
    }

    saveDenominationPreference() {
        localStorage.setItem('costDenom', this.currentDenomination);
    }

    async loadExchangeRates() {
        // Use helper first
        const helperRates = getLatestExchangeRates();
        if (helperRates) {
            this.exchangeRates = helperRates;
            hudDebug('Using helper-provided exchange rates');
            window.dispatchEvent(new CustomEvent('exchangeRatesUpdated', { detail: { rates: this.exchangeRates } }));
            return;
        }

        // Use cached rates if they are less than 1 hour old
        try {
            const cachedStr = localStorage.getItem('exchangeRatesCache');
            if (cachedStr) {
                const cached = JSON.parse(cachedStr);
                if (cached && cached.timestamp && (Date.now() - cached.timestamp) < 60 * 60 * 1000) {
                    this.exchangeRates = cached.rates;
                    hudDebug('Using cached exchange rates', this.exchangeRates);
                    window.dispatchEvent(new CustomEvent('exchangeRatesUpdated', { detail: { rates: this.exchangeRates } }));
                    return;
                }
            }
        } catch (err) {
            hudDebug('Failed to read cached exchange rates', err);
        }

        try {
            const response = await fetch('/api/external/economy/rates');
            if (response.ok) {
                const data = await response.json();
                this.exchangeRates = data.data;
                hudDebug('Loaded exchange rates:', this.exchangeRates);
                hudDebug('Data source:', data.source || 'unknown');
                
                // Cache them with timestamp
                try {
                    localStorage.setItem('exchangeRatesCache', JSON.stringify({ timestamp: Date.now(), rates: this.exchangeRates }));
                } catch (_) { /* ignore */ }

                // Notify other components that fresh rates are available
                if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
                    window.dispatchEvent(new CustomEvent('exchangeRatesUpdated', {
                        detail: { rates: this.exchangeRates }
                    }));
                }
                // Update display immediately with new rates
                this.updateDisplay();
            } else {
                hudDebug('Failed to load exchange rates, using fallback defaults');
                // Use fallback exchange rates
                const USD_TO_POINTS_CONVERSION_RATE = 0.000337;
                this.exchangeRates = { 
                    POINTS_per_USD: 1 / USD_TO_POINTS_CONVERSION_RATE, // ~2,967 points per USD
                    MS2_per_USD: 2, 
                    CULT_per_USD: 50 
                };
                window.dispatchEvent(new CustomEvent('exchangeRatesUpdated', { detail: { rates: this.exchangeRates } }));
                try {
                    localStorage.setItem('exchangeRatesCache', JSON.stringify({ timestamp: Date.now(), rates: this.exchangeRates }));
                } catch(_){}
            }
        } catch (error) {
            hudDebug('Error loading exchange rates:', error);
            // Use fallback exchange rates
            const USD_TO_POINTS_CONVERSION_RATE = 0.000337;
            this.exchangeRates = { 
                POINTS_per_USD: 1 / USD_TO_POINTS_CONVERSION_RATE, // ~2,967 points per USD
                MS2_per_USD: 2, 
                CULT_per_USD: 50 
            };
            window.dispatchEvent(new CustomEvent('exchangeRatesUpdated', { detail: { rates: this.exchangeRates } }));
            try {
                localStorage.setItem('exchangeRatesCache', JSON.stringify({ timestamp: Date.now(), rates: this.exchangeRates }));
            } catch(_){}
        }
    }

    attachEventListeners() {
        // Click to cycle denominations
        this.element.addEventListener('click', () => {
            this.cycleDenomination();
        });

        // Reset button
        const resetBtn = this.element.querySelector('.cost-hud-reset');
        resetBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.resetAllCosts();
        });

        // Listen for cost updates
        window.addEventListener('costUpdate', (event) => {
            hudDebug('Received costUpdate event:', event.detail);
            this.updateDisplay();
        });

        window.addEventListener('costResetAll', () => {
            hudDebug('Received costResetAll event');
            this.updateDisplay();
        });

        // Listen for window changes
        window.addEventListener('toolWindowAdded', () => {
            hudDebug('Received toolWindowAdded event');
            this.updateDisplay();
        });

        window.addEventListener('toolWindowRemoved', () => {
            hudDebug('Received toolWindowRemoved event');
            this.updateDisplay();
        });

        // Listen for denomination changes
        window.addEventListener('denominationChange', () => {
            hudDebug('Received denominationChange event');
            this.updateDisplay();
        });

        // Listen for exchange rate updates
        window.addEventListener('exchangeRatesUpdated', () => {
            hudDebug('Received exchangeRatesUpdated event');
            this.updateDisplay();
        });
    }

    cycleDenomination() {
        const denominations = ['POINTS', 'MS2', 'USD', 'CULT'];
        const currentIndex = denominations.indexOf(this.currentDenomination);
        const nextIndex = (currentIndex + 1) % denominations.length;
        
        this.currentDenomination = denominations[nextIndex];
        this.saveDenominationPreference();
        this.updateDisplay();
        
        // Dispatch denomination change event for other components
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('denominationChange', {
                detail: { denomination: this.currentDenomination }
            }));
        }
    }

    resetAllCosts() {
        if (confirm('Reset all costs? This action cannot be undone.')) {
            resetAllCosts();
        }
    }

    formatCost(amount, denomination) {
        if (amount === 0) return '0';
        
        // Format based on denomination
        switch (denomination) {
            case 'USD':
                return `$${amount.toFixed(2)}`;
            case 'POINTS':
                return `${Math.round(amount)} POINTS`;
            case 'MS2':
                return `${amount.toFixed(2)} MS2`;
            case 'CULT':
                return `${Math.round(amount)} CULT`;
            default:
                return `${amount.toFixed(2)}`;
        }
    }

    convertCost(usdAmount, targetDenomination) {
        if (!this.exchangeRates) return 0;
        
        switch (targetDenomination) {
            case 'USD':
                return usdAmount;
            case 'POINTS':
                return usdAmount * this.exchangeRates.POINTS_per_USD;
            case 'MS2':
                return usdAmount * this.exchangeRates.MS2_per_USD;
            case 'CULT':
                return usdAmount * this.exchangeRates.CULT_per_USD;
            default:
                return usdAmount;
        }
    }

    updateDisplay() {
        if (!this.element) {
            hudDebug('Element not found, cannot update display');
            return;
        }

        const totals = getTotalWorkspaceCost();
        hudDebug('Updating display with totals:', totals);
        hudDebug('Exchange rates:', this.exchangeRates);
        
        const amountElement = this.element.querySelector('#cost-hud-amount');
        const detailsElement = this.element.querySelector('#cost-hud-details');

        if (!amountElement || !detailsElement) {
            hudDebug('Missing DOM elements for cost display');
            return;
        }

        // Convert to current denomination
        const currentAmount = this.convertCost(totals.usd, this.currentDenomination);
        const formattedAmount = this.formatCost(currentAmount, this.currentDenomination);

        hudDebug(`Displaying ${formattedAmount} (${this.currentDenomination})`);

        // Update main amount
        amountElement.textContent = formattedAmount;

        // Update details with other denominations
        const otherDenominations = ['POINTS', 'MS2', 'USD', 'CULT'].filter(d => d !== this.currentDenomination);
        const details = otherDenominations.map(denom => {
            const amount = this.convertCost(totals.usd, denom);
            return this.formatCost(amount, denom);
        }).join(' | ');

        detailsElement.textContent = details || 'No costs yet';
        
        // Debug: Log the final state
        hudDebug('Final display state:', {
            amountElement: amountElement.textContent,
            detailsElement: detailsElement.textContent,
            totals,
            currentDenomination: this.currentDenomination
        });
    }

    show() {
        this.isVisible = true;
        this.element.classList.remove('hidden');
    }

    hide() {
        this.isVisible = false;
        this.element.classList.add('hidden');
    }

    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    startExchangeRateRefresh() {
        // Refresh exchange rates every hour to get latest pricing
        this.ratesInterval = setInterval(() => {
            hudDebug('Refreshing exchange rates (1h interval)...');
            this.loadExchangeRates();
        }, 60 * 60 * 1000); // 1 hour
    }

    stopExchangeRateRefresh() {
        if (this.ratesInterval) {
            clearInterval(this.ratesInterval);
            this.ratesInterval = null;
        }
    }

    destroy() {
        this.stopExchangeRateRefresh();
        if (this.element) {
            this.element.remove();
            this.element = null;
        }
    }
}

// Export singleton instance
let costHUDInstance = null;

export function initCostHUD() {
    if (!costHUDInstance) {
        costHUDInstance = new CostHUD();
        // Make cost HUD globally available for fallback mechanism
        if (typeof window !== 'undefined') {
            window.costHUD = costHUDInstance;
            // Also add a manual trigger function
            window.forceUpdateCostHUD = () => {
                hudDebug('Manual update triggered');
                if (costHUDInstance) {
                    costHUDInstance.updateDisplay();
                }
            };
            
            // Add a test function to simulate cost updates
            window.testCostHUD = () => {
                hudDebug('Testing cost HUD with sample data');
                if (costHUDInstance) {
                    // Simulate adding a cost to test the HUD
                    const testWindowId = 'test-window-' + Date.now();
                    const testCostData = {
                        usd: 0.04,
                        points: 119,
                        ms2: 0.08,
                        cult: 2
                    };
                    
                    // Import the addWindowCost function
                    import('../state.js').then(module => {
                        module.addWindowCost(testWindowId, testCostData);
                        hudDebug('Added test cost data');
                    });
                }
            };
            
            // Add a function to manually refresh exchange rates
            window.refreshExchangeRates = async () => {
                hudDebug('Manually refreshing exchange rates...');
                if (costHUDInstance) {
                    await costHUDInstance.loadExchangeRates();
                    hudDebug('Exchange rates refreshed:', costHUDInstance.exchangeRates);
                }
            };
        }
    }
    return costHUDInstance;
}

export function getCostHUD() {
    return costHUDInstance;
}

export default CostHUD;
