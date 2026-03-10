export const STATES = {
  CANVAS_Z2: 'CANVAS_Z2',
  CANVAS_Z1: 'CANVAS_Z1',
  NODE_MODE: 'NODE_MODE',
  CONNECTION_MODE: 'CONNECTION_MODE',
  MULTI_SELECT: 'MULTI_SELECT',
};

export class FocusStateMachine {
  constructor() {
    this.state = STATES.CANVAS_Z2;
    this.focusedNodeId = null;
    this.sourceNodeId = null;
    this.selectedNodeIds = new Set();
    this._preMultiSelectState = null;
    this.previousState = null;
    this._listeners = [];
  }

  onChange(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(l => l !== fn); };
  }

  _transition(newState, nodeId) {
    const from = this.state;
    this.previousState = from;
    this.state = newState;
    if (nodeId !== undefined) this.focusedNodeId = nodeId;
    for (const fn of this._listeners) fn(from, newState, this.focusedNodeId);
  }

  tapNode(nodeId) {
    switch (this.state) {
      case STATES.CANVAS_Z2:
        this._transition(STATES.CANVAS_Z1, nodeId);
        break;
      case STATES.CANVAS_Z1:
        if (nodeId === this.focusedNodeId) {
          this._transition(STATES.NODE_MODE, nodeId);
        } else {
          this._transition(STATES.CANVAS_Z1, nodeId);
        }
        break;
    }
  }

  doubleTapNode(nodeId) {
    if (this.state === STATES.CANVAS_Z2 || this.state === STATES.CANVAS_Z1) {
      this._transition(STATES.NODE_MODE, nodeId);
    }
  }

  zoomIn() {
    if (this.state === STATES.CANVAS_Z2) {
      this._transition(STATES.CANVAS_Z1, null);
    }
  }

  zoomOut() {
    switch (this.state) {
      case STATES.CANVAS_Z1:
        this._transition(STATES.CANVAS_Z2, null);
        break;
      case STATES.NODE_MODE:
        this._transition(STATES.CANVAS_Z1);
        break;
      case STATES.CONNECTION_MODE:
        this.sourceNodeId = null;
        this._transition(STATES.NODE_MODE);
        break;
      case STATES.MULTI_SELECT: {
        this.selectedNodeIds = new Set();
        const returnTo = this._preMultiSelectState || STATES.CANVAS_Z2;
        this._preMultiSelectState = null;
        this._transition(returnTo);
        break;
      }
    }
  }

  enterConnectionMode(sourceNodeId) {
    if (this.state !== STATES.NODE_MODE) return;
    this.sourceNodeId = sourceNodeId;
    this._transition(STATES.CONNECTION_MODE, sourceNodeId);
  }

  completeConnection() {
    if (this.state !== STATES.CONNECTION_MODE) return;
    const src = this.sourceNodeId;
    this.sourceNodeId = null;
    this._transition(STATES.NODE_MODE, src);
  }

  cancelConnection() {
    if (this.state !== STATES.CONNECTION_MODE) return;
    const src = this.sourceNodeId;
    this.sourceNodeId = null;
    this._transition(STATES.NODE_MODE, src);
  }

  enterMultiSelect(nodeId) {
    if (this.state !== STATES.CANVAS_Z1 && this.state !== STATES.CANVAS_Z2) return;
    this._preMultiSelectState = this.state;
    this.selectedNodeIds = new Set([nodeId]);
    this._transition(STATES.MULTI_SELECT);
  }

  toggleSelection(nodeId) {
    if (this.state !== STATES.MULTI_SELECT) return;
    if (this.selectedNodeIds.has(nodeId)) {
      this.selectedNodeIds.delete(nodeId);
    } else {
      this.selectedNodeIds.add(nodeId);
    }
  }

  exitMultiSelect() {
    if (this.state !== STATES.MULTI_SELECT) return;
    this.selectedNodeIds = new Set();
    const returnTo = this._preMultiSelectState || STATES.CANVAS_Z2;
    this._preMultiSelectState = null;
    this._transition(returnTo);
  }

  navigateToNode(nodeId) {
    if (this.state === STATES.NODE_MODE) {
      this._transition(STATES.NODE_MODE, nodeId);
    }
  }
}
