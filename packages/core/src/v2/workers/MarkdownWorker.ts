import type {
  MarkdownMeta,
  ParseOptions,
  ParseResult,
} from './markdownParser';
import type { WorkerResponse } from './protocol';

export type { MarkdownMeta, ParseOptions, ParseResult };

/** 单次解析请求。`id` 通常是消息 id；coalesce 模式下同 id 的新请求会取消旧请求。 */
export interface ParseRequest {
  id: string;
  source: string;
  options?: ParseOptions;
}

export interface MarkdownWorkerOptions {
  /** Worker 实例数。多会话并发可设 2-4。默认 1。 */
  poolSize?: number;
  /** 同 id 的新请求自动取消尚未完成的旧请求（治流式高频更新堆积）。默认 true。 */
  coalesce?: boolean;
  /**
   * 自定义 Worker 创建方式。默认用 `new URL('./markdown.worker.ts', import.meta.url)`。
   * 注入点用途：测试 spy、或消费方应对特定 bundler 的 worker 解析差异。
   */
  workerFactory?: () => Worker;
}

interface InflightEntry {
  resolve: (result: ParseResult) => void;
  reject: (reason: Error) => void;
  userId: string;
  workerIndex: number;
}

function abortError(message: string): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

function defaultWorkerFactory(): Worker {
  return new Worker(new URL('./markdown.worker.ts', import.meta.url), {
    type: 'module',
  });
}

/**
 * Markdown 解析的主线程客户端（RFC §2.1.8）。
 *
 * - **Worker 池**：poolSize 个 worker，round-robin 分发。
 * - **coalesce**：同 id 的新请求自动取消尚未完成的旧请求（流式场景避免堆积过时解析）。
 * - **Transferable**：source 以 UTF-8 ArrayBuffer 转移给 worker，省去大文本结构化克隆。
 * - **降级**：无 `Worker`（SSR / 旧环境）或 worker 创建失败时，主线程动态加载解析器同步解析，
 *   API 表面不变；`isFallback()` 为 true。降级用动态 import 让 marked 仅在需要时才进主线程。
 * - **健壮性**：worker 崩溃时拒绝其在飞请求并重建该 worker；dispose 拒绝全部并终止。
 *
 * 关联用内部自增 `seq`；worker 无状态只回显 seq，cancel/coalesce 全在此侧处理。
 */
export class MarkdownWorkerClient {
  private readonly poolSize: number;
  private readonly coalesce: boolean;
  private readonly factory: () => Worker;

  private pool: Worker[] = [];
  private fallback = false;
  private disposed = false;

  private seqCounter = 0;
  private nextWorker = 0;
  private readonly inflight = new Map<number, InflightEntry>();
  private readonly byUserId = new Map<string, number>();

  constructor(options: MarkdownWorkerOptions = {}) {
    this.poolSize = Math.max(1, options.poolSize ?? 1);
    this.coalesce = options.coalesce ?? true;
    this.factory = options.workerFactory ?? defaultWorkerFactory;

    if (typeof Worker === 'undefined') {
      this.fallback = true;
      return;
    }
    try {
      for (let i = 0; i < this.poolSize; i += 1) {
        this.pool.push(this.spawnWorker(i));
      }
    } catch {
      // worker 构建失败（如 CSP 限制）→ 整体降级到主线程
      this.terminatePool();
      this.fallback = true;
    }
  }

  /** 是否处于主线程降级模式（无可用 Worker）。 */
  isFallback(): boolean {
    return this.fallback;
  }

  /** 解析一段 markdown。返回 { id, html, meta }。 */
  parse(request: ParseRequest): Promise<ParseResult> {
    if (this.disposed) {
      return Promise.reject(new Error('MarkdownWorkerClient is disposed'));
    }
    if (this.fallback) {
      return this.parseOnMainThread(request);
    }

    if (this.coalesce) {
      this.cancel(request.id); // 取消同 id 的在飞请求
    }

    const seq = (this.seqCounter += 1);
    const workerIndex = this.nextWorker;
    this.nextWorker = (this.nextWorker + 1) % this.pool.length;

    const promise = new Promise<ParseResult>((resolve, reject) => {
      this.inflight.set(seq, {
        resolve,
        reject,
        userId: request.id,
        workerIndex,
      });
    });
    this.byUserId.set(request.id, seq);

    this.pool[workerIndex].postMessage({
      kind: 'parse',
      seq,
      source: request.source,
      options: request.options,
    });

    return promise;
  }

  /** 取消某 id 尚未完成的请求（promise 以 AbortError reject）。 */
  cancel(id: string): void {
    const seq = this.byUserId.get(id);
    if (seq === undefined) return;
    const entry = this.inflight.get(seq);
    if (entry) {
      this.inflight.delete(seq);
      entry.reject(abortError(`parse "${id}" was cancelled`));
    }
    this.byUserId.delete(id);
  }

  /** 释放：拒绝全部在飞请求并终止所有 worker。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.inflight.values()) {
      entry.reject(new Error('MarkdownWorkerClient is disposed'));
    }
    this.inflight.clear();
    this.byUserId.clear();
    this.terminatePool();
  }

  // ─── 内部 ───

  private async parseOnMainThread(
    request: ParseRequest,
  ): Promise<ParseResult> {
    // 动态加载，避免 marked 进入主 bundle（仅降级路径需要）
    const { parseMarkdown } = await import('./markdownParser');
    const { html, meta } = parseMarkdown(request.source, request.options);
    return { id: request.id, html, meta };
  }

  private spawnWorker(index: number): Worker {
    const worker = this.factory();
    worker.onmessage = (event: MessageEvent<WorkerResponse>) =>
      this.handleResponse(event.data);
    worker.onerror = (event) => this.handleWorkerError(index, event);
    return worker;
  }

  private handleResponse(res: WorkerResponse): void {
    const entry = this.inflight.get(res.seq);
    if (!entry) return; // 已被 cancel / coalesce，忽略过时结果
    this.inflight.delete(res.seq);
    if (this.byUserId.get(entry.userId) === res.seq) {
      this.byUserId.delete(entry.userId);
    }
    if (res.kind === 'result') {
      entry.resolve({ id: entry.userId, html: res.html, meta: res.meta });
    } else {
      entry.reject(new Error(res.message));
    }
  }

  private handleWorkerError(index: number, event: unknown): void {
    if (this.disposed) return;
    const reason =
      event instanceof ErrorEvent && event.message
        ? new Error(event.message)
        : new Error('markdown worker crashed');

    // 仅拒绝该 worker 上的在飞请求，其余不受影响
    for (const [seq, entry] of this.inflight) {
      if (entry.workerIndex !== index) continue;
      this.inflight.delete(seq);
      if (this.byUserId.get(entry.userId) === seq) {
        this.byUserId.delete(entry.userId);
      }
      entry.reject(reason);
    }

    // 重建该 worker，保持池容量；重建失败则整体降级
    try {
      this.pool[index]?.terminate();
      this.pool[index] = this.spawnWorker(index);
    } catch {
      this.terminatePool();
      this.fallback = true;
    }
  }

  private terminatePool(): void {
    for (const worker of this.pool) {
      try {
        worker.terminate();
      } catch {
        // 终止失败忽略
      }
    }
    this.pool = [];
  }
}
