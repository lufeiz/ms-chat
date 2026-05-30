import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PluginSystem,
  createWrappedFunction,
} from '../../src/v2/plugin/PluginSystem';
import { resetDevMode, setDevMode } from '../../src/v2/core/devMode';

afterEach(() => {
  resetDevMode();
  vi.restoreAllMocks();
});

describe('PluginSystem', () => {
  it('runs the pipeline in order: before → transform → fn → after', async () => {
    const ps = new PluginSystem();
    const order: string[] = [];
    ps.register({
      targetFunction: 'f',
      hookType: 'before',
      handler: () => {
        order.push('before');
      },
    });
    ps.register({
      targetFunction: 'f',
      hookType: 'transform',
      handler: () => {
        order.push('transform');
      },
    });
    ps.register({
      targetFunction: 'f',
      hookType: 'after',
      handler: () => {
        order.push('after');
      },
    });

    const result = await ps.run(
      'f',
      (...a: number[]) => {
        order.push('fn');
        return a[0] + 1;
      },
      [41],
    );

    expect(order).toEqual(['before', 'transform', 'fn', 'after']);
    expect(result).toBe(42);
  });

  it('runs error hooks and rethrows when the fn throws', async () => {
    const ps = new PluginSystem();
    const onError = vi.fn();
    ps.register({ targetFunction: 'f', hookType: 'error', handler: onError });
    const boom = new Error('boom');

    await expect(
      ps.run('f', () => {
        throw boom;
      }, []),
    ).rejects.toBe(boom);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].error).toBe(boom);
  });

  it('executes higher-priority hooks first', async () => {
    const ps = new PluginSystem();
    const order: number[] = [];
    ps.register({
      targetFunction: 'f',
      hookType: 'before',
      priority: 1,
      handler: () => void order.push(1),
    });
    ps.register({
      targetFunction: 'f',
      hookType: 'before',
      priority: 10,
      handler: () => void order.push(10),
    });
    ps.register({
      targetFunction: 'f',
      hookType: 'before',
      priority: 5,
      handler: () => void order.push(5),
    });
    await ps.run('f', () => undefined, []);
    expect(order).toEqual([10, 5, 1]);
  });

  describe('before short-circuit', () => {
    it('returning false skips the fn and resolves to false', async () => {
      const ps = new PluginSystem();
      const fn = vi.fn(() => 'ran');
      ps.register({
        targetFunction: 'f',
        hookType: 'before',
        handler: () => false,
      });
      const result = await ps.run('f', fn, []);
      expect(result).toBe(false);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('transform', () => {
    it('rewrites the args passed downstream to the fn', async () => {
      const ps = new PluginSystem();
      ps.register({
        targetFunction: 'f',
        hookType: 'transform',
        handler: (ctx) => ({ args: [(ctx.args[0] as number) * 10] }),
      });
      const result = await ps.run('f', (n: number) => n + 1, [4]);
      expect(result).toBe(41);
    });

    it('returning { result } short-circuits the fn', async () => {
      const ps = new PluginSystem();
      const fn = vi.fn(() => 'original');
      ps.register({
        targetFunction: 'f',
        hookType: 'transform',
        handler: () => ({ result: 'replaced' }),
      });
      const result = await ps.run('f', fn, []);
      expect(result).toBe('replaced');
      expect(fn).not.toHaveBeenCalled();
    });

    it('returning nothing leaves the pipeline unchanged', async () => {
      const ps = new PluginSystem();
      ps.register({
        targetFunction: 'f',
        hookType: 'transform',
        handler: () => undefined,
      });
      const result = await ps.run('f', (n: number) => n + 1, [1]);
      expect(result).toBe(2);
    });
  });

  describe('unregister', () => {
    it('the disposer returned by register removes the hook', async () => {
      const ps = new PluginSystem();
      const hook = vi.fn();
      const dispose = ps.register({
        targetFunction: 'f',
        hookType: 'before',
        handler: hook,
      });
      dispose();
      await ps.run('f', () => undefined, []);
      expect(hook).not.toHaveBeenCalled();
    });

    it('unregister(id) takes effect immediately', async () => {
      const ps = new PluginSystem();
      const hook = vi.fn();
      ps.register({
        id: 'my-hook',
        targetFunction: 'f',
        hookType: 'before',
        handler: hook,
      });
      expect(ps.unregister('my-hook')).toBe(true);
      expect(ps.unregister('my-hook')).toBe(false);
      await ps.run('f', () => undefined, []);
      expect(hook).not.toHaveBeenCalled();
    });

    it('unregisterAll(targetFunction) clears only that function', async () => {
      const ps = new PluginSystem();
      ps.register({ targetFunction: 'f', hookType: 'before', handler: () => {} });
      ps.register({ targetFunction: 'g', hookType: 'before', handler: () => {} });
      ps.unregisterAll('f');
      expect(ps.list('f')).toHaveLength(0);
      expect(ps.list('g')).toHaveLength(1);
    });

    it('unregisterAll() clears everything', () => {
      const ps = new PluginSystem();
      ps.register({ targetFunction: 'f', hookType: 'before', handler: () => {} });
      ps.register({ targetFunction: 'g', hookType: 'after', handler: () => {} });
      ps.unregisterAll();
      expect(ps.list()).toHaveLength(0);
    });
  });

  describe('devMode validation', () => {
    it('throws on a misspelled hookType in dev mode', () => {
      setDevMode(true);
      const ps = new PluginSystem();
      expect(() =>
        ps.register({
          targetFunction: 'f',
          // @ts-expect-error intentional typo
          hookType: 'beofre',
          handler: () => {},
        }),
      ).toThrow(/invalid hookType/);
    });

    it('does not throw in prod mode', () => {
      setDevMode(false);
      const ps = new PluginSystem();
      expect(() =>
        ps.register({
          targetFunction: 'f',
          // @ts-expect-error intentional typo
          hookType: 'beofre',
          handler: () => {},
        }),
      ).not.toThrow();
    });
  });

  describe('createWrappedFunction', () => {
    it('wraps a function so plugins run around it', async () => {
      const ps = new PluginSystem();
      const after = vi.fn();
      ps.register({ targetFunction: 'add', hookType: 'after', handler: after });
      const add = createWrappedFunction(
        (a: number, b: number) => a + b,
        'add',
        ps,
      );
      const result = await add(2, 3);
      expect(result).toBe(5);
      expect(after).toHaveBeenCalledOnce();
      expect(after.mock.calls[0][0].result).toBe(5);
    });

    it('returns false when a before hook short-circuits', async () => {
      const ps = new PluginSystem();
      ps.register({
        targetFunction: 'add',
        hookType: 'before',
        handler: () => false,
      });
      const fn = vi.fn((a: number, b: number) => a + b);
      const add = createWrappedFunction(fn, 'add', ps);
      expect(await add(2, 3)).toBe(false);
      expect(fn).not.toHaveBeenCalled();
    });
  });
});
