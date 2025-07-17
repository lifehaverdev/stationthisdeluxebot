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
    redo
} from './state.js';
import { initializeTools, uploadFile } from './io.js';
import { createToolWindow } from './node/index.js';
import { createImageInSandbox } from './components/image.js';
import { initCanvas, updateConnectionLine } from './canvas.js';
import { calculateCenterPosition, hideModal } from './utils.js';
import { showToolsForCategory, renderSidebarTools } from './toolSelection.js';
import AccountDropdown from './components/accountDropdown.js';
import './components/BuyPointsModal/buyPointsModal.js';
import SpellsMenuModal from './components/SpellsMenuModal.js';
import { renderAllConnections } from './connections/index.js';
import './components/ReferralVaultModal/referralVaultModal.js';

// Initialize sandbox functionality
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize state
    initState();

    // Add .sandbox-canvas wrapper if not present
    const sandboxContent = document.querySelector('.sandbox-content');
    const canvas = document.querySelector('.sandbox-canvas');
    if (!canvas) {
        console.error("Sandbox canvas not found!");
        return;
    }
    // Move all tool windows and connections into canvas (if any)
    Array.from(sandboxContent.querySelectorAll('.tool-window, .connection-line')).forEach(el => canvas.appendChild(el));

    // Zoom/pan state
    let scale = 1;
    let pan = { x: 0, y: 0 };
    const minScale = 0.2, maxScale = 4.0; // Adjusted zoom limits
    const gridSize = 32;

    function workspaceToScreen(x, y) {
        return { x: (x * scale) + pan.x, y: (y * scale) + pan.y };
    }

    function screenToWorkspace(x, y) {
        return { x: (x - pan.x) / scale, y: (y - pan.y) / scale };
    }

    function renderAllWindows() {
        getToolWindows().forEach(win => {
            const el = document.getElementById(win.id);
            if (el) {
                const { x, y } = workspaceToScreen(win.workspaceX, win.workspaceY);
                el.style.left = `${x}px`;
                el.style.top = `${y}px`;
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
        // Optional: zoom to cursor
        if (centerX !== undefined && centerY !== undefined) {
            const rect = canvas.getBoundingClientRect();
            const offsetX = centerX - rect.left;
            const offsetY = centerY - rect.top;
            const prevScale = scale;
            scale = Math.max(minScale, Math.min(maxScale, newScale));
            pan.x = (pan.x - offsetX) * (scale / prevScale) + offsetX;
            pan.y = (pan.y - offsetY) * (scale / prevScale) + offsetY;
        } else {
            scale = Math.max(minScale, Math.min(maxScale, newScale));
        }
        updateTransform();
    }
    function resetZoomPan() {
        scale = 1;
        pan = { x: 0, y: 0 };
        updateTransform();
    }
    updateTransform();

    // Mouse wheel zoom
    sandboxContent.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.preventDefault();
            const zoomFactor = 1.1;
            const oldScale = scale;
            const newScale = scale * (e.deltaY < 0 ? zoomFactor : 1 / zoomFactor);
            setScale(newScale, e.clientX, e.clientY);
        }
    }, { passive: false });

    // Mouse drag pan
    let isPanning = false, start = { x: 0, y: 0 }, panStart = { x: 0, y: 0 };
    sandboxContent.addEventListener('mousedown', (e) => {
        // Pan only when clicking on the background, not on other elements.
        if (e.target === canvas || e.target.classList.contains('sandbox-bg')) {
            isPanning = true;
            start = { x: e.clientX, y: e.clientY };
            panStart = { ...pan };
            sandboxContent.style.cursor = 'grabbing';
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
    let lastTouchDist = null, lastTouchCenter = null;
    sandboxContent.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            // Pan with one finger
            if (e.target === canvas || e.target.classList.contains('sandbox-bg')) {
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
            // Pinch zoom
            setScale(scale * (newDist / lastTouchDist), newCenter.x, newCenter.y);
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

    // Initialize sidebar in collapsed state
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');

    if (sidebar && sidebarToggle) {
        // Collapse the sidebar by default on page load
        sidebar.classList.add('collapsed');
        sidebarToggle.textContent = '>';

        // Add click event listener to the toggle button
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            
            // Change the toggle button text based on the state
            if (sidebar.classList.contains('collapsed')) {
                sidebarToggle.textContent = '>';
            } else {
                sidebarToggle.textContent = '<';
            }
        });
    }

    // Initialize tools
    await initializeTools();
    renderSidebarTools();

    // Restore tool windows from state (localStorage)
    getToolWindows().forEach(win => {
        // Find the tool by displayName from availableTools
        const tool = getAvailableTools().find(t => t.displayName === win.tool.displayName);
        if (tool) {
            createToolWindow(tool, { x: win.workspaceX, y: win.workspaceY }, win.id, win.output);
        }
    });

    // Initialize click handlers
    initClickHandlers();

    // Spells Menu link handler
    const spellsNavLink = document.querySelector('nav.main-nav a[href="#spells"]');
    if (spellsNavLink) {
        spellsNavLink.addEventListener('click', (e) => {
            e.preventDefault();
            const spellsModal = new SpellsMenuModal();
            spellsModal.show();
        });
    }

    const userMenu = document.querySelector('.user-menu');
    if (userMenu) {
        // Clear existing content (e.g., 'Account' text)
        userMenu.innerHTML = '';
        new AccountDropdown(userMenu);
    }

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
        // Re-create tool windows from state
        getToolWindows().forEach(win => {
            // Find the tool by displayName from availableTools
            const tool = getAvailableTools().find(t => t.displayName === win.displayName);
            if (tool) {
                createToolWindow(tool, { x: win.workspaceX, y: win.workspaceY }, win.id, win.output);
            } else {
                console.warn(`Could not find tool definition for '${win.displayName}' during rerender. It might have been removed or renamed.`);
            }
        });
        // Re-render connections
        renderAllConnections();
    }
});

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
        // Prevent modal from opening when interacting with sidebar, tool windows, or other modals.
        if (e.target.closest('.tool-window, .action-modal, #sidebar, #sidebar-toggle')) {
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