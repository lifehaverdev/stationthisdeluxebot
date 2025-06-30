document.addEventListener('DOMContentLoaded', () => {
  // Mobile Menu Toggle
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
  
  if (loginModal) {
    const modalCloseBtn = loginModal.querySelector('.modal-close');

    if (loginModalTrigger && modalCloseBtn) {
      // Show modal on trigger click
      loginModalTrigger.addEventListener('click', () => {
        // Set a cookie to bypass auth for development, then redirect.
        document.cookie = 'dev_auth_bypass=true; path=/; max-age=3600'; // Expires in 1 hour
        window.location.href = '/';
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
  }

  // "Show More" for About Section
  const aboutToggle = document.getElementById('about-toggle');
  const expandableAbout = document.getElementById('expandable-about');

  if(aboutToggle && expandableAbout) {
    aboutToggle.addEventListener('click', () => {
      const isExpanded = expandableAbout.classList.contains('expanded');
      if (isExpanded) {
        expandableAbout.classList.remove('expanded');
        aboutToggle.textContent = 'Show More';
      } else {
        expandableAbout.classList.add('expanded');
        aboutToggle.textContent = 'Show Less';
      }
    });
  }
}); 