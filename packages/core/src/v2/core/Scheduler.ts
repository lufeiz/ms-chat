import { isDevMode } from './devMode';
import { IS_DEV } from './env';

/**
 * Microtask 批处理调度器（RFC §2.1.3）。
 *
 * 把一个同步突发里的多次 `schedule(fn)` 合并到下一个 microtask 执行一次（按 fn 去重）。
 * 典型用途：流式高频 mutate 时，把每次 mutate 的 `changed` 通知合并成一帧一次，
 * 避免订阅方逐条 re-render（修 P4）。
 *
 * 语义：
 * - 同一 fn 引用在一个 microtask 窗口内多次 schedule，只执行一次（务必传**稳定引用**）。
 * - `flush()` 立即同步执行挂起任务（队列在执行前清空，flush 期间新 schedule 进入下一轮）。
 * - `clear()` 取消挂起任务（不执行）。
 * - 单个 fn 抛错被隔离，不影响同批其余 fn。
 */
export class Scheduler {
  private queue = new Set<() => void>();
  private scheduled = false;

  /** 排入下一个 microtask 执行；同一 fn 去重。 */
  schedule(fn: () => void): void {
    this.queue.add(fn);
    if (!this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => this.flush());
    }
  }

  /** 立即同步执行全部挂起任务。 */
  flush(): void {
    if (this.queue.size === 0) {
      this.scheduled = false;
      return;
    }
    // 先快照并清空：flush 期间 fn 内部新的 schedule 进入下一轮，避免本轮无限增长。
    const batch = [...this.queue];
    this.queue.clear();
    this.scheduled = false;
    for (const fn of batch) {
      try {
        fn();
      } catch (err) {
        if (IS_DEV && isDevMode()) {
          console.error('[ms-chat/core] scheduled task threw:', err);
        }
      }
    }
  }

  /** 取消全部挂起任务（不执行）。 */
  clear(): void {
    this.queue.clear();
    this.scheduled = false;
  }

  /** 是否有挂起任务。 */
  get pending(): boolean {
    return this.queue.size > 0;
  }
}
