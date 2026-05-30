import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseStatefulManager } from '../../src/v2/managers/BaseStatefulManager';

class TestManager extends BaseStatefulManager<{ tick: [n: number] }> {
  run(fn: () => void, delay: number) {
    return this.schedule(fn, delay);
  }
  cancel(timer: ReturnType<typeof setTimeout>) {
    this.clearTimer(timer);
  }
  nowValue() {
    return this.now();
  }
  newId() {
    return this.generateId();
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('BaseStatefulManager', () => {
  it('runs a scheduled callback after the delay', () => {
    const m = new TestManager();
    const fn = vi.fn();
    m.run(fn, 100);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('tracks pending timers and auto-removes after firing', () => {
    const m = new TestManager();
    m.run(() => {}, 100);
    m.run(() => {}, 200);
    expect(m.pendingTimers).toBe(2);
    vi.advanceTimersByTime(100);
    expect(m.pendingTimers).toBe(1);
    vi.advanceTimersByTime(100);
    expect(m.pendingTimers).toBe(0);
  });

  it('clearTimer cancels a specific timer', () => {
    const m = new TestManager();
    const fn = vi.fn();
    const t = m.run(fn, 100);
    m.cancel(t);
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
    expect(m.pendingTimers).toBe(0);
  });

  it('destroy clears all pending timers and listeners', () => {
    const m = new TestManager();
    const fn = vi.fn();
    m.run(fn, 100);
    m.on('tick', () => {});
    m.destroy();
    expect(m.pendingTimers).toBe(0);
    expect(m.listenerCount('tick')).toBe(0);
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
  });

  it('injects now and idGenerator', () => {
    const m = new TestManager({ now: () => 42, idGenerator: () => 'fixed' });
    expect(m.nowValue()).toBe(42);
    expect(m.newId()).toBe('fixed');
  });
});
