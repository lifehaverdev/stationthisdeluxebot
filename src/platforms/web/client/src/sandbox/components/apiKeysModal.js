export default class ApiKeysModal {
    constructor() {
        this.state = {
            loading: true,
            error: null,
            keys: [],
            creating: false,
            newKeyName: '',
            newlyCreatedKey: null,
        };
        this.modalElement = null;
    }

    async getCsrfToken() {
        if (window.__csrfToken) return window.__csrfToken;
        const res = await fetch('/api/v1/csrf-token', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to get CSRF token');
        const data = await res.json();
        if (!data.csrfToken) throw new Error('CSRF token not in response');
        window.__csrfToken = data.csrfToken;
        return window.__csrfToken;
    }

    async fetchKeys() {
        this.setState({ loading: true, error: null });
        try {
            const res = await fetch('/api/v1/user/apikeys', {
                credentials: 'include',
                headers: { 'Accept': 'application/json' },
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({ message: 'Failed to fetch API keys' }));
                throw new Error(errData.error?.message || errData.message);
            }
            const keys = await res.json();
            this.setState({ keys, loading: false });
        } catch (error) {
            this.setState({ error: error.message, loading: false });
        }
    }

    async createKey() {
        const { newKeyName } = this.state;
        if (!newKeyName.trim()) return;

        this.setState({ creating: true, error: null });
        try {
            const csrfToken = await this.getCsrfToken();
            const res = await fetch('/api/v1/user/apikeys', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'x-csrf-token': csrfToken,
                },
                body: JSON.stringify({ name: newKeyName.trim() }),
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({ message: 'Failed to create API key' }));
                throw new Error(errData.error?.message || errData.message);
            }
            const newKey = await res.json();
            this.setState({
                creating: false,
                newKeyName: '',
                newlyCreatedKey: newKey,
            });
            this.fetchKeys();
        } catch (error) {
            this.setState({ error: error.message, creating: false });
        }
    }

    async deleteKey(keyPrefix) {
        if (!confirm('Are you sure you want to delete this API key? This cannot be undone.')) {
            return;
        }

        this.setState({ error: null });
        try {
            const csrfToken = await this.getCsrfToken();
            const res = await fetch(`/api/v1/user/apikeys/${keyPrefix}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: {
                    'x-csrf-token': csrfToken,
                },
            });
            if (!res.ok && res.status !== 204) {
                const errData = await res.json().catch(() => ({ message: 'Failed to delete API key' }));
                throw new Error(errData.error?.message || errData.message);
            }
            this.fetchKeys();
        } catch (error) {
            this.setState({ error: error.message });
        }
    }

    copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            const copyBtn = this.modalElement.querySelector('.copy-new-key-btn');
            if (copyBtn) {
                copyBtn.textContent = 'Copied!';
                setTimeout(() => {
                    copyBtn.textContent = 'Copy';
                }, 1500);
            }
        });
    }

    render() {
        const { loading, error, keys, creating, newKeyName, newlyCreatedKey } = this.state;

        let content = '';

        if (newlyCreatedKey) {
            content = `
                <div class="apikeys-header">
                    <h3>API Key Created</h3>
                </div>
                <div class="apikeys-new-key-display">
                    <p class="warning-text">Copy this key now. You won't be able to see it again!</p>
                    <div class="new-key-box">
                        <code class="new-key-value">${newlyCreatedKey.apiKey}</code>
                        <button class="copy-new-key-btn">Copy</button>
                    </div>
                    <p class="key-name-label">Name: <strong>${newlyCreatedKey.name}</strong></p>
                    <button class="done-btn">Done</button>
                </div>
            `;
        } else if (loading) {
            content = '<div class="loading-spinner"></div>';
        } else {
            content = `
                <div class="apikeys-header">
                    <h3>API Keys</h3>
                </div>
                ${error ? `<div class="error-message">Error: ${error}</div>` : ''}
                <div class="apikeys-create">
                    <input type="text" class="apikey-name-input" placeholder="Key name (e.g., My App)" value="${newKeyName}" ${creating ? 'disabled' : ''} />
                    <button class="create-key-btn" ${creating || !newKeyName.trim() ? 'disabled' : ''}>${creating ? 'Creating...' : 'Create Key'}</button>
                </div>
                <div class="apikeys-list">
                    ${keys.length === 0 ? '<p class="no-keys-msg">No API keys yet. Create one above.</p>' : ''}
                    ${keys.map(key => `
                        <div class="apikey-item">
                            <div class="apikey-info">
                                <span class="apikey-name">${key.name}</span>
                                <span class="apikey-prefix">${key.keyPrefix}...</span>
                                <span class="apikey-meta">Created: ${key.createdAt ? new Date(key.createdAt).toLocaleDateString() : 'N/A'}</span>
                            </div>
                            <button class="delete-key-btn" data-prefix="${key.keyPrefix}">Delete</button>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        this.modalElement.querySelector('.apikeys-modal-content').innerHTML = content;
        this.attachContentEvents();
    }

    attachContentEvents() {
        const input = this.modalElement.querySelector('.apikey-name-input');
        if (input) {
            input.addEventListener('input', (e) => {
                this.state.newKeyName = e.target.value;
                const createBtn = this.modalElement.querySelector('.create-key-btn');
                if (createBtn) {
                    createBtn.disabled = !e.target.value.trim();
                }
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && this.state.newKeyName.trim()) {
                    this.createKey();
                }
            });
        }

        const createBtn = this.modalElement.querySelector('.create-key-btn');
        if (createBtn) {
            createBtn.addEventListener('click', () => this.createKey());
        }

        const deleteBtns = this.modalElement.querySelectorAll('.delete-key-btn');
        deleteBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const prefix = btn.getAttribute('data-prefix');
                this.deleteKey(prefix);
            });
        });

        const copyBtn = this.modalElement.querySelector('.copy-new-key-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                this.copyToClipboard(this.state.newlyCreatedKey.apiKey);
            });
        }

        const doneBtn = this.modalElement.querySelector('.done-btn');
        if (doneBtn) {
            doneBtn.addEventListener('click', () => {
                this.setState({ newlyCreatedKey: null });
            });
        }
    }

    setState(newState) {
        Object.assign(this.state, newState);
        if (this.modalElement) {
            this.render();
        }
    }

    show() {
        if (this.modalElement) return;

        this.modalElement = document.createElement('div');
        this.modalElement.className = 'apikeys-modal-overlay';
        this.modalElement.innerHTML = `
            <div class="apikeys-modal-container">
                <button class="close-btn">&times;</button>
                <div class="apikeys-modal-content"></div>
            </div>
        `;
        document.body.appendChild(this.modalElement);

        this.attachCloseEvents();
        this.fetchKeys();
    }

    hide() {
        if (!this.modalElement) return;
        document.body.removeChild(this.modalElement);
        this.modalElement = null;
    }

    attachCloseEvents() {
        this.modalElement.querySelector('.close-btn').addEventListener('click', () => this.hide());
        this.modalElement.addEventListener('click', (e) => {
            if (e.target === this.modalElement) {
                this.hide();
            }
        });
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                this.hide();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }
}
