import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../../src/v2/workers/markdownParser';

describe('parseMarkdown', () => {
  it('renders headings and code blocks to html', () => {
    const { html } = parseMarkdown('# Title\n\n```js\nconst a = 1;\n```');
    expect(html).toContain('<h1');
    expect(html).toContain('Title');
    expect(html).toContain('<pre>');
  });

  it('extracts heading meta (level + text, in document order)', () => {
    const { meta } = parseMarkdown('# A\n\n## B\n\n### C');
    expect(meta.headings).toEqual([
      { level: 1, text: 'A' },
      { level: 2, text: 'B' },
      { level: 3, text: 'C' },
    ]);
  });

  it('counts code blocks', () => {
    const { meta } = parseMarkdown('```js\na\n```\n\ntext\n\n```py\nb\n```');
    expect(meta.codeBlocks).toBe(2);
  });

  it('empty source yields empty html and empty meta', () => {
    const { html, meta } = parseMarkdown('');
    expect(html).toBe('');
    expect(meta).toEqual({ headings: [], codeBlocks: 0 });
  });

  it('renders lists and gfm tables without throwing', () => {
    const { html } = parseMarkdown('- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<ul>');
    expect(html).toContain('<table>');
  });

  it('tolerates an unclosed code fence (streaming mid-state)', () => {
    const { html } = parseMarkdown('```js\nconst a = 1;', {
      streamingMode: true,
    });
    expect(html).toContain('<pre>'); // 渲染为代码块，不抛错
  });
});
