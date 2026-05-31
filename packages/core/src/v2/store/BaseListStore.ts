import { EventEmitter } from '../core/EventEmitter';
import { isDevMode } from '../core/devMode';
import { IS_DEV } from '../core/env';
import { Scheduler } from '../core/Scheduler';

/** 带版本号的不可变列表视图。订阅方可用引用相等（===）判断是否变化。 */
export interface Snapshot<T> {
  readonly version: number;
  readonly data: ReadonlyArray<T>;
}

/** BaseListStore 内建事件：列表任意变更后发 `changed`。 */
export type ListStoreEvents<T> = {
  changed: [snapshot: Snapshot<T>];
};

/**
 * 列表型 store 基类（RFC §2.0 引用稳定语义 / §2.1.3）。
 *
 * 核心约定：内部列表当 immutable 用，所有写操作经 `setList` 做写时复制并自增 version；
 * `getSnapshot()` 在两次变更之间返回 **同一引用**，订阅方据此用 `prev === next`
 * 做 React.memo / Vue shallowRef 短路（修 P1/P2）。
 *
 * DEV 下内部列表被 `Object.freeze`，绕过 setList 的原地修改会立即抛错（修「mutate 绕过」）。
 *
 * @typeParam T 元素类型
 * @typeParam E 子类的额外事件映射
 */
export abstract class BaseListStore<
  T,
  E extends Record<string, any[]> = Record<never, never>,
> extends EventEmitter<E & ListStoreEvents<T>> {
  protected list: ReadonlyArray<T> = [];
  private _version = 0;
  private cachedSnapshot: Snapshot<T> | null = null;
  private scheduler = new Scheduler();

  /**
   * `changed` 的实际派发函数。用稳定引用（class field）使 Scheduler 能按 fn 去重：
   * 一个 microtask 内多次 mutate → 只派发一次 changed（携带最终快照）。
   */
  private doEmitChanged = (): void => {
    (
      this.emit as unknown as (
        event: 'changed',
        snapshot: Snapshot<T>,
      ) => void
    )('changed', this.getSnapshot());
  };

  /** 当前版本号，每次变更 +1。 */
  get version(): number {
    return this._version;
  }

  /** 返回引用稳定的快照：无变更时多次调用返回同一对象。 */
  getSnapshot(): Snapshot<T> {
    if (!this.cachedSnapshot) {
      this.cachedSnapshot = { version: this._version, data: this.list };
    }
    return this.cachedSnapshot;
  }

  /** 写时复制：替换内部列表、自增版本、失效快照缓存。子类所有写操作必须走这里。 */
  protected setList(next: ReadonlyArray<T>): void {
    // 始终复制：调用方可能传入外部数组（如 init/reset 传入业务侧的列表），
    // 若直接持有其引用，调用方之后对该数组的 mutation 会绕过 version/changed
    // 改变 getSnapshot().data，破坏引用稳定契约。复制成本相对渲染可忽略。
    const copy = next.slice();
    this.list = IS_DEV && isDevMode() ? (Object.freeze(copy) as ReadonlyArray<T>) : copy;
    this._version += 1;
    this.cachedSnapshot = null;
  }

  /**
   * 调度 `changed` 事件（microtask 批处理）。同步突发里多次调用只派发一次（修 P4）。
   * 细粒度事件（如 `message:add`）由子类同步 emit，不经此路径。
   * 需要同步通知时调用 `flush()`。
   */
  protected emitChanged(): void {
    this.scheduler.schedule(this.doEmitChanged);
  }

  /** 立即同步派发挂起的 `changed`（测试 / 需要同步快照通知的场景）。 */
  flush(): void {
    this.scheduler.flush();
  }

  /** 释放：取消挂起的 `changed` 并移除所有监听（避免拆卸期向已卸载订阅方派发）。 */
  destroy(): void {
    this.scheduler.clear();
    this.removeAllListeners();
  }

  /** 清空并可选地用新列表初始化。 */
  protected resetList(next: ReadonlyArray<T> = []): void {
    this.setList(next);
  }
}
