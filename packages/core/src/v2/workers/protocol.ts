import type { MarkdownMeta, ParseOptions } from './markdownParser';

/**
 * 主线程 → Worker 的消息。
 * 用内部自增 `seq` 关联请求/响应；coalesce / cancel 全在 client 侧按 seq 处理，
 * 因此 Worker 保持**无状态**（只解析并回显 seq），简单且易测。
 *
 * `source` 以字符串经结构化克隆传递（简单、健壮）。若未来 profiling 表明大文本
 * 拷贝成为瓶颈，可在此扩展一个按大小阈值启用的 Transferable（ArrayBuffer）变体。
 */
export type WorkerRequest =
  | { kind: 'parse'; seq: number; source: string; options?: ParseOptions }
  | { kind: 'dispose' };

/** Worker → 主线程的响应。 */
export type WorkerResponse =
  | { kind: 'result'; seq: number; html: string; meta: MarkdownMeta }
  | { kind: 'error'; seq: number; message: string };
