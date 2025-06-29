document.addEventListener('DOMContentLoaded', function() {
    const hamburger = document.getElementById('hamburger-menu');
    const mobileNav = document.getElementById('main-nav');
    
    if (hamburger && mobileNav) {
        hamburger.addEventListener('click', function() {
            mobileNav.classList.toggle('is-open');
        });
    }

    const loginBtn = document.getElementById('login-btn');
    const mobileLoginBtn = document.getElementById('mobile-login-btn');
    const modal = document.getElementById('login-modal');
    const closeButton = document.querySelector('.modal .close-button');

    function openModal() {
        if (modal) modal.style.display = 'flex';
    }

    function closeModal() {
        if (modal) modal.style.display = 'none';
    }

    if (loginBtn) loginBtn.addEventListener('click', openModal);
    if (mobileLoginBtn) mobileLoginBtn.addEventListener('click', () => {
        // First close the mobile nav if it's open
        if (mobileNav && mobileNav.classList.contains('is-open')) {
            mobileNav.classList.remove('is-open');
        }
        openModal();
    });
    if (closeButton) closeButton.addEventListener('click', closeModal);

    // Close modal if clicking outside of the modal-content
    window.addEventListener('click', function(event) {
        if (event.target === modal) {
            closeModal();
        }
    });

    // Dynamic content loading for features and reviews
    async function renderFeatures() {
        const featuresContainer = document.getElementById('features-container');
        if (!featuresContainer) return;

        try {
            const response = await fetch('/api/v1/tools');
            const tools = await response.json();

            // Filter for some interesting, diverse tools to feature
            const featuredToolNames = ['/make', '/effect', '/understand', '/tag', '/makevideo'];
            const featuredTools = tools.filter(t => featuredToolNames.includes(t.commandName));

            featuresContainer.innerHTML = featuredTools.map(tool => {
                const commandId = tool.commandName.replace('/', '');
                return `
                    <a href="/docs#tools#${commandId}" class="feature-tile">
                        <h4>${tool.displayName}</h4>
                        <p>${tool.description.split('.')[0]}.</p>
                    </a>
                `;
            }).join('');
        } catch (error) {
            console.error('Error fetching features:', error);
            featuresContainer.innerHTML = '<p>Could not load features at this time.</p>';
        }
    }

    async function renderReviews() {
        const reviewsContainer = document.getElementById('reviews-container');
        if (!reviewsContainer) return;

        try {
            const response = await fetch('/reviews.json');
            const reviews = await response.json();
            reviewsContainer.innerHTML = reviews.map(review => `
                <div class="panel review-card">
                    <div class="review-header">
                        <img src="${review.profilePicture}" alt="${review.username}'s avatar" class="profile-pic">
                        <div class="reviewer-info">
                            <span class="reviewer-name">${review.username}</span>
                        </div>
                    </div>
                    <p class="review-text">"${review.review}"</p>
                </div>
            `).join('');
        } catch (error) {
            console.error('Error fetching reviews:', error);
            reviewsContainer.innerHTML = '<p>Could not load reviews at this time.</p>';
        }
    }

    renderFeatures();
    renderReviews();

    // Render "Used By" Section
    const usedByContainer = document.getElementById('usedby-container');
    if (usedByContainer) {
        fetch('/usedby.json')
            .then(response => response.json())
            .then(projects => {
                projects.forEach(project => {
                    const link = document.createElement('a');
                    link.href = project.externalUrl;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.className = 'usedby-tile';

                    link.innerHTML = `
                        <img src="${project.imageUrl}" alt="${project.collectionName}">
                        <div class="tile-overlay">
                            <span>${project.collectionName}</span>
                        </div>
                    `;
                    usedByContainer.appendChild(link);
                });
            })
            .catch(error => console.error('Error fetching used by data:', error));
    }

    // "About" section expander
    const aboutToggle = document.getElementById('about-toggle');
    if (aboutToggle) {
        const expandableContent = document.getElementById('expandable-about');
        aboutToggle.addEventListener('click', () => {
            expandableContent.classList.toggle('is-expanded');
            aboutToggle.textContent = expandableContent.classList.contains('is-expanded') ? 'Show Less' : 'Show More';
        });
    }
}); 