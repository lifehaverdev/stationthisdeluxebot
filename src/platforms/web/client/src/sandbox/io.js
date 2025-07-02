import { setAvailableTools } from './state.js';
import { hideModal } from './utils.js';
import { createImageInSandbox } from './components/image.js';
import { lastClickPosition } from './state.js';

// Initialize tools from API
export async function initializeTools() {
    console.log('Initializing tools...');
    try {
        // Use the registry endpoint to get full tool data
        const response = await fetch('/api/v1/tools/registry');
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Failed to fetch tools:', response.status, response.statusText, errorText);
            throw new Error(`Failed to fetch tools: ${response.status} ${response.statusText} - ${errorText}`);
        }
        const tools = await response.json();
        console.log('Fetched tools with full registry data:', tools);
        setAvailableTools(tools);
        return tools;
    } catch (error) {
        console.error('Error initializing tools:', error);
        // Show the error in the UI
        const toolsContainer = document.querySelector('.tools-container');
        if (toolsContainer) {
            toolsContainer.innerHTML = `
                <div style="color: #ff6b6b; padding: 16px; text-align: center; font-family: monospace;">
                    Failed to load tools: ${error.message}
                </div>
            `;
        }
        return [];
    }
}

// Upload file to storage
export async function uploadFile(file, modal) {
    const uploadArea = modal.querySelector('.upload-area');
    if (uploadArea) {
        uploadArea.innerHTML = `<p>Uploading ${file.name}...</p>`;
    }

    try {
        const response = await fetch('/api/v1/storage/upload-url', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fileName: file.name, contentType: file.type }),
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error.message || 'Could not get signed URL.');
        }
        const { signedUrl, permanentUrl } = await response.json();

        // Parse the signed URL to get the required parameters
        const url = new URL(signedUrl);
        
        // Extract the host from the URL
        const host = url.hostname;

        // Actually upload the file to the signed URL from R2
        const uploadResponse = await fetch(signedUrl, {
            method: 'PUT',
            body: file,
            headers: {
                'Content-Type': file.type,
                'Content-Length': file.size.toString(),
                'Host': host,
                // Include only the required AWS headers from the URL
                'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
                'x-amz-checksum-crc32': 'AAAAAA=='
            }
        });

        if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            throw new Error(`Failed to upload file to storage: ${errorText}`);
        }

        createImageInSandbox(permanentUrl, lastClickPosition);
    } catch (error) {
        console.error('Upload failed:', error);
        alert(`Upload failed: ${error.message}`);
    } finally {
        hideModal();
    }
} 