import { initState, setModalState, setSubmenuState, getLastClickPosition, getAvailableTools, OUTPUT_TYPE_MAPPING } from './state.js';
import { initializeTools, uploadFile } from './io.js';
import { createToolWindow } from './node.js';
import { createImageInSandbox } from './components/image.js';
import { initCanvas, updateConnectionLine } from './canvas.js';
import { calculateCenterPosition, hideModal } from './utils.js';
import { showToolsForCategory, renderSidebarTools } from './toolSelection.js';
import AccountDropdown from './components/accountDropdown.js';

// Initialize sandbox functionality
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize state
    initState();

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

    // Initialize click handlers
    initClickHandlers();

    const userMenu = document.querySelector('.user-menu');
    if (userMenu) {
        // Clear existing content (e.g., 'Account' text)
        userMenu.innerHTML = '';
        new AccountDropdown(userMenu);
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

document.body.appendChild(actionModal);

// Initialize click handlers
function initClickHandlers() {
    // Handle click interactions
    document.addEventListener('click', (e) => {
        const clickedCreateBtn = e.target.closest('.create-btn');
        const clickedSubmenuBtn = e.target.closest('.create-submenu button');
        const clickedUploadBtn = e.target.closest('.upload-btn');

        // Handle submenu option click first (since it's more specific)
        if (clickedSubmenuBtn) {
            console.log('Submenu button clicked:', clickedSubmenuBtn.dataset.type);
            e.stopPropagation();
            const type = clickedSubmenuBtn.dataset.type;
            showToolsForCategory(type, e.clientX, e.clientY);
            return;
        }

        // Handle create button click (but not if we clicked a submenu button)
        if (clickedCreateBtn && !clickedSubmenuBtn) {
            console.log('Create button clicked');
            e.stopPropagation();
            createSubmenu.classList.add('active');
            setSubmenuState(true);
            return;
        }

        // Handle upload button click
        if (clickedUploadBtn) {
            console.log('Upload button clicked');
            showUploadInterface(actionModal);
            return;
        }

        // If modal is active and click is outside, hide it
        if (actionModal.classList.contains('active')) {
            console.log('Clicking outside modal, hiding it');
            hideModal();
            return;
        }

        // Only handle clicks in the sandbox area
        const sandbox = document.querySelector('.sandbox-content');
        if (!sandbox || !sandbox.contains(e.target)) {
            return;
        }

        console.log('Sandbox area clicked, showing action modal');

        // Show ripple effect
        rippleElement.style.left = `${e.clientX}px`;
        rippleElement.style.top = `${e.clientY}px`;
        rippleElement.classList.add('active');

        // Hide ripple after animation
        setTimeout(() => {
            rippleElement.classList.remove('active');
        }, 300);

        // Position and show modal
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
            uploadFile(file, modal);
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
        handleFileSelect(e.dataTransfer.files[0]);
    });

    cancelBtn.addEventListener('click', () => {
        modal.innerHTML = originalContent;
        hideModal();
    });
} 