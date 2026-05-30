import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComponentRegistry } from '../../src/v2/store/ComponentRegistry';
import { resetDevMode, setDevMode } from '../../src/v2/core/devMode';

afterEach(() => {
  resetDevMode();
  vi.restoreAllMocks();
});

describe('ComponentRegistry', () => {
  it('registers and retrieves components', () => {
    const reg = new ComponentRegistry<string>();
    reg.register('text', 'TextCard');
    expect(reg.get('text')).toBe('TextCard');
    expect(reg.has('text')).toBe(true);
    expect(reg.has('image')).toBe(false);
  });

  it('the disposer removes the registration', () => {
    const reg = new ComponentRegistry<string>();
    const dispose = reg.register('text', 'TextCard');
    dispose();
    expect(reg.has('text')).toBe(false);
  });

  it('disposer does not remove a newer registration of the same type', () => {
    const reg = new ComponentRegistry<string>();
    const dispose = reg.register('text', 'Old');
    reg.register('text', 'New');
    dispose();
    expect(reg.get('text')).toBe('New');
  });

  it('lists and clears', () => {
    const reg = new ComponentRegistry<number>();
    reg.register('a', 1);
    reg.register('b', 2);
    expect(reg.list().sort()).toEqual(['a', 'b']);
    expect(reg.size).toBe(2);
    reg.clear();
    expect(reg.size).toBe(0);
  });

  it('warns on overwrite in dev mode', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setDevMode(true);
    const reg = new ComponentRegistry<number>();
    reg.register('a', 1);
    reg.register('a', 2);
    expect(spy).toHaveBeenCalledOnce();
    expect(reg.get('a')).toBe(2);
  });

  it('two registries are isolated (fixes global-state E1)', () => {
    const a = new ComponentRegistry<string>();
    const b = new ComponentRegistry<string>();
    a.register('text', 'A');
    expect(b.has('text')).toBe(false);
  });
});
