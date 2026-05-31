import { EventEmitter } from '../core/EventEmitter';
import { isDevMode } from '../core/devMode';
import { IS_DEV } from '../core/env';

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
    this.list =
      IS_DEV && isDevMode()
        ? (Object.freeze(next.slice()) as ReadonlyArray<T>)
        : next;
    this._version += 1;
    this.cachedSnapshot = null;
  }

  /** 发 `changed` 事件，携带引用稳定的新快照。 */
  protected emitChanged(): void {
    // 局部 cast：泛型 E 下 TS 无法静态证明 'changed' 映射到 [Snapshot<T>]，
    // 但运行时 emit 仅按 (name, ...args) 派发，此处安全。
    (
      this.emit as unknown as (
        event: 'changed',
        snapshot: Snapshot<T>,
      ) => void
    )('changed', this.getSnapshot());
  }

  /** 清空并可选地用新列表初始化。 */
  protected resetList(next: ReadonlyArray<T> = []): void {
    this.setList(next);
  }
}
