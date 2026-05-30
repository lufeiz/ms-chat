import { EventEmitter, type EmitterOptions } from '../core/EventEmitter';

export interface StatefulManagerOptions extends EmitterOptions {
  /** 时间源，便于测试注入。默认 Date.now。 */
  now?: () => number;
  /** id 生成器，便于测试注入确定值。 */
  idGenerator?: () => string;
}

function defaultIdGenerator(): string {
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 有状态管理器基类（RFC §2.1.2 抽象 E2）。
 *
 * 把 v1 的 CardConversationManager / CommandToolboxManager 各自重复实现的
 * **定时器管理**、**now/id 注入**、**destroy 清理** 抽到一处：
 * - `schedule()` 注册的定时器在 destroy / clearAllTimers 时统一清除，杜绝泄漏。
 * - `now` / `generateId` 可注入，动画与 id 在测试里可确定化。
 *
 * 子类继续叠加各自的状态机（动画相位等）与引用稳定的快照 getter。
 */
export abstract class BaseStatefulManager<
  Events extends Record<string, any[]>,
> extends EventEmitter<Events> {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  protected readonly now: () => number;
  protected readonly generateId: () => string;

  constructor(options: StatefulManagerOptions = {}) {
    super(options);
    this.now = options.now ?? (() => Date.now());
    this.generateId = options.idGenerator ?? defaultIdGenerator;
  }

  /** 注册一个一次性定时器；触发后自动从集合移除。destroy/clearAllTimers 会统一清理未触发的。 */
  protected schedule(
    fn: () => void,
    delay: number,
  ): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, delay);
    this.timers.add(timer);
    return timer;
  }

  protected clearTimer(timer: ReturnType<typeof setTimeout>): void {
    clearTimeout(timer);
    this.timers.delete(timer);
  }

  protected clearAllTimers(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
  }

  /** 当前未触发的定时器数（测试 / 调试用）。 */
  get pendingTimers(): number {
    return this.timers.size;
  }

  /** 清理所有定时器与监听。子类可 override 并调用 super.destroy()。 */
  destroy(): void {
    this.clearAllTimers();
    this.removeAllListeners();
  }
}
