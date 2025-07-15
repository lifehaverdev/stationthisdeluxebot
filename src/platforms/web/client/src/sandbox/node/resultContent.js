import { showImageOverlay } from './overlays/imageOverlay.js';

export function renderResultContent(resultContainer, output) {
    resultContainer.innerHTML = '';
    if (output.type === 'image' && output.url) {
        resultContainer.innerHTML = `<p>Completed!</p><img src="${output.url}" alt="Generated Image" class="result-image" style="max-width: 100%; max-height: 300px; display: block; margin: 8px 0; cursor: pointer;" />`;
        // Add click handler for overlay
        const img = resultContainer.querySelector('.result-image');
        img.addEventListener('click', () => {
            showImageOverlay(output.url);
        });
        // Optionally render a caption if present
        if (output.caption) {
            const captionDiv = document.createElement('div');
            captionDiv.className = 'result-caption';
            captionDiv.textContent = output.caption;
            resultContainer.appendChild(captionDiv);
        }
    } else if (output.type === 'text' && output.text) {
        // Render text output in a styled div for chat or captions
        const textDiv = document.createElement('div');
        textDiv.className = 'result-text-output';
        textDiv.textContent = output.text;
        resultContainer.appendChild(textDiv);
        // Optionally render a caption if present
        if (output.caption) {
            const captionDiv = document.createElement('div');
            captionDiv.className = 'result-caption';
            captionDiv.textContent = output.caption;
            resultContainer.appendChild(captionDiv);
        }
    } else {
        resultContainer.textContent = 'Output available.';
    }
} 