export const STATES = {
  CANVAS_Z2: 'CANVAS_Z2',
  CANVAS_Z1: 'CANVAS_Z1',
  NODE_MODE: 'NODE_MODE',
  CONNECTION_MODE: 'CONNECTION_MODE',
};

export class FocusStateMachine {
  constructor() {
    this.state = STATES.CANVAS_Z2;
    this.focusedNodeId = null;
    this.sourceNodeId = null;
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

  navigateToNode(nodeId) {
    if (this.state === STATES.NODE_MODE) {
      this._transition(STATES.NODE_MODE, nodeId);
    }
  }
}
