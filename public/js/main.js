document.addEventListener('DOMContentLoaded', () => {
  const menuToggle = document.getElementById('menu-toggle');
  const mainNav = document.getElementById('main-nav');

  if (menuToggle && mainNav) {
    menuToggle.addEventListener('click', () => {
      mainNav.classList.toggle('is-open');
    });
  }

  // Modal Logic
  const loginModalTrigger = document.getElementById('login-modal-trigger');
  const loginModal = document.getElementById('login-modal');
  const modalCloseBtn = loginModal.querySelector('.modal-close');

  if (loginModalTrigger && loginModal && modalCloseBtn) {
    // Show modal on trigger click
    loginModalTrigger.addEventListener('click', () => {
      loginModal.classList.add('is-visible');
    });

    // Hide modal on close button click
    modalCloseBtn.addEventListener('click', () => {
      loginModal.classList.remove('is-visible');
    });

    // Hide modal when clicking on the overlay
    loginModal.addEventListener('click', (e) => {
      if (e.target === loginModal) {
        loginModal.classList.remove('is-visible');
      }
    });
  }

  // Render Features
  const featuresContainer = document.getElementById('features-container');
  if (featuresContainer) {
    fetch('/api/v1/tools')
      .then(response => response.json())
      .then(tools => {
        // Clear any placeholder content if necessary
        featuresContainer.innerHTML = ''; 

        tools.forEach(tool => {
          const tile = document.createElement('div');
          tile.className = 'feature-tile';
          
          const title = document.createElement('h4');
          title.textContent = tool.displayName;
          
          const desc = document.createElement('p');
          desc.textContent = tool.description;
          
          tile.appendChild(title);
          tile.appendChild(desc);
          
          featuresContainer.appendChild(tile);
        });
      })
      .catch(error => {
        console.error('Error fetching features:', error);
        featuresContainer.innerHTML = '<p>Could not load features at this time.</p>';
      });
  }

  // Render Reviews
  const reviewsContainer = document.getElementById('reviews-container');
  if (reviewsContainer) {
    fetch('/reviews.json')
      .then(response => response.json())
      .then(reviews => {
        reviews.forEach(review => {
          const card = document.createElement('div');
          card.className = 'review-card';

          card.innerHTML = `
            <div class="review-header">
              <img src="${review.profilePicture}" alt="${review.username}'s profile picture" class="profile-pic">
              <div class="reviewer-info">
                <span class="reviewer-name">${review.username}</span>
                <div class="stars">${'★'.repeat(review.stars)}${'☆'.repeat(5 - review.stars)}</div>
              </div>
            </div>
            <p class="review-text">${review.review}</p>
          `;
          reviewsContainer.appendChild(card);
        });
      })
      .catch(error => console.error('Error fetching reviews:', error));
  }

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