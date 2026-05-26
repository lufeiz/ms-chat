import { describe, expect, it } from 'vitest';
import {
  EventEmitter,
  debounce,
  formatDateTime,
  shuffleArray,
  isPlainObject,
  isFunction,
  isString,
} from '../src';

/**
 * Phase 0 冒烟测试：仅验证 vitest 工具链跑通，以及上一轮清理后
 * utils/ 重组与公共导出未破坏现有 surface。
 * 真正的模块单测在 Phase 1 PR-1 起按 RFC §4.3 落地。
 */
describe('vitest smoke', () => {
  it('runs in jsdom environment', () => {
    expect(typeof window).toBe('object');
    expect(typeof document).toBe('object');
  });

  it('exposes utils after merge', () => {
    expect(typeof debounce).toBe('function');
    expect(typeof formatDateTime).toBe('function');
    expect(typeof shuffleArray).toBe('function');
  });

  it('exposes typeUtils (previously unexported)', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isFunction(() => {})).toBe(true);
    expect(isString('a')).toBe(true);
  });

  it('exposes EventEmitter from @ms-chat/core entry', () => {
    const emitter = new EventEmitter();
    let received: number | null = null;
    emitter.on('ping', (n: number) => {
      received = n;
    });
    emitter.emit('ping', 42);
    expect(received).toBe(42);
  });

  it('formatDateTime renders pattern with leading zeros', () => {
    const out = formatDateTime(new Date(2026, 0, 3, 4, 5, 6));
    expect(out).toBe('2026-01-03 04:05:06');
  });
});
