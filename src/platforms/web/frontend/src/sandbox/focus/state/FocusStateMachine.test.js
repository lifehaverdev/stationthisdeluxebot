import { describe, it, expect, beforeEach } from 'vitest';
import { FocusStateMachine } from './FocusStateMachine.js';

describe('FocusStateMachine', () => {
  let sm;

  beforeEach(() => {
    sm = new FocusStateMachine();
  });

  describe('initial state', () => {
    it('starts in CANVAS_Z2', () => {
      expect(sm.state).toBe('CANVAS_Z2');
    });

    it('has no focused node', () => {
      expect(sm.focusedNodeId).toBe(null);
    });
  });

  describe('CANVAS_Z2 transitions', () => {
    it('tap node → CANVAS_Z1 with that node focused', () => {
      sm.tapNode('n1');
      expect(sm.state).toBe('CANVAS_Z1');
      expect(sm.focusedNodeId).toBe('n1');
    });

    it('double-tap node → NODE_MODE (power shortcut)', () => {
      sm.doubleTapNode('n1');
      expect(sm.state).toBe('NODE_MODE');
      expect(sm.focusedNodeId).toBe('n1');
    });
  });

  describe('CANVAS_Z1 transitions', () => {
    beforeEach(() => {
      sm.tapNode('n1'); // go to Z1
    });

    it('tap focused node → NODE_MODE', () => {
      sm.tapNode('n1');
      expect(sm.state).toBe('NODE_MODE');
      expect(sm.focusedNodeId).toBe('n1');
    });

    it('tap different node → stay Z1, change focus', () => {
      sm.tapNode('n2');
      expect(sm.state).toBe('CANVAS_Z1');
      expect(sm.focusedNodeId).toBe('n2');
    });

    it('tap empty / zoomOut → CANVAS_Z2', () => {
      sm.zoomOut();
      expect(sm.state).toBe('CANVAS_Z2');
      expect(sm.focusedNodeId).toBe(null);
    });
  });

  describe('NODE_MODE transitions', () => {
    beforeEach(() => {
      sm.doubleTapNode('n1'); // go to NODE_MODE
    });

    it('zoomOut → CANVAS_Z1', () => {
      sm.zoomOut();
      expect(sm.state).toBe('CANVAS_Z1');
      expect(sm.focusedNodeId).toBe('n1');
    });

    it('navigateToNode → NODE_MODE on different node', () => {
      sm.navigateToNode('n2');
      expect(sm.state).toBe('NODE_MODE');
      expect(sm.focusedNodeId).toBe('n2');
    });
  });

  describe('history', () => {
    it('tracks previous state for back navigation', () => {
      sm.tapNode('n1'); // Z2 → Z1
      sm.tapNode('n1'); // Z1 → NODE_MODE
      expect(sm.previousState).toBe('CANVAS_Z1');
    });
  });

  describe('transition callbacks', () => {
    it('fires onChange when state changes', () => {
      const changes = [];
      sm.onChange((from, to, nodeId) => changes.push({ from, to, nodeId }));
      sm.tapNode('n1');
      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({ from: 'CANVAS_Z2', to: 'CANVAS_Z1', nodeId: 'n1' });
    });
  });
});
