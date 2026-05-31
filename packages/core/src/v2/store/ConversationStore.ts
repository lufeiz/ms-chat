import type { Conversation } from '../../model';
import { devWarn } from '../core/devMode';
import { BaseListStore } from './BaseListStore';

export type ConversationStoreEvents = {
  'conversation:add': [conversation: Conversation];
  'conversation:remove': [id: string];
  'conversation:update': [id: string, updates: Partial<Conversation>];
  'conversation:init': [];
  'conversation:current': [current: Conversation | null];
};

/**
 * 会话列表 store v2。引用稳定、写时复制；当前会话独立维护并发 `conversation:current`。
 * 读操作不 emit（修 H9）。
 */
export class ConversationStore extends BaseListStore<
  Conversation,
  ConversationStoreEvents
> {
  private current: Conversation | null = null;

  add(conversation: Conversation): boolean {
    if (
      this.list.some((c) => c.conversationId === conversation.conversationId)
    ) {
      devWarn(
        false,
        `conversation "${conversation.conversationId}" already exists`,
      );
      return false;
    }
    this.setList([...this.list, conversation]);
    this.emit('conversation:add', conversation);
    this.emitChanged();
    return true;
  }

  remove(conversationId: string): boolean {
    const next = this.list.filter(
      (c) => c.conversationId !== conversationId,
    );
    if (next.length === this.list.length) return false;
    this.setList(next);
    if (this.current?.conversationId === conversationId) {
      this.current = null;
      this.emit('conversation:current', null);
    }
    this.emit('conversation:remove', conversationId);
    this.emitChanged();
    return true;
  }

  update(conversationId: string, updates: Partial<Conversation>): boolean {
    const idx = this.list.findIndex(
      (c) => c.conversationId === conversationId,
    );
    if (idx === -1) return false;
    const next = this.list.slice();
    next[idx] = { ...next[idx], ...updates };
    this.setList(next);
    if (this.current?.conversationId === conversationId) {
      this.current = next[idx];
      this.emit('conversation:current', this.current);
    }
    this.emit('conversation:update', conversationId, { ...updates });
    this.emitChanged();
    return true;
  }

  get(conversationId: string): Conversation | undefined {
    return this.list.find((c) => c.conversationId === conversationId);
  }

  getByStatus(status: number): Conversation[] {
    return this.list.filter((c) => c.status === status);
  }

  getCurrent(): Conversation | null {
    return this.current;
  }

  setCurrent(conversationId: string): void {
    this.current =
      this.list.find((c) => c.conversationId === conversationId) ?? null;
    this.emit('conversation:current', this.current);
  }

  init(conversations: ReadonlyArray<Conversation> = []): void {
    const hadCurrent = this.current !== null;
    this.setList(conversations);
    this.current = null;
    // 与 remove/update 一致：重置清空了当前会话时，通知 conversation:current 订阅者
    if (hadCurrent) this.emit('conversation:current', null);
    this.emit('conversation:init');
    this.emitChanged();
  }
}
