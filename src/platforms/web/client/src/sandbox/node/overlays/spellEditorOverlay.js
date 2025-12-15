// Spell editor overlay – loads a spell's nodes into the main sandbox canvas for editing
import { getAvailableTools, getConnections, getToolWindows } from '../../state.js';
import { hydrateSnapshot } from '../../workspaces.js';

const OVERLAY_ID = 'spell-editor-overlay';
let activeSession = null;

export async function openSpellEditorOverlay(spell) {
    if (!spell) {
        throw new Error('Spell data is required to open the editor.');
    }
    if (activeSession) {
        console.warn('[SpellEditorOverlay] Editor already active – ignoring request.');
        return null;
    }

    const session = new SpellEditorOverlay(spell);
    activeSession = session;

    try {
        const result = await session.start();
        activeSession = null;
        return result;
    } catch (err) {
        activeSession = null;
        throw err;
    }
}

class SpellEditorOverlay {
    constructor(spell) {
        this.spell = spell;
        this.previousSnapshot = null;
        this.overlayEl = null;
        this.resolve = null;
        this.reject = null;
        this.keyHandler = this.handleKeydown.bind(this);
    }

    async start() {
        this.previousSnapshot = captureWorkspaceSnapshot();

        try {
            const spellSnapshot = this.buildSpellSnapshot();
            await hydrateSnapshot(spellSnapshot);
        } catch (err) {
            await this.restorePreviousWorkspace();
            throw err;
        }

        this.renderOverlay();

        return new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }

    buildSpellSnapshot() {
        const steps = Array.isArray(this.spell.steps) ? this.spell.steps : [];
        if (steps.length === 0) {
            throw new Error('This spell does not have any steps to edit yet.');
        }

        const toolMap = new Map((getAvailableTools() || []).map(tool => [tool.toolId, tool]));
        const spacing = 320;
        const baseX = 180;
        const baseY = 150;

        const toolWindows = steps.map((step, idx) => {
            const toolId = step.toolIdentifier || step.toolId;
            const tool = toolMap.get(toolId);
            if (!tool) {
                throw new Error(`Missing tool definition for "${toolId}". Make sure the tool is available in this sandbox.`);
            }
            const id = step.id || step.stepId || `spell-step-${idx}`;
            return {
                id,
                workspaceX: baseX + idx * spacing,
                workspaceY: baseY,
                parameterMappings: clone(step.parameterMappings || {}),
                output: null,
                outputVersions: [],
                currentVersionIndex: -1,
                displayName: tool.displayName || step.displayName || toolId,
                toolId: tool.toolId
            };
        });

        const connections = (this.spell.connections || []).map((conn, idx) => ({
            id: conn.id || `spell-conn-${idx}`,
            fromWindowId: conn.fromWindowId,
            fromOutput: conn.fromOutput || conn.type || 'text',
            toWindowId: conn.toWindowId,
            toInput: conn.toInput,
            type: conn.type || conn.fromOutput || 'text'
        }));

        return { toolWindows, connections };
    }

    renderOverlay() {
        if (document.getElementById(OVERLAY_ID)) {
            document.getElementById(OVERLAY_ID).remove();
        }
        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.className = 'spell-editor-overlay';
        overlay.innerHTML = `
            <div class="spell-editor-panel">
                <div class="spell-editor-header">
                    <div>
                        <div class="spell-editor-title">Spell Flow Editor</div>
                        <div class="spell-editor-subtitle">Use the sandbox canvas to tweak nodes and connections. Execution order follows left → right.</div>
                    </div>
                    <button class="spell-editor-close" title="Exit editor">×</button>
                </div>
                <div class="spell-editor-actions">
                    <button class="spell-editor-save">Done & Return</button>
                    <button class="spell-editor-cancel">Cancel</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        this.overlayEl = overlay;

        overlay.querySelector('.spell-editor-save').onclick = () => this.finish(true);
        overlay.querySelector('.spell-editor-cancel').onclick = () => this.finish(false);
        overlay.querySelector('.spell-editor-close').onclick = () => this.finish(false);

        document.addEventListener('keydown', this.keyHandler, true);
    }

    async finish(shouldSave) {
        try {
            const result = shouldSave ? this.captureCurrentStructure() : null;
            await this.restorePreviousWorkspace();
            this.cleanup();
            this.resolve?.(result);
        } catch (err) {
            await this.restorePreviousWorkspace();
            this.cleanup();
            if (this.reject) {
                this.reject(err);
            } else {
                throw err;
            }
        }
    }

    captureCurrentStructure() {
        const windows = getToolWindows().filter(win => !win.isSpell && win.tool);
        if (windows.length === 0) {
            throw new Error('No tool windows found. Add at least one tool to define this spell.');
        }

        const sortedWindows = windows.slice().sort((a, b) => {
            const ax = a.workspaceX ?? 0;
            const bx = b.workspaceX ?? 0;
            if (ax !== bx) return ax - bx;
            const ay = a.workspaceY ?? 0;
            const by = b.workspaceY ?? 0;
            return ay - by;
        });

        const steps = sortedWindows.map(win => ({
            id: win.id,
            toolIdentifier: win.tool.toolId,
            displayName: win.tool.displayName || win.tool.toolId,
            parameterMappings: clone(win.parameterMappings || {})
        }));

        const connections = getConnections().map(conn => ({
            fromWindowId: conn.fromWindowId,
            fromOutput: conn.fromOutput,
            toWindowId: conn.toWindowId,
            toInput: conn.toInput,
            type: conn.type
        }));

        return { steps, connections };
    }

    async restorePreviousWorkspace() {
        if (!this.previousSnapshot) return;
        await hydrateSnapshot(this.previousSnapshot);
    }

    handleKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            event.preventDefault();
            this.finish(false);
        }
    }

    cleanup() {
        if (this.overlayEl) {
            this.overlayEl.remove();
            this.overlayEl = null;
        }
        document.removeEventListener('keydown', this.keyHandler, true);
    }
}

function captureWorkspaceSnapshot() {
    const toolWindows = getToolWindows().map(win => {
        if (win.isSpell) {
            return {
                id: win.id,
                workspaceX: win.workspaceX,
                workspaceY: win.workspaceY,
                output: win.output || null,
                outputVersions: win.outputVersions || [],
                currentVersionIndex: win.currentVersionIndex ?? -1,
                parameterMappings: clone(win.parameterMappings || {}),
                isSpell: true,
                spell: win.spell
            };
        }
        return {
            id: win.id,
            workspaceX: win.workspaceX,
            workspaceY: win.workspaceY,
            output: win.output || null,
            outputVersions: win.outputVersions || [],
            currentVersionIndex: win.currentVersionIndex ?? -1,
            parameterMappings: clone(win.parameterMappings || {}),
            displayName: win.tool?.displayName || '',
            toolId: win.tool?.toolId || ''
        };
    });

    const connections = getConnections().map(({ element, ...rest }) => ({ ...rest }));
    return { toolWindows, connections };
}

function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}
