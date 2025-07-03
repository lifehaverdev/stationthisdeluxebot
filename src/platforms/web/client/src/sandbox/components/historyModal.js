export default class HistoryModal {
    constructor() {
        this.state = {
            loading: true,
            error: null,
            data: null,
            timeUnit: 'month',
            offset: 0,
        };
        this.modalElement = null;
    }

    async fetchHistory() {
        this.setState({ loading: true, error: null });
        try {
            const { timeUnit, offset } = this.state;
            const res = await fetch(`/api/v1/user/history?timeUnit=${timeUnit}&offset=${offset}`, {
                credentials: 'include',
                headers: { 'Accept': 'application/json' },
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({ message: 'Failed to fetch history data' }));
                throw new Error(errData.error?.message || errData.message);
            }
            const data = await res.json();
            this.setState({ data, loading: false });
        } catch (error) {
            this.setState({ error: error.message, loading: false });
        }
    }

    render() {
        const { loading, error, data } = this.state;

        let content = '';
        if (loading) {
            content = '<div class="loading-spinner"></div>';
        } else if (error) {
            content = `<div class="error-message">Error: ${error}</div>`;
        } else if (data) {
            const startDate = new Date(data.startDate).toLocaleDateString();
            const endDate = new Date(data.endDate).toLocaleDateString();
            const { timeUnit } = this.state;

            content = `
                <div class="history-header">
                    <h3>Usage History</h3>
                    <div class="history-nav">
                        <button class="nav-btn" data-action="prev">←</button>
                        <button class="nav-btn" data-action="zoom-out" title="Zoom Out" ${timeUnit === 'month' ? 'disabled' : ''}>-</button>
                        <span class="date-range">${startDate} - ${endDate}</span>
                        <button class="nav-btn" data-action="zoom-in" title="Zoom In" ${timeUnit === 'day' ? 'disabled' : ''}>+</button>
                        <button class="nav-btn" data-action="next" ${this.state.offset === 0 ? 'disabled' : ''}>→</button>
                    </div>
                </div>
                <div class="history-summary">
                    <p><strong>Total Spent:</strong> ${data.totalSpent.toFixed(4)} points</p>
                    <p><strong>Most Used:</strong> ${data.mostUsedTool}</p>
                </div>
                <div class="history-details">
                    <h4>Tool Breakdown</h4>
                    <ul>
                        ${data.toolBreakdown.map(tool => `
                            <li>
                                <strong>${tool.tool}</strong>
                                <span>Uses: ${tool.count} | Spent: ${tool.spent.toFixed(4)}</span>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            `;
        }

        this.modalElement.querySelector('.history-modal-content').innerHTML = content;
        this.attachNavEvents();
    }

    attachNavEvents() {
        this.modalElement.querySelector('[data-action="prev"]')?.addEventListener('click', () => {
            this.setState({ offset: this.state.offset + 1 });
            this.fetchHistory();
        });

        this.modalElement.querySelector('[data-action="next"]')?.addEventListener('click', () => {
            if (this.state.offset > 0) {
                this.setState({ offset: this.state.offset - 1 });
                this.fetchHistory();
            }
        });

        this.modalElement.querySelector('[data-action="zoom-in"]')?.addEventListener('click', () => {
            const { timeUnit, data } = this.state;
            if (timeUnit === 'day' || !data) return;

            const now = new Date();
            const endDate = new Date(data.endDate);
            const oneDayMs = 1000 * 60 * 60 * 24;
            
            const utcNow = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
            const utcEnd = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
            const dayDifference = Math.floor((utcNow - utcEnd) / oneDayMs);

            let newUnit, newOffset;
            if (timeUnit === 'month') {
                newUnit = 'week';
                newOffset = Math.floor(dayDifference / 7);
            } else if (timeUnit === 'week') {
                newUnit = 'day';
                newOffset = dayDifference;
            }
            
            if (newUnit !== undefined) {
                this.setState({ timeUnit: newUnit, offset: newOffset });
                this.fetchHistory();
            }
        });

        this.modalElement.querySelector('[data-action="zoom-out"]')?.addEventListener('click', () => {
            const { timeUnit, data } = this.state;
            if (timeUnit === 'month' || !data) return;

            const now = new Date();
            const endDate = new Date(data.endDate);
            const oneDayMs = 1000 * 60 * 60 * 24;

            const utcNow = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
            const utcEnd = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
            const dayDifference = Math.floor((utcNow - utcEnd) / oneDayMs);
            
            let newUnit, newOffset;
            if (timeUnit === 'day') {
                newUnit = 'week';
                newOffset = Math.floor(dayDifference / 7);
            } else if (timeUnit === 'week') {
                newUnit = 'month';
                newOffset = (now.getFullYear() - endDate.getFullYear()) * 12 + (now.getMonth() - endDate.getMonth());
            }

            if (newUnit !== undefined) {
                this.setState({ timeUnit: newUnit, offset: newOffset });
                this.fetchHistory();
            }
        });
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
        this.modalElement.className = 'history-modal-overlay';
        this.modalElement.innerHTML = `
            <div class="history-modal-container">
                <button class="close-btn">&times;</button>
                <div class="history-modal-content"></div>
            </div>
        `;
        document.body.appendChild(this.modalElement);

        this.attachCloseEvents();
        this.fetchHistory();
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
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hide();
            }
        }, { once: true });
    }
} 