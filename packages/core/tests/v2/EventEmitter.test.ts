import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { EventEmitter } from '../../src/v2/core/EventEmitter';
import { resetDevMode, setDevMode } from '../../src/v2/core/devMode';

afterEach(() => {
  resetDevMode();
  vi.restoreAllMocks();
});

describe('EventEmitter', () => {
  it('invokes handlers in registration order', () => {
    const ee = new EventEmitter();
    const order: number[] = [];
    ee.on('e', () => order.push(1));
    ee.on('e', () => order.push(2));
    ee.on('e', () => order.push(3));
    ee.emit('e');
    expect(order).toEqual([1, 2, 3]);
  });

  it('passes emit args to handlers', () => {
    const ee = new EventEmitter<{ ping: [n: number, s: string] }>();
    const handler = vi.fn();
    ee.on('ping', handler);
    ee.emit('ping', 42, 'x');
    expect(handler).toHaveBeenCalledWith(42, 'x');
  });

  it('fires the same handler once per registration (multiple on)', () => {
    const ee = new EventEmitter();
    const handler = vi.fn();
    ee.on('e', handler);
    ee.on('e', handler);
    ee.emit('e');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('emit on an unknown event is a no-op', () => {
    const ee = new EventEmitter();
    expect(() => ee.emit('nope')).not.toThrow();
  });

  describe('off', () => {
    it('off(event, handler) removes only that handler', () => {
      const ee = new EventEmitter();
      const a = vi.fn();
      const b = vi.fn();
      ee.on('e', a);
      ee.on('e', b);
      ee.off('e', a);
      ee.emit('e');
      expect(a).not.toHaveBeenCalled();
      expect(b).toHaveBeenCalledOnce();
    });

    it('off(event) removes all handlers', () => {
      const ee = new EventEmitter();
      const a = vi.fn();
      const b = vi.fn();
      ee.on('e', a);
      ee.on('e', b);
      ee.off('e');
      ee.emit('e');
      expect(a).not.toHaveBeenCalled();
      expect(b).not.toHaveBeenCalled();
      expect(ee.listenerCount('e')).toBe(0);
    });
  });

  describe('on disposer', () => {
    it('the returned disposer removes the listener', () => {
      const ee = new EventEmitter();
      const handler = vi.fn();
      const dispose = ee.on('e', handler);
      dispose();
      ee.emit('e');
      expect(handler).not.toHaveBeenCalled();
    });

    it('calling the disposer twice is safe', () => {
      const ee = new EventEmitter();
      const handler = vi.fn();
      const dispose = ee.on('e', handler);
      dispose();
      expect(() => dispose()).not.toThrow();
    });
  });

  describe('once', () => {
    it('fires at most once', () => {
      const ee = new EventEmitter();
      const handler = vi.fn();
      ee.once('e', handler);
      ee.emit('e');
      ee.emit('e');
      expect(handler).toHaveBeenCalledOnce();
      expect(ee.listenerCount('e')).toBe(0);
    });

    it('disposer cancels before it fires', () => {
      const ee = new EventEmitter();
      const handler = vi.fn();
      const dispose = ee.once('e', handler);
      dispose();
      ee.emit('e');
      expect(handler).not.toHaveBeenCalled();
    });

    it('off(event, originalHandler) removes a once listener (H5)', () => {
      const ee = new EventEmitter();
      const handler = vi.fn();
      ee.once('e', handler);
      ee.off('e', handler);
      ee.emit('e');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('error isolation (H4)', () => {
    it('a throwing handler does not stop later handlers', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const ee = new EventEmitter();
      const after = vi.fn();
      ee.on('e', () => {
        throw new Error('boom');
      });
      ee.on('e', after);
      ee.emit('e');
      expect(after).toHaveBeenCalledOnce();
    });

    it('routes errors through onError(err, eventName)', () => {
      const onError = vi.fn();
      const ee = new EventEmitter({ onError });
      const err = new Error('boom');
      ee.on('e', () => {
        throw err;
      });
      ee.emit('e');
      expect(onError).toHaveBeenCalledWith(err, 'e');
    });

    it('snapshot iteration: a handler removing itself does not skip the next (H4)', () => {
      const ee = new EventEmitter();
      const b = vi.fn();
      const a = () => ee.off('e', a as never);
      ee.on('e', a);
      ee.on('e', b);
      ee.emit('e');
      expect(b).toHaveBeenCalledOnce();
    });

    it('stopOnError: true halts after the first throw and rethrows', () => {
      const ee = new EventEmitter({ stopOnError: true });
      const after = vi.fn();
      ee.on('e', () => {
        throw new Error('boom');
      });
      ee.on('e', after);
      expect(() => ee.emit('e')).toThrow('boom');
      expect(after).not.toHaveBeenCalled();
    });
  });

  describe('maxListeners', () => {
    it('warns once when exceeding the threshold in dev mode', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      setDevMode(true);
      const ee = new EventEmitter({ maxListeners: 2 });
      ee.on('e', () => {});
      ee.on('e', () => {});
      ee.on('e', () => {}); // 3 > 2 → warn
      ee.on('e', () => {}); // still over, but no re-warn
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0]).toContain('maxListeners=2');
    });

    it('does not warn in prod mode', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      setDevMode(false);
      const ee = new EventEmitter({ maxListeners: 1 });
      ee.on('e', () => {});
      ee.on('e', () => {});
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('removeAllListeners', () => {
    it('clears a single event', () => {
      const ee = new EventEmitter();
      ee.on('a', () => {});
      ee.on('b', () => {});
      ee.removeAllListeners('a');
      expect(ee.listenerCount('a')).toBe(0);
      expect(ee.listenerCount('b')).toBe(1);
    });

    it('clears every event when called without arg', () => {
      const ee = new EventEmitter();
      ee.on('a', () => {});
      ee.on('b', () => {});
      ee.removeAllListeners();
      expect(ee.listenerCount('a')).toBe(0);
      expect(ee.listenerCount('b')).toBe(0);
    });
  });

  describe('types', () => {
    it('constrains event names and argument tuples', () => {
      const ee = new EventEmitter<{ change: [next: number]; close: [] }>();
      ee.emit('change', 1);
      ee.emit('close');
      ee.on('change', (next) => {
        expectTypeOf(next).toEqualTypeOf<number>();
      });
      // @ts-expect-error wrong arg type
      ee.emit('change', 'not-a-number');
      // @ts-expect-error unknown event
      ee.emit('unknown');
    });
  });
});
