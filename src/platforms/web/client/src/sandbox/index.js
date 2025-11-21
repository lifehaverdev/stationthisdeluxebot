import {
    initState,
    getToolWindows,
    updateToolWindowPosition,
    setModalState,
    setSubmenuState,
    setLastClickPosition,
    getLastClickPosition,
    getAvailableTools,
    OUTPUT_TYPE_MAPPING,
    undo,
    redo,
    lasso,
    selectNode,
    clearSelection,
    getSelectedNodeIds,
    checkPendingGenerations
} from './state.js';
import { initializeTools, uploadFile } from './io.js';
import { createToolWindow, createSpellWindow } from './node/index.js';
import { createUploadWindow } from './window/index.js';
import { createImageInSandbox } from './components/image.js';
import { initCanvas, updateConnectionLine } from './canvas.js';
import { calculateCenterPosition, hideModal } from './utils.js';
import { showToolsForCategory, renderSidebarTools } from './toolSelection.js';
import AccountDropdown from './components/accountDropdown.js';
import './components/BuyPointsModal/buyPointsModal.js';
import SpellsMenuModal from './components/SpellsMenuModal.js';
import ModsMenuModal from './components/ModsMenuModal.js';
import { renderAllConnections } from './connections/index.js';
import './components/ReferralVaultModal/referralVaultModal.js';
import './components/ReferralVaultDashboardModal/vaultDashboardModal.js';
import { MintSpellFAB } from './components/MintSpellFAB.js';
import './onboarding/onboarding.js';
import CookMenuModal from './components/CookMenuModal.js';
import './components/ReauthModal.js';
import { saveWorkspace, loadWorkspace } from './workspaces.js';
import initWorkspaceTabs from './components/WorkspaceTabs.js';
import { initCostHUD } from './components/costHud.js';
import { websocketClient } from '/js/websocketClient.js';

// Intercept fetch to detect 401 / unauthorized responses and prompt re-auth without page reload
(function interceptUnauthorized() {
    if (window.__fetch401InterceptorAttached__) return;
    window.__fetch401InterceptorAttached__ = true;
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const resp = await originalFetch.apply(this, args);
        if (resp && resp.status === 401) {
            // Don't trigger reauth for workspace GET requests (they can be public)
            const url = args[0];
            if (typeof url === 'string' && url.includes('/api/v1/workspaces/') && args[1]?.method === 'GET') {
                return resp;
            }
            // Skip reauth prompts for endpoints that require API keys (not user sessions)
            const skippable401Endpoints = [
                '/api/v1/generations/status'
            ];
            if (typeof url === 'string' && skippable401Endpoints.some(endpoint => url.includes(endpoint))) {
                return resp;
            }
            
            // Don't trigger reauth if modal is already open or if this is a workspace operation
            // that might legitimately fail (e.g., trying to save without being logged in)
            if (typeof window.openReauthModal === 'function' && !window.__reauthModalOpen__) {
                // Check if we have a JWT in localStorage (from landing page login)
                // If we do, the cookie might not be set yet - give it a moment
                const jwtInStorage = localStorage.getItem('jwt');
                if (jwtInStorage && !document.cookie.includes('jwt=')) {
                    // JWT exists in storage but not in cookie - cookie might be setting
                    // Wait a bit and check again before showing reauth modal
                    setTimeout(() => {
                        if (!document.cookie.includes('jwt=') && !window.__reauthModalOpen__) {
                            window.openReauthModal();
                        }
                    }, 500);
                    return resp;
                }
                window.openReauthModal();
            }
        }
        return resp;
    };
})();

let spacebarIsDown = false;
let justLassoed = false;

document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') spacebarIsDown = true;
});
document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') spacebarIsDown = false;
});

// Reset spacebar state when window loses focus to prevent stuck state
window.addEventListener('blur', () => {
    spacebarIsDown = false;
});

import { debugLog, isDebugEnabled, DEBUG_FLAGS } from './config/debugConfig.js';
import './utils/debugToggle.js'; // Initialize debug toggle utility
import './test/debugTest.js'; // Initialize debug test utility

