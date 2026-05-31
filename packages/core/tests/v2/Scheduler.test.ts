import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scheduler } from '../../src/v2/core/Scheduler';
import { resetDevMode, setDevMode } from '../../src/v2/core/devMode';

const tick = () => Promise.resolve();

afterEach(() => {
  resetDevMode();
  vi.restoreAllMocks();
});

describe('Scheduler', () => {
  it('dedupes the same fn within one microtask window', async () => {
    const s = new Scheduler();
    const fn = vi.fn();
    s.schedule(fn);
    s.schedule(fn);
    s.schedule(fn);
    expect(fn).not.toHaveBeenCalled(); // 还没到 microtask
    await tick();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('runs distinct fns', async () => {
    const s = new Scheduler();
    const a = vi.fn();
    const b = vi.fn();
    s.schedule(a);
    s.schedule(b);
    await tick();
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('flush() runs pending tasks synchronously and clears the queue', () => {
    const s = new Scheduler();
    const fn = vi.fn();
    s.schedule(fn);
    expect(s.pending).toBe(true);
    s.flush();
    expect(fn).toHaveBeenCalledOnce();
    expect(s.pending).toBe(false);
  });

  it('does not re-run a flushed task when the microtask later fires', async () => {
    const s = new Scheduler();
    const fn = vi.fn();
    s.schedule(fn);
    s.flush();
    await tick(); // 原先排队的 microtask 兜底触发
    expect(fn).toHaveBeenCalledOnce(); // 不重复
  });

  it('resets after flush: a new schedule runs on the next microtask', async () => {
    const s = new Scheduler();
    const fn = vi.fn();
    s.schedule(fn);
    s.flush();
    fn.mockClear();
    s.schedule(fn);
    await tick();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('a task scheduled during flush runs in the NEXT round, not the current', async () => {
    const s = new Scheduler();
    const order: string[] = [];
    const b = () => order.push('b');
    const a = () => {
      order.push('a');
      s.schedule(b); // 重入：应进入下一轮
    };
    s.schedule(a);
    s.flush();
    expect(order).toEqual(['a']); // 本轮只有 a
    expect(s.pending).toBe(true); // b 还挂着
    await tick();
    expect(order).toEqual(['a', 'b']);
  });

  it('pending reflects queue state', async () => {
    const s = new Scheduler();
    expect(s.pending).toBe(false);
    s.schedule(() => {});
    expect(s.pending).toBe(true);
    await tick();
    expect(s.pending).toBe(false);
  });

  it('clear() cancels pending tasks without running them', async () => {
    const s = new Scheduler();
    const fn = vi.fn();
    s.schedule(fn);
    s.clear();
    expect(s.pending).toBe(false);
    await tick();
    expect(fn).not.toHaveBeenCalled();
  });

  it('isolates a throwing task from the rest of the batch', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setDevMode(true);
    const s = new Scheduler();
    const after = vi.fn();
    s.schedule(() => {
      throw new Error('boom');
    });
    s.schedule(after);
    await tick();
    expect(after).toHaveBeenCalledOnce();
  });
});
