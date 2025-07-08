// ... existing code ...
import { setupWalletGate, adminVerified, onAdminStatusChange } from './wallet-gate.js';

function showNotAuthorized() {
    document.body.innerHTML = '<div style="text-align:center;margin-top:100px;"><h2>Not Authorized</h2><p>You must connect an admin wallet to access this dashboard.</p></div>';
}

function showLoading() {
    document.body.innerHTML = '<div style="text-align:center;margin-top:100px;"><h2>Loading...</h2></div>';
}

// Defer all dashboard logic until admin is verified
showLoading();

setupWalletGate();

onAdminStatusChange((isAdmin) => {
    if (isAdmin) {
        // Restore the original HTML (admin.html) and initialize dashboard
        window.location.reload(); // Reload to restore DOM and re-run dashboard logic
    } else {
        showNotAuthorized();
    }
});

// Only run dashboard logic if adminVerified is true
if (adminVerified) {
    // ... existing dashboard logic (loadStats, loadUserSessions, event listeners, etc.) ...
}

async function fetchData(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Error fetching ${url}:`, error);
        // Return an object with an error property to be handled by the caller
        return { error: error.message, data: null }; 
    }
}

async function loadStats() {
    // Fetch DAU
    const dauData = await fetchData('/api/admin/stats/dau');
    const dauCountEl = document.getElementById('dau-count');
    if (dauCountEl) {
        dauCountEl.textContent = dauData.error ? `Error: ${dauData.error}` : dauData.dau;
    }

    // Fetch Recent Gens
    const gensData = await fetchData('/api/admin/stats/recent-gens');
    const gensCountEl = document.getElementById('gens-count');
    const gensRecordsEl = document.getElementById('gens-records');
    if (gensData.error) {
        if (gensCountEl) gensCountEl.textContent = `Error: ${gensData.error}`;
        if (gensRecordsEl) gensRecordsEl.textContent = 'Failed to load records.';
    } else {
        if (gensCountEl) gensCountEl.textContent = gensData.countLast24h;
        if (gensRecordsEl) gensRecordsEl.textContent = JSON.stringify(gensData.recentRecords, null, 2);
    }

    // Fetch Recent History
    const historyData = await fetchData('/api/admin/stats/recent-history');
    const historyCountEl = document.getElementById('history-count');
    const historyRecordsEl = document.getElementById('history-records');
    if (historyData.error) {
        if (historyCountEl) historyCountEl.textContent = `Error: ${historyData.error}`;
        if (historyRecordsEl) historyRecordsEl.textContent = 'Failed to load records.';
    } else {
        if (historyCountEl) historyCountEl.textContent = historyData.countLast24h;
        if (historyRecordsEl) historyRecordsEl.textContent = JSON.stringify(historyData.recentRecords, null, 2);
    }

    // Fetch and display Generation Duration Stats
    const gensDurationData = await fetchData('/api/admin/stats/gens-duration');
    const totalGensCountEl = document.getElementById('total-gens-count');
    const totalGensDurationEl = document.getElementById('total-gens-duration');
    const avgGensDurationEl = document.getElementById('avg-gens-duration');
    const gensDurationByUserEl = document.getElementById('gens-duration-by-user');

    if (gensDurationData.error) {
        if (totalGensCountEl) totalGensCountEl.textContent = `Error: ${gensDurationData.error}`;
        if (totalGensDurationEl) totalGensDurationEl.textContent = 'N/A';
        if (avgGensDurationEl) avgGensDurationEl.textContent = 'N/A';
        if (gensDurationByUserEl) gensDurationByUserEl.textContent = 'Failed to load duration stats.';
    } else {
        if (totalGensCountEl) totalGensCountEl.textContent = gensDurationData.totalGenerations;
        if (totalGensDurationEl) totalGensDurationEl.textContent = (gensDurationData.totalDurationMs / 1000).toFixed(2);
        if (avgGensDurationEl) avgGensDurationEl.textContent = (gensDurationData.averageDurationMs / 1000).toFixed(2);
        if (gensDurationByUserEl) {
            // Display top 5 users by duration, or all if fewer than 5
            const topUsers = gensDurationData.durationPerUser.slice(0, 5);
            const userStatsText = topUsers.map(user => 
                `User: ${user.username || user.userId}\n  Total Duration: ${(user.totalUserDurationMs / 1000).toFixed(2)}s\n  Generations: ${user.userGenerationCount}`
            ).join('\n\n');
            gensDurationByUserEl.textContent = topUsers.length > 0 ? userStatsText : 'No user duration data available.';
        }
    }
}

// Ensure the DOM is loaded before trying to access elements
if (document.readyState === 'loading') { // Loading hasn't finished yet
    document.addEventListener('DOMContentLoaded', loadStats);
} else { // DOMContentLoaded has already fired
    loadStats();
}

// Add event listeners for collapsible sections after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const headers = document.querySelectorAll('.metric-header');
    headers.forEach(header => {
        header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            if (content && content.classList.contains('metric-content')) {
                content.classList.toggle('open');
            }
        });

        // Optionally, open the first section by default or based on a hash in URL
        // For now, let's open the DAU section by default if it exists
        if (header.parentElement && header.parentElement.id === 'dau-stats') {
            const content = header.nextElementSibling;
            if (content && content.classList.contains('metric-content')) {
                 content.classList.add('open');
            }
        }
    });
});

async function loadUserSessions(days = 3, userId = null, timeoutMinutes = 30) {
    const sessionsSummaryEl = document.getElementById('user-sessions-summary');
    if (!sessionsSummaryEl) return;
    sessionsSummaryEl.innerHTML = 'Loading session data...';

    let apiUrl = `/api/admin/stats/user-sessions?days=${days}&timeoutMinutes=${timeoutMinutes}`;
    if (userId) {
        apiUrl += `&userId=${userId}`;
    }

    const sessionData = await fetchData(apiUrl);

    if (sessionData.error) {
        sessionsSummaryEl.innerHTML = `<p>Error loading session data: ${sessionData.error}</p>`;
        return;
    }

    if (!sessionData.sessions || sessionData.sessions.length === 0) {
        sessionsSummaryEl.innerHTML = '<p>No session data found for the selected criteria.</p>';
        return;
    }

    sessionsSummaryEl.innerHTML = ''; // Clear loading message

    // Group sessions by user for display
    const sessionsByUser = sessionData.sessions.reduce((acc, session) => {
        acc[session.userId] = acc[session.userId] || {
            username: session.username,
            sessions: []
        };
        acc[session.userId].sessions.push(session);
        return acc;
    }, {});

    for (const id in sessionsByUser) {
        const user = sessionsByUser[id];
        const userHeader = document.createElement('h4');
        userHeader.textContent = `User: ${user.username || id} (${user.sessions.length} sessions)`;
        sessionsSummaryEl.appendChild(userHeader);

        user.sessions.forEach(session => {
            const sessionDiv = document.createElement('div');
            sessionDiv.classList.add('session-summary');
            const durationSeconds = session.duration ? (session.duration / 1000).toFixed(2) : 'N/A';
            sessionDiv.innerHTML = `
                <strong>Session ID:</strong> ${session.sessionId}<br>
                <strong>Start:</strong> ${new Date(session.startTime).toLocaleString()} (Reason: ${session.startReason})<br>
                <strong>End:</strong> ${session.endTime ? new Date(session.endTime).toLocaleString() : 'Still Active'} (Reason: ${session.endReason || 'N/A'})<br>
                <strong>Duration:</strong> ${durationSeconds}s<br>
                <strong>Events:</strong> ${session.events.length}
            `;
            
            const eventsDiv = document.createElement('div');
            eventsDiv.classList.add('session-events');
            const pre = document.createElement('pre');
            pre.textContent = JSON.stringify(session.events.map(e => ({ type: e.type, timestamp: e.timestamp, data: e.data })), null, 2);
            eventsDiv.appendChild(pre);

            sessionDiv.addEventListener('click', () => {
                eventsDiv.classList.toggle('open');
            });

            sessionsSummaryEl.appendChild(sessionDiv);
            sessionsSummaryEl.appendChild(eventsDiv);
        });
    }
}

// Modify the DOMContentLoaded listener to also setup session controls
document.addEventListener('DOMContentLoaded', () => {
    // Existing collapsible setup
    const headers = document.querySelectorAll('.metric-header');
    headers.forEach(header => {
        header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            if (content && content.classList.contains('metric-content')) {
                content.classList.toggle('open');
            }
        });
        // Default open for DAU section
        if (header.parentElement && header.parentElement.id === 'dau-stats' && header.nextElementSibling) {
            header.nextElementSibling.classList.add('open');
        }
        // Default open for User Sessions section
        if (header.parentElement && header.parentElement.id === 'user-sessions-stats' && header.nextElementSibling) {
            header.nextElementSibling.classList.add('open');
        }
    });

    // Setup for user sessions controls
    const fetchSessionsBtn = document.getElementById('fetch-sessions-btn');
    if (fetchSessionsBtn) {
        fetchSessionsBtn.addEventListener('click', () => {
            const days = document.getElementById('session-days').value;
            const userId = document.getElementById('session-user-id').value;
            const timeout = document.getElementById('session-timeout').value;
            loadUserSessions(days, userId || null, timeout);
        });
    }
    // Initial load for user sessions
    loadUserSessions(); 
}); 