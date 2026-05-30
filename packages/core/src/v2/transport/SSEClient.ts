import {
  EventStreamContentType,
  fetchEventSource,
  type EventSourceMessage,
} from '@microsoft/fetch-event-source';
import { devWarn } from '../core/devMode';

/** 重连退避配置。 */
export interface ReconnectOptions {
  enabled: boolean;
  /** 指数退避间隔（ms）。第 n 次重试取 backoff[min(n-1, len-1)]。默认 [500,1000,2000,5000]。 */
  backoff?: number[];
  /** 最大重试次数，超过则 onError 并 reject。默认 4。 */
  maxRetries?: number;
}

export interface SSEClientOptions {
  url: string;
  method?: 'GET' | 'POST';
  /** 静态对象或函数；函数形式每次 connect 重新求值（鉴权 token 刷新场景）。 */
  headers?: Record<string, string> | (() => Record<string, string>);
  /** 仅 POST 时序列化进 body；GET 不带 body。 */
  body?: unknown;
  credentials?: RequestCredentials;
  /** 页面隐藏时是否保持连接。默认 false。 */
  openWhenHidden?: boolean;
  reconnect?: ReconnectOptions;
  /** JSON 解析失败时：true=丢弃该 chunk（默认）；false=把 raw 字符串透传给 onMessage。 */
  strictJSON?: boolean;
}

export interface SSEHandlers<T> {
  onOpen?: (response: Response) => void | Promise<void>;
  onMessage: (data: T, raw: EventSourceMessage) => void;
  /** 重连耗尽 / 致命错误时调用（手动 disconnect 不触发）。 */
  onError?: (err: Error, retryCount: number) => void;
  onClose?: () => void;
  /** 每次发起重连时调用，attempt 从 1 开始。 */
  onReconnect?: (attempt: number) => void;
}

const DEFAULT_BACKOFF = [500, 1000, 2000, 5000];
const DEFAULT_MAX_RETRIES = 4;

/**
 * SSE 客户端（RFC §2.1.2），替代 v1 的 `EventSourceService`。
 *
 * 相比 v1 的改进：
 * - **可复用**：每次 connect() 新建 AbortController，disconnect() 后可再次 connect()（修 H1）。
 * - **重连退避**：error / 非 2xx / content-type 不符时按 backoff 重试，超过 maxRetries 才 reject（修 H2）。
 * - **请求语义修正**：GET 不带 body；POST 空 body 不发 `"undefined"`（修 H3）。
 * - **解析容错**：strictJSON 控制坏 chunk 丢弃或 raw 透传。
 * - **动态 headers**：headers 为函数时每次 connect 重新求值。
 *
 * 正常结束（服务端关闭流）→ onClose → connect() resolve，不会重连；
 * 仅在错误路径上重连（底层 fetchEventSource 的语义）。
 */
export class SSEClient<T = unknown> {
  private abortController: AbortController = new AbortController();
  private active = false;

  /** 当前是否有活跃连接（含重连等待中）。 */
  isActive(): boolean {
    return this.active;
  }

  /** 中断当前连接；不会触发 onError。 */
  disconnect(): void {
    if (this.active) {
      this.abortController.abort();
      this.active = false;
    }
  }

  async connect(
    options: SSEClientOptions,
    handlers: SSEHandlers<T>,
  ): Promise<void> {
    // 每次连接新建 controller，使实例可复用（修 H1）。
    this.abortController = new AbortController();
    this.active = true;

    const method = options.method ?? 'POST';
    const strictJSON = options.strictJSON ?? true;
    const reconnectEnabled = options.reconnect?.enabled ?? false;
    const backoff = options.reconnect?.backoff ?? DEFAULT_BACKOFF;
    const maxRetries = options.reconnect?.maxRetries ?? DEFAULT_MAX_RETRIES;

    const headers =
      typeof options.headers === 'function'
        ? options.headers()
        : options.headers;

    // GET 不带 body；POST 空 body 不序列化成 "undefined"（修 H3）。
    const body =
      method === 'POST' && options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined;

    let retryCount = 0;

    try {
      await fetchEventSource(options.url, {
        method,
        headers,
        body,
        credentials: options.credentials,
        signal: this.abortController.signal,
        openWhenHidden: options.openWhenHidden ?? false,

        onopen: async (response: Response) => {
          const contentType = response.headers.get('content-type');
          if (!response.ok || !contentType?.includes(EventStreamContentType)) {
            throw new Error(`Invalid SSE response: ${response.status}`);
          }
          retryCount = 0; // 成功打开后重置重试计数
          await handlers.onOpen?.(response);
        },

        onmessage: (ev: EventSourceMessage) => {
          if (!ev.data) return; // 跳过心跳 / 空行
          let data: T;
          try {
            data = JSON.parse(ev.data) as T;
          } catch {
            if (strictJSON) {
              devWarn(false, `dropped malformed SSE chunk: ${ev.data}`);
              return;
            }
            data = ev.data as unknown as T;
          }
          handlers.onMessage(data, ev);
        },

        onclose: () => {
          handlers.onClose?.();
        },

        onerror: (err: unknown) => {
          // 手动 disconnect：底层 abort 监听会 resolve，这里不再处理。
          if (this.abortController.signal.aborted) {
            throw err;
          }
          retryCount += 1;
          if (!reconnectEnabled || retryCount > maxRetries) {
            handlers.onError?.(err as Error, retryCount);
            throw err; // 致命：connect() 将 reject
          }
          handlers.onReconnect?.(retryCount);
          return backoff[Math.min(retryCount - 1, backoff.length - 1)];
        },
      });
    } catch (err) {
      // abort（手动 disconnect）静默 settle；其余（重连耗尽 / 致命）已在 onerror 调过
      // onError，这里 rethrow 让 connect() reject。
      if (
        this.abortController.signal.aborted ||
        (err as Error)?.name === 'AbortError'
      ) {
        return;
      }
      throw err;
    } finally {
      this.active = false;
    }
  }
}
