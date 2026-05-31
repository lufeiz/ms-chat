import type { ChatConfig } from '../../model';
import { ComponentRegistry } from './ComponentRegistry';
import { ConfigStore } from './ConfigStore';
import { ConversationStore } from './ConversationStore';
import { MessageStore } from './MessageStore';
import { MsgInputStore } from './MsgInputStore';

export interface ChatStoreOptions {
  config?: ChatConfig;
}

/**
 * ChatStore v2（RFC §2.1.5）。
 *
 * 设计取舍：放弃 v1 的 45 行扁平委派（每个子 store 方法手写一遍 `setX = ...`），
 * 也不用 RFC 初稿提议的 Proxy 动态委派（运行时不透明 + 类型难表达）——
 * 改为**直接把子 store 暴露为属性**，组合优于扁平化，完全类型化、零运行时魔法。
 *
 * ```ts
 * const store = new ChatStore();
 * store.messages.add(msg);
 * store.conversations.setCurrent(id);
 * store.registry.register('text', TextCard);  // 实例级，不再全局污染
 * ```
 */
export class ChatStore<TComp = unknown> {
  readonly messages = new MessageStore();
  readonly conversations = new ConversationStore();
  readonly msgInput = new MsgInputStore();
  readonly config: ConfigStore;
  /** 实例级消息组件注册表，替代 v1 全局 registryMessageType（修 E1）。 */
  readonly registry = new ComponentRegistry<TComp>();

  constructor(options: ChatStoreOptions = {}) {
    this.config = new ConfigStore(options.config ?? {});
  }

  /** 释放所有子 store 的监听、挂起的批处理任务与注册表。 */
  destroy(): void {
    // 列表型 store：destroy 会取消挂起的 changed 调度并移除监听
    this.messages.destroy();
    this.conversations.destroy();
    // 单值 store：直接移除监听
    this.msgInput.removeAllListeners();
    this.config.removeAllListeners();
    this.registry.clear();
  }
}
