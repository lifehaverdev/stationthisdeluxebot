import { Component } from '../../../../../web/dom/Component.js';
import { appStore, storeActions } from '../../stores/AppStore.js';

export class CollectionSharingComponent extends Component {
    constructor(element) {
        super(element);
        
        this.state = {
            collection: null,
            sharedUsers: [],
            shareLink: null,
            isLoading: false,
            error: null,
            success: null,
            permissions: [
                { value: 'read', label: 'Read', description: 'Can view but not modify collection' },
                { value: 'edit', label: 'Edit', description: 'Can view and modify collection items' },
                { value: 'admin', label: 'Admin', description: 'Full control including sharing' }
            ],
            selectedPermission: 'read', // Default permission
            expiryDays: 7, // Default expiry time in days
            expiryDaysOptions: [1, 3, 7, 14, 30, 90], // Available expiry options in days
            shareExpiry: null // Current expiry date for existing share link
        };
    }
    
    onMount() {
        // Subscribe to store updates for current collection
        this.storeUnsubscribe = appStore.subscribe((state) => {
            if (state.currentCollection) {
                this.setState({ 
                    collection: state.currentCollection,
                    isLoading: state.isLoading,
                    error: state.error
                });
                
                // Load sharing info when collection changes
                this.loadSharingInfo(state.currentCollection.id);
            }
        });
    }
    
    onUnmount() {
        // Unsubscribe from store
        if (this.storeUnsubscribe) {
            this.storeUnsubscribe();
        }
    }
    
