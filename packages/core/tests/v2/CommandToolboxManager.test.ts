import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CommandToolboxManager,
  type CommandItem,
} from '../../src/v2/managers/CommandToolboxManager';

const cmd = (id: string, label: string, handler = vi.fn()): CommandItem => ({
  id,
  label,
  handler,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CommandToolboxManager', () => {
  it('opens and filters on trigger-char input', () => {
    const m = new CommandToolboxManager({ debounceFilter: 0 });
    m.register(cmd('help', 'Help'));
    m.register(cmd('home', 'Home'));
    m.register(cmd('quit', 'Quit'));
    const handled = m.handleInput('/h');
    expect(handled).toBe(true);
    expect(m.isVisible()).toBe(true);
    expect(m.getState().filteredCommands.map((c) => c.id).sort()).toEqual([
      'help',
      'home',
    ]);
  });

  it('debounces the filter', () => {
    const m = new CommandToolboxManager({ debounceFilter: 100 });
    m.register(cmd('help', 'Help'));
    const onFilter = vi.fn();
    m.on('toolbox:filter', onFilter);
    m.handleInput('/h');
    m.handleInput('/he');
    m.handleInput('/hel');
    // open() does an immediate applyFilter once; subsequent scheduleFilter is debounced
    const callsBefore = onFilter.mock.calls.length;
    vi.advanceTimersByTime(100);
    expect(onFilter.mock.calls.length).toBe(callsBefore + 1);
  });

  it('closing input hides the panel', () => {
    const m = new CommandToolboxManager({ debounceFilter: 0 });
    m.handleInput('/h');
    expect(m.isVisible()).toBe(true);
    m.handleInput('hello'); // 不以 triggerChar 开头
    expect(m.getAnimationPhase()).toBe('closing');
  });

  describe('navigation', () => {
    it('wraps around with ArrowDown / ArrowUp', () => {
      const m = new CommandToolboxManager({ debounceFilter: 0 });
      m.register(cmd('a', 'Apple'));
      m.register(cmd('b', 'Banana'));
      m.handleInput('/');
      expect(m.getState().activeIndex).toBe(0);
      m.handleKeydown('ArrowDown');
      expect(m.getState().activeIndex).toBe(1);
      m.handleKeydown('ArrowDown'); // wrap
      expect(m.getState().activeIndex).toBe(0);
      m.handleKeydown('ArrowUp'); // wrap back
      expect(m.getState().activeIndex).toBe(1);
    });
  });

  it('selectActive runs the handler and closes', () => {
    const handler = vi.fn();
    const m = new CommandToolboxManager({ debounceFilter: 0 });
    m.register(cmd('go', 'Go', handler));
    m.handleInput('/go');
    const selected = m.selectActive();
    expect(selected?.id).toBe('go');
    expect(handler).toHaveBeenCalledOnce();
    expect(m.getAnimationPhase()).toBe('closing');
  });

  describe('register/unregister', () => {
    it('the disposer unregisters', () => {
      const m = new CommandToolboxManager({ debounceFilter: 0 });
      const dispose = m.register(cmd('x', 'X'));
      expect(m.getCommand('x')).toBeDefined();
      dispose();
      expect(m.getCommand('x')).toBeUndefined();
    });

    it('re-filters live when visible', () => {
      const m = new CommandToolboxManager({ debounceFilter: 0 });
      m.register(cmd('a', 'Apple'));
      m.handleInput('/');
      expect(m.getState().filteredCommands).toHaveLength(1);
      m.register(cmd('b', 'Banana'));
      expect(m.getState().filteredCommands).toHaveLength(2);
    });
  });

  describe('getState reference stability (P5)', () => {
    it('returns the same reference until state changes', () => {
      const m = new CommandToolboxManager({ debounceFilter: 0 });
      m.register(cmd('a', 'Apple'));
      const s1 = m.getState();
      expect(m.getState()).toBe(s1);
      m.handleInput('/a');
      expect(m.getState()).not.toBe(s1);
    });
  });

  it('open → visible after the animation duration', () => {
    const m = new CommandToolboxManager({ animationDuration: 200, debounceFilter: 0 });
    m.handleInput('/');
    expect(m.getAnimationPhase()).toBe('opening');
    vi.advanceTimersByTime(200);
    expect(m.getAnimationPhase()).toBe('visible');
  });

  it('destroy clears timers', () => {
    const m = new CommandToolboxManager({ debounceFilter: 50 });
    m.register(cmd('a', 'Apple'));
    m.handleInput('/a');
    m.destroy();
    expect(m.pendingTimers).toBe(0);
  });
});
