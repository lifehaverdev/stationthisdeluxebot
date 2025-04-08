/**
 * StateContainer Tests
 * Test suite for the immutable state container
 */

const { StateContainer, createStateContainer } = require('../../../src/core/shared/state');

describe('StateContainer', () => {
  // Basic functionality tests
  describe('Basic State Operations', () => {
    let container;
    
    beforeEach(() => {
      container = new StateContainer({
        initialState: {
          count: 0,
          name: 'test',
          settings: {
            theme: 'light',
            notifications: true
          }
        }
      });
    });
    
    test('should initialize with the provided state', () => {
      expect(container.getState()).toEqual({
        count: 0,
        name: 'test',
        settings: {
          theme: 'light',
          notifications: true
        }
      });
    });
    
    test('should return immutable state', () => {
      const state = container.getState();
      expect(Object.isFrozen(state)).toBe(true);
      
      // Attempt to modify state should throw in strict mode or silently fail
      expect(() => {
        state.count = 5;
      }).not.toThrow();
      
      // State should remain unchanged
      expect(state.count).toBe(0);
    });
    
    test('should update state with setState', () => {
      container.setState({ count: 5 });
      expect(container.getState().count).toBe(5);
      expect(container.getState().name).toBe('test'); // Other properties preserved
    });
    
    test('should handle functional updaters', () => {
      container.setState(state => ({ count: state.count + 1 }));
      expect(container.getState().count).toBe(1);
      
      container.setState(state => ({ count: state.count + 1 }));
      expect(container.getState().count).toBe(2);
    });
    
    test('should get properties with get method', () => {
      expect(container.get('count')).toBe(0);
      expect(container.get('name')).toBe('test');
      expect(container.get('nonexistent', 'default')).toBe('default');
    });
    
    test('should set properties with set method', () => {
      container.set('count', 10);
      expect(container.get('count')).toBe(10);
      
      container.set('newProp', 'new value');
      expect(container.get('newProp')).toBe('new value');
    });
    
    test('should set multiple properties with setMultiple', () => {
      container.setMultiple({
        count: 20,
        name: 'updated',
        newProp: true
      });
      
      expect(container.get('count')).toBe(20);
      expect(container.get('name')).toBe('updated');
      expect(container.get('newProp')).toBe(true);
    });
    
    test('should remove properties with remove', () => {
      container.remove('name');
      expect(container.get('name')).toBeNull();
      expect('name' in container.getState()).toBe(false);
      
      // Other properties should remain
      expect(container.get('count')).toBe(0);
    });
    
    test('should reset state', () => {
      container.setState({ count: 10, extra: true });
      container.resetState({ fresh: true });
      
      expect(container.getState()).toEqual({ fresh: true });
    });
  });
  
  // Version tracking tests
  describe('Version Tracking', () => {
    let container;
    
    beforeEach(() => {
      container = new StateContainer({ initialState: { count: 0 } });
    });
    
    test('should start at version 1', () => {
      expect(container.getVersion()).toBe(1);
    });
    
    test('should increment version on setState', () => {
      container.setState({ count: 1 });
      expect(container.getVersion()).toBe(2);
      
      container.setState({ count: 2 });
      expect(container.getVersion()).toBe(3);
    });
    
    test('should not increment version if state does not change', () => {
      container.setState({ count: 0 }); // Same value
      expect(container.getVersion()).toBe(1); // Version should not change
      
      container.setState({}); // Empty update
      expect(container.getVersion()).toBe(1);
    });
    
    test('should increment version on resetState', () => {
      container.resetState({ count: 0 });
      expect(container.getVersion()).toBe(2);
    });
  });
  
  // History tracking tests
  describe('History Tracking', () => {
    test('should not store history by default', () => {
      const container = new StateContainer({ 
        initialState: { count: 0 } 
      });
      
      container.setState({ count: 1 });
      container.setState({ count: 2 });
      
      expect(container.getHistory()).toEqual([]);
    });
    
    test('should store state history when enabled', () => {
      const container = new StateContainer({ 
        initialState: { count: 0 },
        maxHistoryLength: 3
      });
      
      container.setState({ count: 1 });
      container.setState({ count: 2 });
      container.setState({ count: 3 });
      
      const history = container.getHistory();
      expect(history.length).toBe(3);
      expect(history[0].state.count).toBe(0);
      expect(history[1].state.count).toBe(1);
      expect(history[2].state.count).toBe(2);
    });
    
    test('should limit history to maxHistoryLength', () => {
      const container = new StateContainer({ 
        initialState: { count: 0 },
        maxHistoryLength: 2
      });
      
      container.setState({ count: 1 });
      container.setState({ count: 2 });
      container.setState({ count: 3 });
      
      const history = container.getHistory();
      expect(history.length).toBe(2);
      // Oldest entry should be removed
      expect(history[0].state.count).toBe(1);
      expect(history[1].state.count).toBe(2);
    });
    
    test('should clear history on resetState', () => {
      const container = new StateContainer({ 
        initialState: { count: 0 },
        maxHistoryLength: 5
      });
      
      container.setState({ count: 1 });
      container.setState({ count: 2 });
      container.resetState({ count: 0 });
      
      expect(container.getHistory()).toEqual([]);
    });
  });
  
  // Event emission tests
  describe('Event Emission', () => {
    let container;
    let stateChangedHandler;
    let countChangedHandler;
    
    beforeEach(() => {
      container = new StateContainer({
        initialState: { count: 0, name: 'test' },
        emitEvents: true
      });
      
      stateChangedHandler = jest.fn();
      countChangedHandler = jest.fn();
      
      container.on('stateChanged', stateChangedHandler);
      container.on('countChanged', countChangedHandler);
    });
    
    test('should emit stateChanged event', () => {
      container.setState({ count: 5 });
      
      expect(stateChangedHandler).toHaveBeenCalledTimes(1);
      const event = stateChangedHandler.mock.calls[0][0];
      
      expect(event.oldState.count).toBe(0);
      expect(event.newState.count).toBe(5);
      expect(event.changes).toEqual({ count: 5 });
      expect(event.changedKeys).toEqual(['count']);
      expect(event.version).toBe(2);
    });
    
    test('should emit property-specific change events', () => {
      container.setState({ count: 10 });
      
      expect(countChangedHandler).toHaveBeenCalledTimes(1);
      const event = countChangedHandler.mock.calls[0][0];
      
      expect(event.oldValue).toBe(0);
      expect(event.newValue).toBe(10);
      expect(event.key).toBe('count');
    });
    
    test('should not emit events when disabled', () => {
      const noEventsContainer = new StateContainer({
        initialState: { count: 0 },
        emitEvents: false
      });
      
      const handler = jest.fn();
      noEventsContainer.on('stateChanged', handler);
      
      noEventsContainer.setState({ count: 5 });
      expect(handler).not.toHaveBeenCalled();
    });
    
    test('should support subscription with unsubscribe function', () => {
      const handler = jest.fn();
      const unsubscribe = container.subscribe('stateChanged', handler);
      
      container.setState({ count: 1 });
      expect(handler).toHaveBeenCalledTimes(1);
      
      unsubscribe();
      container.setState({ count: 2 });
      expect(handler).toHaveBeenCalledTimes(1); // Still just once
    });
    
    test('should emit reset event', () => {
      const resetHandler = jest.fn();
      container.on('stateReset', resetHandler);
      
      container.resetState({ fresh: true });
      
      expect(resetHandler).toHaveBeenCalledTimes(1);
      const event = resetHandler.mock.calls[0][0];
      
      expect(event.oldState).toEqual({ count: 0, name: 'test' });
      expect(event.newState).toEqual({ fresh: true });
    });
  });
  
  // Deep freeze tests
  describe('Deep Freezing', () => {
    test('should deep freeze nested objects by default', () => {
      const container = new StateContainer({
        initialState: {
          user: {
            profile: {
              name: 'test'
            }
          },
          items: [1, 2, 3]
        }
      });
      
      const state = container.getState();
      expect(Object.isFrozen(state)).toBe(true);
      expect(Object.isFrozen(state.user)).toBe(true);
      expect(Object.isFrozen(state.user.profile)).toBe(true);
      expect(Object.isFrozen(state.items)).toBe(true);
    });
    
    test('should support shallow freeze', () => {
      const container = new StateContainer({
        initialState: {
          user: {
            profile: {
              name: 'test'
            }
          }
        },
        deepFreeze: false
      });
      
      const state = container.getState();
      expect(Object.isFrozen(state)).toBe(true);
      expect(Object.isFrozen(state.user)).toBe(false);
    });
  });
  
  // Selector tests
  describe('Selectors', () => {
    let container;
    
    beforeEach(() => {
      container = new StateContainer({
        initialState: {
          users: [
            { id: 1, name: 'Alice', role: 'admin' },
            { id: 2, name: 'Bob', role: 'user' },
            { id: 3, name: 'Charlie', role: 'user' }
          ]
        }
      });
    });
    
    test('should memoize selector results', () => {
      const computeExpensiveFn = jest.fn(state => {
        return state.users.filter(u => u.role === 'user');
      });
      
      const selectUsers = container.createSelector(computeExpensiveFn);
      
      // First call should compute
      const result1 = selectUsers();
      expect(result1.length).toBe(2);
      expect(computeExpensiveFn).toHaveBeenCalledTimes(1);
      
      // Second call should use memoized value
      const result2 = selectUsers();
      expect(result2).toBe(result1); // Same reference
      expect(computeExpensiveFn).toHaveBeenCalledTimes(1); // Still just once
      
      // After state change, should recompute
      container.setState({
        users: [
          ...container.get('users'),
          { id: 4, name: 'Dave', role: 'user' }
        ]
      });
      
      const result3 = selectUsers();
      expect(result3.length).toBe(3);
      expect(computeExpensiveFn).toHaveBeenCalledTimes(2);
    });
    
    test('should support selectors with arguments', () => {
      const selectUsersByRole = container.createSelector(
        (state, role) => state.users.filter(u => u.role === role)
      );
      
      expect(selectUsersByRole('admin').length).toBe(1);
      expect(selectUsersByRole('user').length).toBe(2);
    });
  });
  
  // Factory function test
  describe('Factory Function', () => {
    test('createStateContainer should return new instance', () => {
      const container = createStateContainer({
        initialState: { test: true }
      });
      
      expect(container).toBeInstanceOf(StateContainer);
      expect(container.getState().test).toBe(true);
    });
  });
}); 