// Initialize sandbox functionality
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize state
    initState();

    // Ensure WebSocket connection is established for real-time updates
    // Note: Handlers are registered in toolWindow.js via registerWebSocketHandlers()
    try {
        if (websocketClient && typeof websocketClient.connect === 'function') {
            websocketClient.connect();
            console.log('[Sandbox] WebSocket connection initiated');
            
            // Log connection status
            websocketClient.on('open', () => {
                console.log('[Sandbox] WebSocket connection opened successfully');
            });
            websocketClient.on('close', () => {
                console.warn('[Sandbox] WebSocket connection closed');
            });
            websocketClient.on('error', (error) => {
                console.error('[Sandbox] WebSocket error:', error);
            });
        } else {
            console.warn('[Sandbox] websocketClient not available or missing connect method');
        }
    } catch (error) {
        console.error('[Sandbox] Failed to initiate WebSocket connection:', error);
        // Continue execution - checkPendingGenerations() will handle recovery
    }

    if (window.__EXTERNAL_API_KEY__) {
        await checkPendingGenerations();
    }

    // Locate main containers
    const sandboxContent = document.querySelector('.sandbox-content');
    const canvas = document.querySelector('.sandbox-canvas');
    if (!canvas) {
        console.error("Sandbox canvas not found!");
        return;
    }

    /*
     * On a fresh page load any tool-window / connection-line markup that was
     * persisted in localStorage will be rendered by the browser inside
     * `.sandbox-content`. These elements will be recreated later by
     * `createToolWindow()` and `renderAllConnections()`, so keeping the initial
     * copies would result in duplicate, "phantom" nodes that stack underneath
     * the interactive ones. Clear them now to guarantee a clean slate.
     */
    document.querySelectorAll('.tool-window, .connection-line').forEach(el => el.remove());

    // Zoom/pan state
    let scale = 1;
    let pan = { x: 0, y: 0 };
    const minScale = 0.2, maxScale = 4.0; // Adjusted zoom limits
    const gridSize = 32;

    // When the canvas has `transform: translate(pan) scale(scale)` the true mapping is:
    // screen = (workspace + pan) * scale  ⇒  workspace = (screen / scale) - pan
    function workspaceToScreen(x, y) {
        // Children of .sandbox-canvas inherit the canvas transform. Their raw
        // left/top are expressed in *workspace* coordinates; scaling & pan
        // are both handled by the parent transform. Therefore return the
        // raw workspace coordinates here.
        return { x: x, y: y };
    }

    function screenToWorkspace(x, y) {
        // Convert viewport coordinates (e.clientX/clientY) to workspace coordinates
        // First, get canvas position in viewport
        const canvasRect = canvas.getBoundingClientRect();
        // Convert viewport coordinates to canvas-relative coordinates
        const canvasX = x - canvasRect.left;
        const canvasY = y - canvasRect.top;
        // Apply inverse transform: workspace = (canvas / scale) - pan
        return {
            x: (canvasX / scale) - pan.x,
            y: (canvasY / scale) - pan.y
        };
    }

    function renderAllWindows() {
        getToolWindows().forEach(win => {
            const el = document.getElementById(win.id);
            if (el) {
                el.style.left = `${win.workspaceX}px`;
                el.style.top = `${win.workspaceY}px`;
                // Optional: scale window size too
                // el.style.width = `${win.width * scale}px`;
                // el.style.height = `${win.height * scale}px`;
            }
        });
        // You would also re-render connections here
        renderAllConnections();
    }

    function updateTransform() {
        //console.log(`[Workspace] Pan: (${pan.x.toFixed(2)}, ${pan.y.toFixed(2)}), Scale: ${scale.toFixed(2)}`);
        canvas.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`;
        // The background grid is now part of the canvas, so it scales with it.
        const gridBgSize = gridSize * scale;
        canvas.style.backgroundSize = `${gridBgSize}px ${gridBgSize}px, ${gridBgSize}px ${gridBgSize}px`;
        renderAllWindows();
    }
    function setScale(newScale, centerX, centerY) {
        const prevScale = scale;
        scale = Math.max(minScale, Math.min(maxScale, newScale));

        // If zooming towards a focus point (mouse / touch centre)
        if (centerX !== undefined && centerY !== undefined) {
            // Get canvas position in viewport BEFORE transform update
            const rect = canvas.getBoundingClientRect();
            
            // Cursor position relative to canvas origin (in canvas coordinate space)
            const cursorCanvasX = centerX - rect.left;
            const cursorCanvasY = centerY - rect.top;
            
            // Calculate the workspace point that is currently under the cursor
            // Transform formula: screen = (workspace + pan) * scale
            // Inverse: workspace = (screen / scale) - pan
            const cursorWorkspaceX = (cursorCanvasX / prevScale) - pan.x;
            const cursorWorkspaceY = (cursorCanvasY / prevScale) - pan.y;
            
            // Calculate the ideal pan to keep cursor point fixed
            const idealPanX = (cursorCanvasX / scale) - cursorWorkspaceX;
            const idealPanY = (cursorCanvasY / scale) - cursorWorkspaceY;
            
            // Apply damping factor to reduce pan sensitivity, especially when off-center
            // This reduces the pan adjustment by 60% to make it less aggressive
            const panDamping = 0.4; // 40% of calculated adjustment (60% reduction)
            const panDeltaX = idealPanX - pan.x;
            const panDeltaY = idealPanY - pan.y;
            
            pan.x = pan.x + panDeltaX * panDamping;
            pan.y = pan.y + panDeltaY * panDamping;
        }

        updateTransform();
    }
    function resetZoomPan() {
        scale = 1;
        pan = { x: 0, y: 0 };
        updateTransform();
    }
    updateTransform();

    // Mouse wheel zoom and touchpad pan
    sandboxContent.addEventListener('wheel', (e) => {
        // Detect touchpad vs mouse wheel
        // Touchpad typically has smaller deltaY and may have significant deltaX
        const isHorizontalPan = Math.abs(e.deltaX) > Math.abs(e.deltaY);
        const isSmallDelta = Math.abs(e.deltaY) < 50 && Math.abs(e.deltaX) < 50;
        const isTouchpadPan = (isHorizontalPan || isSmallDelta) && !e.ctrlKey && !e.metaKey;
        
        if (isTouchpadPan) {
            // Touchpad pan (two-finger scroll)
            e.preventDefault();
            pan.x -= e.deltaX;
            pan.y -= e.deltaY;
            updateTransform();
        } else if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            // Mouse wheel zoom (or pinch zoom on touchpad with modifier)
            e.preventDefault();
            const zoomFactor = 1.05; // Reduced from 1.1 for better control
            const newScale = scale * (e.deltaY < 0 ? zoomFactor : 1 / zoomFactor);
            setScale(newScale, e.clientX, e.clientY);
        }
    }, { passive: false });

    // Mouse drag pan
    let isPanning = false, start = { x: 0, y: 0 }, panStart = { x: 0, y: 0 };
    sandboxContent.addEventListener('mousedown', (e) => {
        // Pan only when clicking on the background, not on other elements.
        // Figma-style: pan with spacebar or middle mouse
        // Exclude tool windows and their interactive elements from pan
        const isToolWindow = e.target.closest('.tool-window, .spell-window');
        if (isToolWindow && e.button !== 1) return; // Allow middle-click pan even on windows
        
        // Only pan when clicking on canvas background
        const isCanvasClick = e.target === canvas || 
                             (e.target.classList && e.target.classList.contains('sandbox-bg'));
        if (isCanvasClick && (e.button === 1 || spacebarIsDown)) {
            isPanning = true;
            start = { x: e.clientX, y: e.clientY };
            panStart = { ...pan };
            sandboxContent.style.cursor = 'grabbing';
            e.preventDefault();
        }
    });
    document.addEventListener('mousemove', (e) => {
        if (isPanning) {
            pan.x = panStart.x + (e.clientX - start.x);
            pan.y = panStart.y + (e.clientY - start.y);
            updateTransform();
        }
    });
    document.addEventListener('mouseup', () => {
        isPanning = false;
        sandboxContent.style.cursor = '';
    });

    // Touch pinch/pan
    // Note: Mobile zoom sensitivity is reduced via damping factor in touchmove handler
    let lastTouchDist = null, lastTouchCenter = null;
    sandboxContent.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            // Pan with one finger
            // Exclude tool windows from touch pan
            const isToolWindow = e.target.closest('.tool-window, .spell-window');
            if (isToolWindow) return; // Don't pan when touching tool windows
            
            // Only pan when touching canvas background
            const isCanvasTouch = e.target === canvas || 
                                 (e.target.classList && e.target.classList.contains('sandbox-bg'));
            if (isCanvasTouch) {
                isPanning = true;
                start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                panStart = { ...pan };
            }
        } else if (e.touches.length === 2) {
            // Pinch zoom with two fingers
            isPanning = false; // Stop panning when starting to pinch
            lastTouchDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            lastTouchCenter = {
                x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                y: (e.touches[0].clientY + e.touches[1].clientY) / 2
            };
        }
    }, { passive: false });
    sandboxContent.addEventListener('touchmove', (e) => {
        if (isPanning && e.touches.length === 1) {
            // Pan with one finger
            e.preventDefault();
            pan.x = panStart.x + (e.touches[0].clientX - start.x);
            pan.y = panStart.y + (e.touches[0].clientY - start.y);
            updateTransform();
        } else if (e.touches.length === 2 && lastTouchDist !== null) {
            e.preventDefault();
            const newDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const newCenter = {
                x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                y: (e.touches[0].clientY + e.touches[1].clientY) / 2
            };
            
            // Reduced sensitivity for mobile pinch zoom
            // Apply a damping factor to make zoom less sensitive
            const zoomSensitivity = 0.3; // Lower = less sensitive (0.1-0.5 range)
            const distanceRatio = newDist / lastTouchDist;
            const dampedRatio = 1 + (distanceRatio - 1) * zoomSensitivity;
            
            // Pinch zoom with reduced sensitivity
            setScale(scale * dampedRatio, newCenter.x, newCenter.y);
            // Pan
            pan.x += newCenter.x - lastTouchCenter.x;
            pan.y += newCenter.y - lastTouchCenter.y;
            updateTransform();
            lastTouchDist = newDist;
            lastTouchCenter = newCenter;
        }
    }, { passive: false });
    sandboxContent.addEventListener('touchend', (e) => {
        // Stop panning when last finger is lifted
        if (e.touches.length === 0) {
            isPanning = false;
        }
        // Reset pinch-zoom state if less than 2 fingers
        if (e.touches.length < 2) {
            lastTouchDist = null;
            lastTouchCenter = null;
        }
    });

    // Expose for debugging and for createToolWindow
    window.sandbox = {
        workspaceToScreen,
        screenToWorkspace,
        getScale: () => scale,
        getPan: () => pan,
        getGridSize: () => gridSize
    };

    // Initialize canvas
    initCanvas();

    // --- Workspace Save/Load Buttons ---
    // Workspace Tabs bar under header
    const headerEl = document.querySelector('.sandbox-header');
    let suite;

    function syncSuitePosition() {
      const rect = headerEl.getBoundingClientRect();
      document.documentElement.style.setProperty('--sandbox-header-bottom', `${rect.bottom}px`);

      // Align suite's left edge with header inner content (padding-left)
      const padLeft = parseFloat(getComputedStyle(headerEl).paddingLeft) || 0;
      if (suite) {
        suite.style.left = `${rect.left + padLeft}px`;
      }
    }

    if (headerEl) {
      // Create workspace-suite container once header exists
      suite = document.createElement('div');
      suite.className = 'workspace-suite';
      headerEl.parentNode.insertBefore(suite, headerEl.nextSibling);
      initWorkspaceTabs(suite);

      /* ---------------- Mobile nav (hamburger) ---------------- */
      const burger = document.createElement('button');
      burger.className = 'sandbox-menu-toggle';
      burger.setAttribute('aria-label','Toggle navigation');
      burger.innerHTML = '☰';
      headerEl.insertBefore(burger, headerEl.firstChild);

      burger.addEventListener('click', ()=>{
        headerEl.classList.toggle('is-open');
        const expanded = headerEl.classList.contains('is-open');
        burger.setAttribute('aria-expanded', expanded);
      });

      // Observe header size/position changes (fonts load, dynamic menu, orientation) 
      const ro = new ResizeObserver(syncSuitePosition);
      ro.observe(headerEl);

      // Also keep in sync with full-window resizes
      window.addEventListener('resize', syncSuitePosition);

      // Initial run (after current frame so layout is settled)
      requestAnimationFrame(syncSuitePosition);
    }

    // Save/Load handled inside WorkspaceTabs component

    // Initialize sidebar in collapsed state
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');

    if (sidebar && sidebarToggle) {
        // Collapse the sidebar by default on page load
        sidebar.classList.add('collapsed');
        sidebarToggle.textContent = '⚒︎';

        // Add click event listener to the toggle button
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            
            // Change the toggle button text based on the state
            if (sidebar.classList.contains('collapsed')) {
                sidebarToggle.textContent = '⚒︎';
            } else {
                sidebarToggle.textContent = '✕';
            }
        });
    }

    // Initialize tools
    await initializeTools();
    renderSidebarTools();

    // Initialize cost HUD
    initCostHUD();

    // Restore tool and spell windows from state (localStorage)
    getToolWindows().forEach(win => {
        if (win.isSpell && win.spell) {
            createSpellWindow(
                win.spell,
                { x: win.workspaceX, y: win.workspaceY },
                win.id,
                win.output,
                win.parameterMappings,
                win.outputVersions,
                win.currentVersionIndex,
                win.totalCost,
                win.costVersions
            );
            return;
        }
        if (win.tool) {
            const tool = getAvailableTools().find(t => t.toolId === win.tool.toolId || t.displayName === win.tool.displayName);
            if (tool) {
                createToolWindow(tool, { x: win.workspaceX, y: win.workspaceY }, win.id, win.output);
            }
        }
    });

    // Initialize click handlers
    initClickHandlers();
    initLassoSelection();

    // Spells Menu link handler
    const spellsNavLink = document.querySelector('nav.main-nav a[href="#spells"]');
    if (spellsNavLink) {
        spellsNavLink.addEventListener('click', (e) => {
            e.preventDefault();
            const spellsModal = new SpellsMenuModal();
            spellsModal.show();
        });
    }

    // Mods Menu link handler
    const modsNavLink = document.querySelector('nav.main-nav a[href="#mods"]');
    if (modsNavLink) {
        modsNavLink.addEventListener('click', (e) => {
            e.preventDefault();
            const modsModal = new ModsMenuModal({
                onSelect: (model) => {
                    console.log('[ModsMenuModal] selected', model);
                    // TODO: integrate model addition logic (e.g., createToolWindow or update workflow params)
                }
            });
            modsModal.show();
        });
    }

    // Cook Menu link handler
    const cookNavLink = document.querySelector('nav.main-nav a[href="#cook"]');
    if (cookNavLink) {
        cookNavLink.addEventListener('click', (e) => {
            e.preventDefault();
            const modal = new CookMenuModal();
            modal.show();
        });
    }

    const userMenu = document.querySelector('.user-menu');
    let accountDropdownInstance;
    if (userMenu) {
        userMenu.innerHTML = '';
        accountDropdownInstance = new AccountDropdown(userMenu);
    }

    // Refresh account info when re-auth modal succeeds
    window.addEventListener('reauth-success', () => {
        if (accountDropdownInstance) {
            accountDropdownInstance.fetchDashboard?.();
        } else if (userMenu) {
            userMenu.innerHTML = '';
            accountDropdownInstance = new AccountDropdown(userMenu);
        }
    });

    // After restoring tool windows/nodes on page load:
    renderAllConnections();

    // --- Keyboard Undo/Redo Integration ---
    document.addEventListener('keydown', (e) => {
        // Ctrl+Z (undo)
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            undo();
            rerenderAllToolWindowsAndConnections();
        }
        // Ctrl+Y or Ctrl+Shift+Z (redo)
        if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')) {
            e.preventDefault();
            redo();
            rerenderAllToolWindowsAndConnections();
        }
    });

    function rerenderAllToolWindowsAndConnections() {
        // Remove all tool windows from DOM
        document.querySelectorAll('.tool-window').forEach(el => el.remove());
        // Re-create tool and spell windows from state
        getToolWindows().forEach(win => {
            if (win.isSpell && win.spell) {
                createSpellWindow(win.spell, { x: win.workspaceX, y: win.workspaceY }, win.id, win.output, win.parameterMappings, win.outputVersions, win.currentVersionIndex, win.totalCost, win.costVersions);
                return;
            }
            if (win.tool) {
                const tool = getAvailableTools().find(t => t.toolId === win.tool.toolId || t.displayName === win.tool.displayName);
                if (tool) {
                    createToolWindow(tool, { x: win.workspaceX, y: win.workspaceY }, win.id, win.output);
                } else {
                    console.warn(`Could not find tool definition for '${win.displayName || win.tool?.displayName}' during rerender. It might have been removed or renamed.`);
                }
            }
        });
        // Re-render connections
        renderAllConnections();
    }

    const fabContainer = document.querySelector('.sandbox-canvas');
    const mintSpellFAB = new MintSpellFAB(fabContainer);

    // Function to update FAB visibility
    function updateFAB() {
        const sel = getSelectedNodeIds();
        debugLog('UPDATE_FAB', '[updateFAB] selection size:', sel.size, 'ids:', Array.from(sel));
        mintSpellFAB.update(sel.size);
    }

    // Listen for selection changes
    document.addEventListener('selectionchange', updateFAB);

    // Initial check
    updateFAB();

    // Provide global reload helper for WorkspaceTabs hydration
    let reloadInProgress = false;
    window.__reloadSandboxState = async () => {
        // Prevent concurrent reloads
        if (reloadInProgress) {
            console.warn('[Sandbox] Reload already in progress, skipping duplicate call');
            return;
        }
        
        reloadInProgress = true;
        
        try {
            // Remove all existing tool windows and connection lines
            document.querySelectorAll('.tool-window, .connection-line').forEach(el => el.remove());

            // Re-initialize state from localStorage
            initState();

            // Reload available tools so we can map toolIds to definitions
            // This MUST complete before recreating windows
            await initializeTools();

            const availableTools = getAvailableTools();
            const missingTools = [];
            const missingSpells = [];

            // Re-create windows and connections
            getToolWindows().forEach(win => {
                if (win.isSpell && win.spell) {
                    // Create spell window - SpellWindow will handle async permission errors gracefully
                    // It will show a locked state (🔒) if the spell is private/inaccessible
                    try {
                        const spellWindowEl = createSpellWindow(
                            win.spell,
                            { x: win.workspaceX, y: win.workspaceY },
                            win.id,
                            win.output,
                            win.parameterMappings,
                            win.outputVersions,
                            win.currentVersionIndex,
                            win.totalCost,
                            win.costVersions
                        );
                        
                        // Track spell for potential permission issues (async check happens in SpellWindow)
                        // The window will automatically show locked state if access is denied
                        if (!win.spell.exposedInputs) {
                            // Spell metadata will be loaded asynchronously
                            // If it fails with 403, SpellWindow will show locked state
                            missingSpells.push(win.spell.name || win.spell._id || 'Unknown spell');
                        }
                    } catch (e) {
                        // Only catches synchronous errors during window creation
                        console.error(`[Sandbox] Failed to recreate spell window ${win.id}:`, e);
                        missingSpells.push(win.spell.name || win.spell._id || 'Unknown spell');
                        
                        // Fallback: Create a minimal placeholder if window creation fails completely
                        const placeholder = document.createElement('div');
                        placeholder.className = 'tool-window spell-window spell-locked';
                        placeholder.id = win.id;
                        placeholder.style.left = `${win.workspaceX}px`;
                        placeholder.style.top = `${win.workspaceY}px`;
                        placeholder.innerHTML = `
                            <div class="tool-window-header">
                                <span>🔒 Private Spell</span>
                            </div>
                            <div class="tool-window-body" style="padding: 24px; text-align: center; color: #999;">
                                <div style="font-size: 32px; margin-bottom: 12px; opacity: 0.7;">🔒</div>
                                <div style="font-weight: bold; margin-bottom: 8px; color: #666;">Private Spell</div>
                                <div style="font-size: 14px; margin-bottom: 4px; color: #888;">Unable to load spell window.</div>
                                <div style="font-size: 12px; margin-top: 12px; color: #999; font-family: monospace;">Spell ID: ${win.spell._id || 'unknown'}</div>
                            </div>
                        `;
                        document.querySelector('.sandbox-canvas')?.appendChild(placeholder);
                    }
                    return;
                }
                
                if (win.type === 'collection') {
                    // Collection windows - would need collection registry
                    console.warn(`[Sandbox] Collection windows not yet supported in reload: ${win.id}`);
                    return;
                }
                
                if (win.tool) {
                    // Prioritize toolId match over displayName for accuracy
                    let tool = null;
                    if (win.tool.toolId) {
                        tool = availableTools.find(t => t.toolId === win.tool.toolId);
                    }
                    if (!tool && win.tool.displayName) {
                        tool = availableTools.find(t => t.displayName === win.tool.displayName);
                    }
                    
                    if (tool) {
                        try {
                            createToolWindow(tool, { x: win.workspaceX, y: win.workspaceY }, win.id, win.output);
                        } catch (e) {
                            console.error(`[Sandbox] Failed to recreate tool window ${win.id}:`, e);
                            missingTools.push(win.tool.displayName || win.tool.toolId);
                        }
                    } else {
                        missingTools.push(win.tool.displayName || win.tool.toolId);
                    }
                }
            });

            // Warn about missing tools/spells
            if (missingTools.length > 0) {
                console.warn(`[Sandbox] Could not recreate ${missingTools.length} tool window(s):`, missingTools);
            }
            if (missingSpells.length > 0) {
                console.warn(`[Sandbox] Could not recreate ${missingSpells.length} spell window(s):`, missingSpells);
            }

            renderAllConnections();
        } catch (e) {
            console.error('[Sandbox] Error during state reload:', e);
            throw e; // Re-throw so caller knows it failed
        } finally {
            reloadInProgress = false;
        }
    };

    // Use async handler for event listener
    window.addEventListener('sandboxSnapshotUpdated', async () => {
        try {
            await window.__reloadSandboxState();
        } catch (e) {
            console.error('[Sandbox] Failed to reload state after snapshot update:', e);
        }
    });

    // Upload button in action-modal
    const uploadBtn = document.querySelector('.action-modal .upload-btn');
    if (uploadBtn) {
        uploadBtn.addEventListener('click', () => {
            const pos = calculateCenterPosition(getToolWindows());
            createUploadWindow({ id: `upload-${Date.now()}`, position: pos });
            hideModal();
        });
    }

    // Paste image to create upload window
    document.addEventListener('paste', (e) => {
        const item = [...e.clipboardData.items].find(i => i.type.startsWith('image/'));
        if (!item) return;
        const file = item.getAsFile();
        const { x, y } = screenToWorkspace(e.clientX, e.clientY);
        const win = createUploadWindow({ id: `upload-${Date.now()}`, position: { x, y } });
        win.loadPastedFile?.(file);
    });
});

function initLassoSelection() {
    const canvas = document.querySelector('.sandbox-canvas');

    canvas.addEventListener('mousedown', (e) => {
        // Figma-style: only start lasso with left mouse, no spacebar
        // Exclude tool windows and their interactive elements from lasso selection
        const isToolWindow = e.target.closest('.tool-window, .spell-window');
        if (isToolWindow) return; // Don't start lasso when clicking on tool windows
        
        // Only start lasso when clicking directly on canvas background
        const isCanvasClick = e.target === canvas || 
                             (e.target.classList && e.target.classList.contains('sandbox-bg'));
        if (e.button !== 0 || !isCanvasClick || spacebarIsDown) return;

        lasso.active = true;
        lasso.x1 = e.clientX;
        lasso.y1 = e.clientY;

        if (!lasso.element) {
            lasso.element = document.createElement('div');
            lasso.element.className = 'lasso-rect';
            document.body.appendChild(lasso.element);
        }
        lasso.element.style.display = 'block';
        updateLassoRect(e);
        e.preventDefault();
        e.stopPropagation(); // Stop event from bubbling to pan listener
    });

    document.addEventListener('mousemove', (e) => {
        if (!lasso.active) return;
        updateLassoRect(e);
    });

    document.addEventListener('mouseup', (e) => {
        if (!lasso.active) return;
        
        // Don't interfere with drag operations - check if we're dragging a window
        const isDraggingWindow = e.target.closest('.tool-window, .spell-window');
        if (isDraggingWindow) {
            lasso.active = false;
            if (lasso.element) lasso.element.style.display = 'none';
            return;
        }
        
        e.preventDefault();
        // Use stopPropagation instead of stopImmediatePropagation to allow drag handlers to run
        e.stopPropagation();
        
        // Hide the lasso element immediately
        if (lasso.element) {
            lasso.element.style.display = 'none';
        }

        const dx = Math.abs(lasso.x1 - lasso.x2);
        const dy = Math.abs(lasso.y1 - lasso.y2);

        // Deactivate lasso state *after* getting final coordinates
        lasso.active = false;
        
        // If the lasso is too small, treat it as a click and do nothing
        if (dx < 10 && dy < 10) {
            return;
        }

        // One-time capture-phase click suppression
        function suppressNextClick(ev) {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            document.removeEventListener('click', suppressNextClick, true);
            console.log('[SUPPRESS] Suppressed next click after lasso');
        }
        document.addEventListener('click', suppressNextClick, true);

        const lassoRect = {
            left: Math.min(lasso.x1, lasso.x2),
            right: Math.max(lasso.x1, lasso.x2),
            top: Math.min(lasso.y1, lasso.y2),
            bottom: Math.max(lasso.y1, lasso.y2)
        };
        
        const selectedIdsInLasso = new Set();
        getToolWindows().forEach(win => {
            const el = document.getElementById(win.id);
            if (!el) return;
            
            const elRect = el.getBoundingClientRect();

            // AABB (Axis-Aligned Bounding Box) intersection test
            if (
                elRect.left < lassoRect.right &&
                elRect.right > lassoRect.left &&
                elRect.top < lassoRect.bottom &&
                elRect.bottom > lassoRect.top
            ) {
                selectedIdsInLasso.add(win.id);
            }
        });

        // If shift is not held, clear the previous selection *before* adding the new one.
        if (!e.shiftKey) {
            clearSelection();
        }

        // Select all the nodes that were within the lasso
        if (selectedIdsInLasso.size > 0) {
            console.log('[LASSO] Selecting nodes:', Array.from(selectedIdsInLasso));
            selectedIdsInLasso.forEach(id => {
                selectNode(id, true); // `true` for additive selection
            });
        }
    });

    function updateLassoRect(e) {
        if (!lasso.element) return;
        lasso.x2 = e.clientX;
        lasso.y2 = e.clientY;
        const x = Math.min(lasso.x1, lasso.x2);
        const y = Math.min(lasso.y1, lasso.y2);
        const width = Math.abs(lasso.x1 - lasso.x2);
        const height = Math.abs(lasso.y1 - lasso.y2);
        lasso.element.style.left = `${x}px`;
        lasso.element.style.top = `${y}px`;
        lasso.element.style.width = `${width}px`;
        lasso.element.style.height = `${height}px`;
    }
}

// Initialize click interaction elements
const rippleElement = document.createElement('img');
rippleElement.src = '/images/workspace/circularwaterripple.gif';
rippleElement.className = 'click-ripple';
document.body.appendChild(rippleElement);

// Create action modal
const actionModal = document.createElement('div');
actionModal.className = 'action-modal';

// Create the main buttons and submenu
const createSubmenu = document.createElement('div');
createSubmenu.className = 'create-submenu';
createSubmenu.innerHTML = `
    <button type="button" data-type="image"><span>image</span> <span>🖼️</span></button>
    <button type="button" data-type="sound"><span>sound</span> <span>🎵</span></button>
    <button type="button" data-type="text"><span>text</span> <span>📝</span></button>
    <button type="button" data-type="movie"><span>movie</span> <span>🎬</span></button>
`;

actionModal.innerHTML = `
    <button type="button" class="upload-btn"><span>upload</span> <span>📎</span></button>
    <button type="button" class="create-btn"><span>create</span> <span>🎨</span></button>
`;

// Append submenu to the create button
const createBtn = actionModal.querySelector('.create-btn');
createBtn.appendChild(createSubmenu);

// Add direct event listener to createBtn to show submenu and stop propagation
createBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    createSubmenu.classList.add('active');
    setSubmenuState(true);
    // Add click-outside and Escape handlers
    function handleClickOutsideSubmenu(ev) {
        if (!createSubmenu.contains(ev.target) && ev.target !== createBtn) {
            createSubmenu.classList.remove('active');
            setSubmenuState(false);
            document.removeEventListener('click', handleClickOutsideSubmenu);
            document.removeEventListener('keydown', handleEscapeSubmenu);
        }
    }
    function handleEscapeSubmenu(ev) {
        if (ev.key === 'Escape') {
            createSubmenu.classList.remove('active');
            setSubmenuState(false);
            document.removeEventListener('click', handleClickOutsideSubmenu);
            document.removeEventListener('keydown', handleEscapeSubmenu);
        }
    }
    setTimeout(() => {
        document.addEventListener('click', handleClickOutsideSubmenu);
        document.addEventListener('keydown', handleEscapeSubmenu);
    }, 0);
});
// Prevent clicks inside the submenu from propagating and closing the modal
createSubmenu.addEventListener('click', (e) => {
    e.stopPropagation();
});

// Add direct event listener to submenu buttons to show tool selection modal and stop propagation
createSubmenu.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const type = btn.dataset.type;
        showToolsForCategory(type, e.clientX, e.clientY);
    });
});

document.body.appendChild(actionModal);

// Initialize click handlers
function initClickHandlers() {
    // Handle click interactions
    document.addEventListener('click', (e) => {
        debugLog('CLICK_HANDLER', '[CLICK HANDLER]', e.target, getSelectedNodeIds().size);
        if (justLassoed) {
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
        }

        const isNodeOrUI = e.target.closest('.tool-window, .action-modal, #sidebar, #sidebar-toggle, .create-submenu, .cost-hud');
        // If the click is on a node, the node's own handler will manage selection.
        // If it's on other UI, do nothing.
        // If it's on the background, clear selection.
        if (!isNodeOrUI) {
             if (getSelectedNodeIds().size > 0) {
                clearSelection();
            }
        }

        // Prevent modal from opening when interacting with sidebar, tool windows, or other modals.
        if (e.target.closest('.tool-window, .action-modal, #sidebar, #sidebar-toggle, .cost-hud')) {
            return;
        }
        
        const clickedSubmenuBtn = e.target.closest('.create-submenu button');
        const clickedUploadBtn = e.target.closest('.upload-btn');

        // Handle submenu option click first (since it's more specific)
        if (clickedSubmenuBtn) {
            e.stopPropagation();
            const type = clickedSubmenuBtn.dataset.type;
            showToolsForCategory(type, e.clientX, e.clientY); // Pass screen coordinates
            return;
        }

        // Handle upload button click
        if (clickedUploadBtn) {
            showUploadInterface(actionModal);
            return;
        }

        // If modal is active and click is outside, hide it
        if (actionModal.classList.contains('active')) {
            hideModal();
            return;
        }

        // Only handle clicks in the sandbox area to show the action modal
        const sandbox = document.querySelector('.sandbox-content');
        if (sandbox.contains(e.target)) {

            // Show ripple effect at the correct screen position
        rippleElement.style.left = `${e.clientX}px`;
        rippleElement.style.top = `${e.clientY}px`;
        rippleElement.classList.add('active');

        // Hide ripple after animation
        setTimeout(() => {
            rippleElement.classList.remove('active');
        }, 300);

        // Position and show modal
            const { x: workspaceX, y: workspaceY } = window.sandbox.screenToWorkspace(e.clientX, e.clientY);
            setLastClickPosition({ x: workspaceX, y: workspaceY });

        const rect = sandbox.getBoundingClientRect();
        const modalHeight = 60; // Approximate height of modal
        const padding = 20; // Padding from edges

        let modalX = e.clientX;
        let modalY = e.clientY - modalHeight - padding; // Try to position above click

        // If too close to top, position below click
        if (modalY < rect.top + padding) {
            modalY = e.clientY + padding;
        }

        // Ensure modal stays within sandbox bounds
        modalX = Math.max(rect.left + padding, Math.min(rect.right - padding, modalX));
        modalY = Math.max(rect.top + padding, Math.min(rect.bottom - padding, modalY));

        actionModal.style.left = `${modalX}px`;
        actionModal.style.top = `${modalY}px`;
        actionModal.classList.add('active');
        setModalState(true);
        }
    });
}

// Show upload interface
function showUploadInterface(modal) {
    const originalContent = modal.innerHTML;
    
    modal.innerHTML = `
        <div class="upload-area">
            <p>Drag & drop an image, or click</p>
            <input type="file" id="image-upload-input" style="display:none" accept="image/*">
        </div>
        <button type="button" class="modal-cancel-btn">Cancel</button>
    `;

    const uploadArea = modal.querySelector('.upload-area');
    const fileInput = modal.querySelector('#image-upload-input');
    const cancelBtn = modal.querySelector('.modal-cancel-btn');

    const handleFileSelect = (file) => {
        if (file && file.type.startsWith('image/')) {
            const position = getLastClickPosition();
            uploadFile(file, modal, position);
        } else {
            alert('Please select an image file.');
        }
    };

    uploadArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => handleFileSelect(e.target.files[0]));

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        uploadArea.addEventListener(eventName, () => uploadArea.classList.add('active'));
    });

    ['dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, () => uploadArea.classList.remove('active'));
    });

    uploadArea.addEventListener('drop', (e) => {
        const position = getLastClickPosition();
        if (e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files[0], position);
        }
    });

    cancelBtn.addEventListener('click', () => {
        modal.innerHTML = originalContent;
        hideModal();
    });
} 
