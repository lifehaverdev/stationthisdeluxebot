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

    // --- Rating UI ---
    if (output.generationId) {
        const ratingContainer = document.createElement('div');
        ratingContainer.className = 'result-rating-container';
        ratingContainer.style.marginTop = '8px';

        const ratings = [
            { key: 'beautiful', emoji: '😻' },
            { key: 'funny',     emoji: '😹' },
            { key: 'sad',       emoji: '😿' }
        ];

        ratings.forEach(r => {
            const btn = document.createElement('button');
            btn.textContent = r.emoji;
            btn.style.fontSize = '24px';
            btn.style.marginRight = '4px';
            btn.title = r.key;

            btn.addEventListener('click', async () => {
                btn.disabled = true;
                try {
                    const csrfRes = await fetch('/api/v1/csrf-token');
                    const { csrfToken } = await csrfRes.json();

                    await fetch('/api/v1/generation/rate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
                        credentials: 'include',
                        body: JSON.stringify({ generationId: output.generationId, rating: r.key })
                    });
                    ratingContainer.textContent = 'Thank you for rating!';
                } catch (err) {
                    console.error('[Rating] Failed to submit rating', err);
                    ratingContainer.textContent = 'Rating failed.';
                }
            });

            ratingContainer.appendChild(btn);
        });

        resultContainer.appendChild(ratingContainer);
    }
} 