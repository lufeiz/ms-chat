
type EventHandler = (...args: any[]) => void;

/**
 * @deprecated since 1.0.0 — 使用 `@ms-chat/core/v2` 的 `EventEmitter`。
 * v2 版本提供错误隔离、可取消的 once、快照式 emit、类型化 EventMap 与监听器泄漏告警。
 * 本类将在 2.0.0 移除。迁移指南：docs/migration-v1-to-v2.md。
 */
export class EventEmitter {
  private events: Map<string, EventHandler[]> = new Map();

  on(eventName: string, handler: EventHandler): void {
    const handlers = this.events.get(eventName) || [];
    handlers.push(handler);
    this.events.set(eventName, handlers);
  }

  off(eventName: string, handler?: EventHandler): void {
    if (!handler) {
      this.events.delete(eventName);
      return;
    }
    
    const handlers = this.events.get(eventName);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  emit(eventName: string, ...args: any[]): void {
    const handlers = this.events.get(eventName);
    if (handlers) {
      handlers.forEach(handler => handler(...args));
    }
  }

  once(eventName: string, handler: EventHandler): void {
    const wrapper = (...args: any[]) => {
      handler(...args);
      this.off(eventName, wrapper);
    };
    this.on(eventName, wrapper);
  }
}

// export default EventEmitter;
