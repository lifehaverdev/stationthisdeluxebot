document.addEventListener('DOMContentLoaded', () => {
    const logoutButton = document.getElementById('logout-button');

    if (logoutButton) {
        logoutButton.style.display = 'block';
        logoutButton.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.href = '/logout';
        });
    }
});

// Canonical CSRF token utility
(function() {
    let csrfToken = null;
    async function ensureCsrfToken() {
        if (!csrfToken) {
            try {
                const res = await fetch('/api/v1/csrf-token', { credentials: 'include' });
                if (!res.ok) {
                    const errorData = await res.json().catch(() => ({}));
                    throw new Error(errorData.error?.message || 'Could not fetch CSRF token');
                }
                const data = await res.json();
                csrfToken = data.csrfToken;
            } catch(err) {
                console.error('CSRF Token Error:', err);
                throw err;
            }
        }
        return csrfToken;
    }
    // Optionally allow for future reset/refresh
    function resetCsrfToken() { csrfToken = null; }
    window.auth = window.auth || {};
    window.auth.ensureCsrfToken = ensureCsrfToken;
    window.auth.resetCsrfToken = resetCsrfToken;
})(); 