import { isDevMode } from './devMode';
import { IS_DEV } from './env';

/** 取消订阅 / 注销 / 移除监听的无参函数。 */
export type Disposer = () => void;

/** 监听器函数。 */
export type Listener = (...args: any[]) => void;

export interface EmitterOptions {
  /** handler 抛错是否打断后续 handler。默认 false（错误隔离）。 */
  stopOnError?: boolean;
  /** 全局错误回调；任一 handler 抛错都会经过这里。 */
  onError?: (err: unknown, eventName: string) => void;
  /** 单事件监听器上限，超过在 DEV 下 warn（仅一次）。默认 100。 */
  maxListeners?: number;
}

interface ListenerEntry {
  /** 实际被调用的函数（once 时是 wrapper）。 */
  fn: Listener;
  /** 注册时用户传入的原始 handler，用于 off(event, original) 命中。 */
  original: Listener;
  once: boolean;
}

const DEFAULT_MAX_LISTENERS = 100;

/**
 * 类型化事件发射器（RFC §2.1.1）。
 *
 * 相比 v1 的改进：
 * - **错误隔离**：单个 handler 抛错不影响后续 handler（修 H4）。
 * - **快照迭代**：emit 时先 slice，handler 内部 off 不会扰乱本次派发（修 H4）。
 * - **可取消 once**：on/once 都返回 disposer；off(event, original) 也能移除 once（修 H5）。
 * - **类型安全**：EventMap 约束事件名与参数元组。
 * - **泄漏检测**：DEV 下超过 maxListeners 告警。
 *
 * @typeParam EventMap 事件名到参数元组的映射，如 `{ change: [next: Foo]; close: [] }`。
 */
export class EventEmitter<
  EventMap extends Record<string, any[]> = Record<string, any[]>,
> {
  private events = new Map<keyof EventMap, ListenerEntry[]>();
  private warnedEvents = new Set<keyof EventMap>();
  private readonly stopOnError: boolean;
  private readonly onError?: (err: unknown, eventName: string) => void;
  private readonly maxListeners: number;

  constructor(options: EmitterOptions = {}) {
    this.stopOnError = options.stopOnError ?? false;
    this.onError = options.onError;
    this.maxListeners = options.maxListeners ?? DEFAULT_MAX_LISTENERS;
  }

  /** 订阅事件，返回可取消订阅的 disposer。 */
  on<K extends keyof EventMap>(
    event: K,
    handler: (...args: EventMap[K]) => void,
  ): Disposer {
    return this.addListener(event, handler as Listener, false);
  }

  /** 订阅一次性事件，触发后自动移除；返回的 disposer 可在触发前取消。 */
  once<K extends keyof EventMap>(
    event: K,
    handler: (...args: EventMap[K]) => void,
  ): Disposer {
    const original = handler as Listener;
    const wrapper: Listener = (...args: any[]) => {
      // 先移除再调用：避免 handler 内部再次 emit 同事件造成重复触发。
      this.removeEntry(event, wrapper);
      original(...args);
    };
    return this.addListener(event, wrapper, true, original);
  }

  /**
   * 移除监听。
   * - 省略 handler：清空该事件全部监听。
   * - 传 handler：移除以该 handler 注册的监听（含通过 once 注册的）。
   */
  off<K extends keyof EventMap>(event: K, handler?: Listener): void {
    if (!handler) {
      this.events.delete(event);
      return;
    }
    const entries = this.events.get(event);
    if (!entries) return;
    const next = entries.filter(
      (e) => e.original !== handler && e.fn !== handler,
    );
    if (next.length > 0) {
      this.events.set(event, next);
    } else {
      this.events.delete(event);
    }
  }

  /** 派发事件。handler 抛错被隔离（除非 stopOnError）。 */
  emit<K extends keyof EventMap>(event: K, ...args: EventMap[K]): void {
    const entries = this.events.get(event);
    if (!entries || entries.length === 0) return;

    // 快照：本次派发不受 handler 内部增删监听的影响。
    const snapshot = entries.slice();
    for (const entry of snapshot) {
      try {
        entry.fn(...args);
      } catch (err) {
        if (this.onError) {
          this.onError(err, String(event));
        }
        if (this.stopOnError) {
          throw err;
        }
        if (IS_DEV && isDevMode() && !this.onError) {
          // 无 onError 时在 DEV 暴露被吞掉的异常，避免静默失败。PROD 下整段被 DCE。
          console.error(
            `[ms-chat/core] listener for "${String(event)}" threw:`,
            err,
          );
        }
      }
    }
  }

  /** 指定事件的监听器数量。 */
  listenerCount(event: keyof EventMap): number {
    return this.events.get(event)?.length ?? 0;
  }

  /** 移除全部监听；省略 event 则清空所有事件。 */
  removeAllListeners(event?: keyof EventMap): void {
    if (event === undefined) {
      this.events.clear();
      this.warnedEvents.clear();
    } else {
      this.events.delete(event);
      this.warnedEvents.delete(event);
    }
  }

  private addListener(
    event: keyof EventMap,
    fn: Listener,
    once: boolean,
    original?: Listener,
  ): Disposer {
    const entries = this.events.get(event) ?? [];
    entries.push({ fn, original: original ?? fn, once });
    this.events.set(event, entries);

    // IS_DEV 守卫使整段泄漏检测在 PROD 构建被 DCE（连同字符串字面量），
    // 测试期 IS_DEV=true 时再由 isDevMode() 提供 dev/prod 运行时切换。
    if (
      IS_DEV &&
      isDevMode() &&
      entries.length > this.maxListeners &&
      !this.warnedEvents.has(event)
    ) {
      this.warnedEvents.add(event);
      console.warn(
        `[ms-chat/core] event "${String(event)}" has ${entries.length} listeners ` +
          `(exceeds maxListeners=${this.maxListeners}); possible memory leak. ` +
          `Use the disposer returned by on()/once() or removeAllListeners().`,
      );
    }

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this.removeEntry(event, fn);
    };
  }

  private removeEntry(event: keyof EventMap, fn: Listener): void {
    const entries = this.events.get(event);
    if (!entries) return;
    const idx = entries.findIndex((e) => e.fn === fn);
    if (idx >= 0) {
      entries.splice(idx, 1);
      if (entries.length === 0) {
        this.events.delete(event);
      }
    }
  }
}
