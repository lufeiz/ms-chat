import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  devAssert,
  devWarn,
  isDevMode,
  resetDevMode,
  setDevMode,
} from '../../src/v2/core/devMode';

afterEach(() => {
  resetDevMode();
  vi.restoreAllMocks();
});

describe('devMode', () => {
  it('defaults to dev mode under vitest', () => {
    expect(isDevMode()).toBe(true);
  });

  it('setDevMode(false) disables, setDevMode(null) restores compile default', () => {
    setDevMode(false);
    expect(isDevMode()).toBe(false);
    setDevMode(null);
    expect(isDevMode()).toBe(true);
  });

  describe('devAssert', () => {
    it('throws on falsy condition in dev mode', () => {
      setDevMode(true);
      expect(() => devAssert(false, 'boom')).toThrow('[ms-chat/core] boom');
    });

    it('passes through on truthy condition', () => {
      setDevMode(true);
      expect(() => devAssert(1, 'should not throw')).not.toThrow();
    });

    it('is silent in prod mode even when condition is falsy', () => {
      setDevMode(false);
      expect(() => devAssert(false, 'silent')).not.toThrow();
    });

    it('narrows the type after asserting (compile-time contract)', () => {
      setDevMode(true);
      const value: string | null = 'x';
      devAssert(value !== null, 'value required');
      // 若收窄失效，下一行在 strict 下会报 possibly-null
      expect(value.length).toBe(1);
    });
  });

  describe('devWarn', () => {
    it('warns on falsy condition in dev mode', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      setDevMode(true);
      devWarn(false, 'heads up');
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0]).toContain('[ms-chat/core] heads up');
    });

    it('does not warn on truthy condition', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      setDevMode(true);
      devWarn(true, 'no warn');
      expect(spy).not.toHaveBeenCalled();
    });

    it('is silent in prod mode', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      setDevMode(false);
      devWarn(false, 'silent');
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
