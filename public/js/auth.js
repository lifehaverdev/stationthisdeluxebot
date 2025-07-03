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