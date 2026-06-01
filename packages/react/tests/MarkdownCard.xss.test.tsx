import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import MarkdownCard from '../src/components/ChatMessageCard/components/MarkdownCard/index';

/**
 * 守护 S0 的 XSS 修复：MarkdownCard 经 rehype-sanitize 渲染，不可信内容里的
 * 危险节点必须被剥离。回归这条测试 = 防止有人误删 rehype-sanitize。
 */
describe('MarkdownCard XSS sanitize (S0 regression net)', () => {
  it('strips <script> / onerror / javascript: from untrusted markdown', () => {
    const payload = [
      '# 标题',
      '正常 **加粗**',
      '<img src=x onerror="window.__xss=1">',
      '<script>window.__xss=1</' + 'script>',
      '<a href="javascript:window.__xss=1">x</a>',
    ].join('\n\n');

    const { container } = render(
      // @ts-expect-error demo 直接传字符串 content
      <MarkdownCard content={payload} />,
    );

    // 正常 markdown 仍渲染
    expect(container.querySelector('h1')).toBeTruthy();
    expect(container.querySelector('strong')).toBeTruthy();

    // 危险内容被剥离：无真实 script 元素、无 onerror 属性、无 javascript: 链接
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    const jsLink = Array.from(container.querySelectorAll('a')).some((a) =>
      (a.getAttribute('href') || '').toLowerCase().startsWith('javascript:'),
    );
    expect(jsLink).toBe(false);
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  });
});
