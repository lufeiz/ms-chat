import { marked } from 'marked';

/** 解析选项（预留扩展点，跨主线程/Worker 须可结构化克隆）。 */
export interface ParseOptions {
  /** 流式中间态：容忍未闭合代码块等（marked 本身已较宽容，预留语义）。 */
  streamingMode?: boolean;
}

/** 解析产出的轻量元信息，供消费方做目录/统计等。 */
export interface MarkdownMeta {
  headings: Array<{ level: number; text: string }>;
  codeBlocks: number;
}

/** 一次解析的结果。`id` 回显调用方传入的消息 id。 */
export interface ParseResult {
  id: string;
  html: string;
  meta: MarkdownMeta;
}

/**
 * 从 markdown 源提取元信息（标题、代码块数）。递归遍历 token 以覆盖列表/引用等嵌套结构。
 * 对 token 形状做防御性读取，避免耦合 marked 具体版本的字段类型。
 */
function extractMeta(source: string): MarkdownMeta {
  const headings: Array<{ level: number; text: string }> = [];
  let codeBlocks = 0;

  const visit = (tokens: unknown[]): void => {
    for (const raw of tokens) {
      if (!raw || typeof raw !== 'object') continue;
      const t = raw as Record<string, unknown>;
      if (t.type === 'heading') {
        headings.push({
          level: Number(t.depth) || 1,
          text: String(t.text ?? ''),
        });
      } else if (t.type === 'code') {
        codeBlocks += 1;
      }
      if (Array.isArray(t.tokens)) visit(t.tokens);
      if (Array.isArray(t.items)) visit(t.items);
    }
  };

  visit(marked.lexer(source));
  return { headings, codeBlocks };
}

/**
 * 纯函数：markdown → { html, meta }。**无副作用、不依赖 DOM**，因此
 * Worker 与主线程 fallback 可共用同一实现，避免两份解析逻辑漂移。
 */
export function parseMarkdown(
  source: string,
  _options?: ParseOptions,
): { html: string; meta: MarkdownMeta } {
  const src = source ?? '';
  // async: false 强制同步返回字符串（无异步扩展时本就是同步）。
  const html = marked.parse(src, { async: false }) as string;
  return { html, meta: extractMeta(src) };
}
