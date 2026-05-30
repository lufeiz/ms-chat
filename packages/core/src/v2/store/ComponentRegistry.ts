import type { Disposer } from '../core/EventEmitter';
import { devWarn } from '../core/devMode';

/**
 * 消息组件注册表（RFC §2.1.6），替代 v1 模块级全局 `registryMessageType`（修 E1）。
 *
 * 实例化后由 ChatStore 持有，UI 层从 store 注入消费——多个 ChatStore 实例互不污染，
 * 可做沙箱 / SSR 安全。
 *
 * @typeParam TComp 组件类型（React 组件、Vue 组件等，core 不关心具体形态）。
 */
export class ComponentRegistry<TComp = unknown> {
  private map = new Map<string, TComp>();

  /** 注册一个消息类型对应的组件，返回可注销的 disposer。 */
  register(type: string, component: TComp): Disposer {
    devWarn(
      !this.map.has(type),
      `component type "${type}" is being overwritten`,
    );
    this.map.set(type, component);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      // 仅当当前仍是本次注册的组件时才删除，避免误删后来者。
      if (this.map.get(type) === component) {
        this.map.delete(type);
      }
    };
  }

  get(type: string): TComp | undefined {
    return this.map.get(type);
  }

  has(type: string): boolean {
    return this.map.has(type);
  }

  unregister(type: string): boolean {
    return this.map.delete(type);
  }

  clear(): void {
    this.map.clear();
  }

  list(): string[] {
    return [...this.map.keys()];
  }

  get size(): number {
    return this.map.size;
  }
}
