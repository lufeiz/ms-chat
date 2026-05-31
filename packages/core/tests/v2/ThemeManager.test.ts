import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeManager } from '../../src/v2/theme/ThemeManager';
import { resetDevMode, setDevMode } from '../../src/v2/core/devMode';

const root = () => document.documentElement;
const cssVar = (name: string) => root().style.getPropertyValue(name);

beforeEach(() => {
  root().removeAttribute('style'); // 清掉上个用例的 CSS 变量
});

afterEach(() => {
  resetDevMode();
  vi.restoreAllMocks();
});

describe('ThemeManager', () => {
  it('applies a shallow (2-level) change as a CSS variable', () => {
    const tm = new ThemeManager();
    tm.setThemeConfig({ conversation: { 'c-s-width': '300px' } });
    expect(cssVar('--mschat--conversation--c-s-width')).toBe('300px');
  });

  it('applies a deep (3-level) change — regression for H10', () => {
    const tm = new ThemeManager<{ a: { b: { c: string } } }>();
    tm.setThemeConfig({ a: { b: { c: '#fff' } } });
    expect(cssVar('--mschat--a--b--c')).toBe('#fff'); // v1 在此静默失效
  });

  it('does not call setProperty for unchanged fields', () => {
    const tm = new ThemeManager();
    tm.setThemeConfig({ header: { bg: '#000' } });
    const spy = vi.spyOn(root().style, 'setProperty');
    tm.setThemeConfig({ header: { bg: '#000' } }); // 同值
    expect(spy).not.toHaveBeenCalled();
  });

  it('batches multiple changes: one theme:change with all paths', () => {
    const tm = new ThemeManager();
    const onChange = vi.fn();
    tm.on('theme:change', onChange);
    tm.setThemeConfig({
      header: { bg: '#111', height: '4em' },
      base: { 'font-size': '14px' },
    });
    expect(onChange).toHaveBeenCalledOnce();
    const changes = onChange.mock.calls[0][1];
    expect(changes.map((c: { path: string }) => c.path).sort()).toEqual([
      'base.font-size',
      'header.bg',
      'header.height',
    ]);
  });

  it('undefined value removes the CSS variable', () => {
    const tm = new ThemeManager();
    tm.setThemeConfig({ header: { bg: '#000' } });
    expect(cssVar('--mschat--header--bg')).toBe('#000');
    const spy = vi.spyOn(root().style, 'removeProperty');
    tm.setThemeConfig({ header: { bg: undefined } });
    expect(spy).toHaveBeenCalledWith('--mschat--header--bg');
    expect(cssVar('--mschat--header--bg')).toBe('');
  });

  it('getThemeConfig is reference-stable until a real change (fixes P3)', () => {
    const tm = new ThemeManager();
    tm.setThemeConfig({ header: { bg: '#000' } });
    const a = tm.getThemeConfig();
    const b = tm.getThemeConfig();
    expect(a).toBe(b); // 同引用
    tm.setThemeConfig({ header: { bg: '#000' } }); // 无变更
    expect(tm.getThemeConfig()).toBe(a); // 仍同引用
    tm.setThemeConfig({ header: { bg: '#fff' } }); // 有变更
    expect(tm.getThemeConfig()).not.toBe(a); // 换新引用
  });

  it('returns a frozen config in dev mode (mutation throws)', () => {
    setDevMode(true);
    const tm = new ThemeManager();
    tm.setThemeConfig({ header: { bg: '#000' } });
    const theme = tm.getThemeConfig() as { header: { bg: string } };
    expect(Object.isFrozen(theme)).toBe(true);
    expect(() => {
      theme.header.bg = 'mutated';
    }).toThrow(); // 深冻结，嵌套也抛
  });

  it('theme:change payload carries theme + structured changes', () => {
    const tm = new ThemeManager();
    const onChange = vi.fn();
    tm.on('theme:change', onChange);
    tm.setThemeConfig({ header: { bg: '#abc' } });
    const [theme, changes] = onChange.mock.calls[0];
    expect((theme as { header: { bg: string } }).header.bg).toBe('#abc');
    expect(changes[0]).toEqual({
      path: 'header.bg',
      cssVar: '--mschat--header--bg',
      oldValue: undefined,
      newValue: '#abc',
    });
  });

  it('structural sharing: untouched subtrees keep their reference', () => {
    const tm = new ThemeManager();
    tm.setThemeConfig({
      header: { bg: '#000' },
      conversation: { 'c-s-width': '240px' },
    });
    const before = tm.getThemeConfig() as Record<string, unknown>;
    const headerRef = before.header;
    tm.setThemeConfig({ conversation: { 'c-s-width': '300px' } }); // 只改 conversation
    const after = tm.getThemeConfig() as Record<string, unknown>;
    expect(after.header).toBe(headerRef); // header 子树引用未变
    expect(after.conversation).not.toBe(before.conversation); // conversation 换新
  });

  it('applies the initial config via the constructor', () => {
    const tm = new ThemeManager({ header: { bg: '#222' } });
    expect(cssVar('--mschat--header--bg')).toBe('#222');
    expect(
      (tm.getThemeConfig() as { header: { bg: string } }).header.bg,
    ).toBe('#222');
  });

  it('SSR: no document — does not throw and still emits theme:change', () => {
    vi.stubGlobal('document', undefined);
    try {
      const tm = new ThemeManager();
      const onChange = vi.fn();
      tm.on('theme:change', onChange);
      expect(() =>
        tm.setThemeConfig({ header: { bg: '#000' } }),
      ).not.toThrow();
      expect(onChange).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('on(theme:change) returns a disposer that cancels the subscription', () => {
    const tm = new ThemeManager();
    const onChange = vi.fn();
    const dispose = tm.on('theme:change', onChange);
    dispose();
    tm.setThemeConfig({ header: { bg: '#000' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('handles add + change + remove in a single set', () => {
    const tm = new ThemeManager();
    tm.setThemeConfig({ header: { bg: '#000', height: '4em' } });
    const setSpy = vi.spyOn(root().style, 'setProperty');
    const removeSpy = vi.spyOn(root().style, 'removeProperty');
    tm.setThemeConfig({
      header: { bg: '#fff', height: undefined }, // 改 bg, 删 height
      base: { 'font-size': '14px' }, // 新增
    });
    expect(setSpy).toHaveBeenCalledWith('--mschat--header--bg', '#fff');
    expect(setSpy).toHaveBeenCalledWith('--mschat--base--font-size', '14px');
    expect(removeSpy).toHaveBeenCalledWith('--mschat--header--height');
  });
});