    async loadSharingInfo(collectionId) {
        if (!collectionId) return;
        
        this.setState({ isLoading: true });
        
        try {
            // Get users the collection is shared with
            const usersResponse = await fetch(`/api/share/collection/${collectionId}/users`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            if (!usersResponse.ok) {
                throw new Error('Failed to load shared users');
            }
            
            const usersData = await usersResponse.json();
            this.setState({ sharedUsers: usersData });
            
            // Check if collection has an active share link
            const linkResponse = await fetch(`/api/share/collection/${collectionId}/link/status`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            if (linkResponse.ok) {
                const linkData = await linkResponse.json();
                this.setState({ 
                    shareLink: linkData.link || null,
                    shareExpiry: linkData.expiry || null // Store the expiry date from the API
                });
            }
        } catch (error) {
            console.error('Error loading sharing info:', error);
            this.setState({ error: error.message });
        } finally {
            this.setState({ isLoading: false });
        }
    }
    
    async shareWithUser(event) {
        event.preventDefault();
        const form = event.target;
        const usernameOrEmail = form.elements.userIdentifier.value.trim();
        const permission = form.elements.permission.value;
        
        if (!usernameOrEmail) return;
        
        this.setState({ isLoading: true, error: null, success: null });
        
        try {
            const response = await fetch(`/api/share/collection/${this.state.collection.id}/user`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ 
                    userIdentifier: usernameOrEmail,
                    permissions: permission // Use selected permission
                })
            });
            
            if (!response.ok) {
                throw new Error('Failed to share collection');
            }
            
            // Show success message
            this.setState({ success: `Collection shared with ${usernameOrEmail} successfully` });
            
            // Reload sharing info
            await this.loadSharingInfo(this.state.collection.id);
            
            // Reset the form
            form.reset();
            // Reset permission to default
            this.setState({ selectedPermission: 'read' });
            
            // Auto-hide success message after 3 seconds
            setTimeout(() => {
                this.setState({ success: null });
            }, 3000);
        } catch (error) {
            console.error('Error sharing collection:', error);
            this.setState({ error: error.message });
        } finally {
            this.setState({ isLoading: false });
        }
    }
    
    async removeSharing(userId) {
        if (!confirm('Are you sure you want to remove this user from the shared collection?')) return;
        
        this.setState({ isLoading: true, error: null, success: null });
        
        try {
            const response = await fetch(`/api/share/collection/${this.state.collection.id}/user/${userId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to remove sharing');
            }
            
            // Show success message
            this.setState({ success: 'Access removed successfully' });
            
            // Reload sharing info
            await this.loadSharingInfo(this.state.collection.id);
            
            // Auto-hide success message after 3 seconds
            setTimeout(() => {
                this.setState({ success: null });
            }, 3000);
        } catch (error) {
            console.error('Error removing sharing:', error);
            this.setState({ error: error.message });
        } finally {
            this.setState({ isLoading: false });
        }
    }
    
    async createShareLink() {
        this.setState({ isLoading: true, error: null, success: null });
        
        try {
            const response = await fetch(`/api/share/collection/${this.state.collection.id}/link`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ 
                    expiryDays: this.state.expiryDays // Use the selected expiry days
                })
            });
            
            if (!response.ok) {
                throw new Error('Failed to create share link');
            }
            
            const data = await response.json();
            
            // Show success message
            this.setState({ 
                shareLink: data.shareUrl,
                shareExpiry: data.expiry,
                success: 'Share link created successfully'
            });
            
            // Auto-hide success message after 3 seconds
            setTimeout(() => {
                this.setState({ success: null });
            }, 3000);
        } catch (error) {
            console.error('Error creating share link:', error);
            this.setState({ error: error.message });
        } finally {
            this.setState({ isLoading: false });
        }
    }
    
    async deleteShareLink() {
        if (!confirm('Are you sure you want to delete this share link? Anyone using it will lose access.')) return;
        
        this.setState({ isLoading: true });
        
        try {
            const response = await fetch(`/api/share/collection/${this.state.collection.id}/link`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to delete share link');
            }
            
            this.setState({ shareLink: null });
        } catch (error) {
            console.error('Error deleting share link:', error);
            this.setState({ error: error.message });
        } finally {
            this.setState({ isLoading: false });
        }
    }
    
    copyShareLink() {
        if (!this.state.shareLink) return;
        
        navigator.clipboard.writeText(this.state.shareLink).then(() => {
            const copyButton = this.element.querySelector('#copy-link-button');
            const originalText = copyButton.textContent;
            
            copyButton.textContent = 'Copied!';
            setTimeout(() => {
                copyButton.textContent = originalText;
            }, 2000);
        });
    }
    
    updateSelectedPermission(event) {
        this.setState({ selectedPermission: event.target.value });
    }

    async updateUserPermission(userId, newPermission, oldPermission) {
        // Check if we're reducing permissions and require confirmation
        if (this.isReducingPermissions(oldPermission, newPermission)) {
            if (!confirm('This change will reduce the user\'s access level. Are you sure you want to continue?')) {
                // Reset the select element to the previous value if user cancels
                const selectElement = this.element.querySelector(`.permission-change-select[data-user-id="${userId}"]`);
                if (selectElement) {
                    selectElement.value = oldPermission;
                }
                return;
            }
        }
        
        this.setState({ isLoading: true, error: null, success: null });
        
        try {
            const response = await fetch(`/api/share/collection/${this.state.collection.id}/user/${userId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ 
                    permissions: newPermission
                })
            });
            
            if (!response.ok) {
                throw new Error('Failed to update permissions');
            }
            
            // Show success message
            this.setState({ success: 'Permissions updated successfully' });
            
            // Reload sharing info
            await this.loadSharingInfo(this.state.collection.id);
            
            // Auto-hide success message after 3 seconds
            setTimeout(() => {
                this.setState({ success: null });
            }, 3000);
        } catch (error) {
            console.error('Error updating permissions:', error);
            this.setState({ error: error.message });
        } finally {
            this.setState({ isLoading: false });
        }
    }
    
    // Helper method to determine if permissions are being reduced
    isReducingPermissions(oldPermission, newPermission) {
        const permissionLevels = {
            'read': 1,
            'edit': 2,
            'admin': 3
        };
        
        return permissionLevels[newPermission] < permissionLevels[oldPermission];
    }
    
    updateExpiryDays(event) {
        this.setState({ expiryDays: parseInt(event.target.value) || 7 });
    }

    async updateShareLinkExpiry() {
        this.setState({ isLoading: true, error: null, success: null });
        
        try {
            const response = await fetch(`/api/share/collection/${this.state.collection.id}/link/expiry`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ 
                    expiryDays: this.state.expiryDays
                })
            });
            
            if (!response.ok) {
                throw new Error('Failed to update expiry date');
            }
            
            const data = await response.json();
            
            // Show success message
            this.setState({ 
                shareExpiry: data.expiry,
                success: 'Share link expiry updated successfully'
            });
            
            // Auto-hide success message after 3 seconds
            setTimeout(() => {
                this.setState({ success: null });
            }, 3000);
        } catch (error) {
            console.error('Error updating expiry date:', error);
            this.setState({ error: error.message });
        } finally {
            this.setState({ isLoading: false });
        }
    }
    
    render() {
        const { 
            collection, 
            sharedUsers, 
            shareLink, 
            shareExpiry,
            isLoading, 
            error, 
            success, 
            permissions, 
            selectedPermission,
            expiryDays,
            expiryDaysOptions
        } = this.state;
        
        if (!collection) {
            return `<div class="sharing-container">No collection selected</div>`;
        }
        
        // Format expiry date if available
        const formattedExpiry = shareExpiry ? new Date(shareExpiry).toLocaleString() : null;
        
        // Calculate days remaining if expiry exists
        let daysRemaining = null;
        if (shareExpiry) {
            const now = new Date();
            const expiryDate = new Date(shareExpiry);
            const diffTime = expiryDate - now;
            daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }
        
        return `
            <div class="sharing-container">
                <h2>Share "${collection.name}"</h2>
                
                ${error ? `<div class="error-message">${error}</div>` : ''}
                ${success ? `<div class="success-message">${success}</div>` : ''}
                
                <div class="sharing-section">
                    <h3>Share with a user</h3>
                    <form id="share-with-user-form">
                        <div class="form-group">
                            <input type="text" name="userIdentifier" placeholder="Username or email" class="form-control" required>
                            <select name="permission" class="form-control permission-select">
                                ${permissions.map(perm => `
                                    <option value="${perm.value}" ${selectedPermission === perm.value ? 'selected' : ''}>
                                        ${perm.label}
                                    </option>
                                `).join('')}
                            </select>
                            <button type="submit" class="btn btn-primary" ${isLoading ? 'disabled' : ''}>
                                ${isLoading ? 'Sharing...' : 'Share'}
                            </button>
                        </div>
                        <div class="permission-description">
                            ${permissions.find(p => p.value === selectedPermission)?.description || ''}
                        </div>
                    </form>
                </div>
                
                <div class="sharing-section">
                    <h3>Users with access</h3>
                    ${sharedUsers.length === 0 
                        ? '<p>This collection is not shared with any users yet.</p>' 
                        : `
                            <ul class="shared-users-list">
                                ${sharedUsers.map(user => `
                                    <li class="shared-user">
                                        <div class="user-info">
                                            <span class="username">${user.username || user.email}</span>
                                            <div class="permission-controls">
                                                <select class="permission-change-select" data-user-id="${user.id}" data-current-permission="${user.permission}">
                                                    ${permissions.map(perm => `
                                                        <option value="${perm.value}" ${user.permission === perm.value ? 'selected' : ''}>
                                                            ${perm.label}
                                                        </option>
                                                    `).join('')}
                                                </select>
                                            </div>
                                        </div>
                                        <button class="btn btn-danger remove-sharing-button" data-user-id="${user.id}">
                                            Remove
                                        </button>
                                    </li>
                                `).join('')}
                            </ul>
                        `
                    }
                </div>
                
                <div class="sharing-section">
                    <h3>Public share link</h3>
                    ${shareLink 
                        ? `
                            <div class="share-link-container">
                                <input type="text" readonly value="${shareLink}" class="form-control">
                                <button id="copy-link-button" class="btn btn-secondary">Copy</button>
                                <button id="delete-link-button" class="btn btn-danger">Delete Link</button>
                            </div>
                            ${formattedExpiry ? `
                                <div class="expiry-info">
                                    <p>This link expires on: <strong>${formattedExpiry}</strong> 
                                    ${daysRemaining ? `<span class="days-remaining">(${daysRemaining} days remaining)</span>` : ''}
                                    </p>
                                    <div class="update-expiry-container">
                                        <label for="expiry-select">Update expiry:</label>
                                        <select id="expiry-select" class="form-control expiry-select">
                                            ${expiryDaysOptions.map(days => `
                                                <option value="${days}" ${expiryDays === days ? 'selected' : ''}>
                                                    ${days} ${days === 1 ? 'day' : 'days'}
                                                </option>
                                            `).join('')}
                                        </select>
                                        <button id="update-expiry-button" class="btn btn-secondary" ${isLoading ? 'disabled' : ''}>
                                            Update Expiry
                                        </button>
                                    </div>
                                </div>
                            ` : ''}
                        `
                        : `
                            <div class="share-link-empty">
                                <p>No public share link has been created.</p>
                                <div class="create-link-container">
                                    <label for="create-expiry-select">Link expires after:</label>
                                    <select id="create-expiry-select" class="form-control expiry-select">
                                        ${expiryDaysOptions.map(days => `
                                            <option value="${days}" ${expiryDays === days ? 'selected' : ''}>
                                                ${days} ${days === 1 ? 'day' : 'days'}
                                            </option>
                                        `).join('')}
                                    </select>
                                    <button id="create-link-button" class="btn btn-primary" ${isLoading ? 'disabled' : ''}>
                                        Create Share Link
                                    </button>
                                </div>
                            </div>
                        `
                    }
                </div>
            </div>
        `;
    }
    
    events() {
        return {
            'submit #share-with-user-form': this.shareWithUser.bind(this),
            'change .permission-select': this.updateSelectedPermission.bind(this),
            'change .permission-change-select': (e) => {
                const userId = e.target.dataset.userId;
                const oldPermission = e.target.dataset.currentPermission;
                const newPermission = e.target.value;
                if (userId && newPermission) {
                    this.updateUserPermission(userId, newPermission, oldPermission);
                }
            },
            'change #create-expiry-select': this.updateExpiryDays.bind(this),
            'change #expiry-select': this.updateExpiryDays.bind(this),
            'click .remove-sharing-button': (e) => {
                const userId = e.target.dataset.userId;
                if (userId) this.removeSharing(userId);
            },
            'click #create-link-button': this.createShareLink.bind(this),
            'click #update-expiry-button': this.updateShareLinkExpiry.bind(this),
            'click #delete-link-button': this.deleteShareLink.bind(this),
            'click #copy-link-button': this.copyShareLink.bind(this)
        };
    }
    
    static get styles() {
        return `
            .sharing-container {
                max-width: 800px;
                padding: 1.5rem;
                background-color: #1a1a1a;
                border-radius: 8px;
                margin-bottom: 2rem;
            }
            
            .sharing-section {
                margin-bottom: 2rem;
                padding-bottom: 1.5rem;
                border-bottom: 1px solid #333;
            }
            
            .sharing-section:last-child {
                margin-bottom: 0;
                padding-bottom: 0;
                border-bottom: none;
            }
            
            .form-group {
                display: flex;
                gap: 0.5rem;
                margin-bottom: 0.5rem;
            }
            
            .form-group input {
                flex: 2;
            }
            
            .permission-select {
                flex: 1;
                min-width: 120px;
            }
            
            .permission-description {
                font-size: 0.85rem;
                color: #aaa;
                margin-bottom: 1rem;
            }
            
            .shared-users-list {
                list-style: none;
                padding: 0;
                margin: 0;
            }
            
            .shared-user {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 0.75rem;
                background-color: #212121;
                border-radius: 4px;
                margin-bottom: 0.5rem;
            }
            
            .user-info {
                display: flex;
                align-items: center;
                gap: 1rem;
            }
            
            .username {
                font-weight: bold;
            }
            
            .permission-controls {
                display: flex;
                align-items: center;
            }
            
            .permission-change-select {
                background-color: #333;
                color: #fff;
                border: 1px solid #444;
                border-radius: 4px;
                padding: 0.25rem;
            }
            
            .share-link-container {
                display: flex;
                gap: 0.5rem;
                margin-bottom: 1rem;
            }
            
            .share-link-container input {
                flex: 1;
            }
            
            .expiry-info {
                background-color: #212121;
                padding: 0.75rem;
                border-radius: 4px;
                margin-top: 0.5rem;
            }
            
            .days-remaining {
                color: ${daysRemaining && daysRemaining <= 3 ? '#f0ad4e' : '#aaa'};
                font-size: 0.9rem;
            }
            
            .update-expiry-container {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                margin-top: 0.5rem;
            }
            
            .create-link-container {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                margin-top: 0.5rem;
            }
            
            .expiry-select {
                min-width: 100px;
                background-color: #333;
                color: #fff;
                border: 1px solid #444;
                border-radius: 4px;
                padding: 0.25rem;
            }
            
            .error-message {
                background-color: #5a1c1c;
                color: #f8d7da;
                padding: 0.75rem;
                border-radius: 4px;
                margin-bottom: 1rem;
            }
            
            .success-message {
                background-color: #1c5a2e;
                color: #d7f8e1;
                padding: 0.75rem;
                border-radius: 4px;
                margin-bottom: 1rem;
                animation: fadeIn 0.3s ease-in-out;
            }
            
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
        `;
    }
} 