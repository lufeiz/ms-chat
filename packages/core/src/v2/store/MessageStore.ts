import type { Message } from '../../model';
import { BaseListStore } from './BaseListStore';

export type MessageStoreEvents = {
  'message:add': [message: Message];
  'message:addMany': [messages: Message[]];
  'message:update': [id: string, updates: Partial<Message>];
  'message:remove': [id: string];
  'message:init': [];
};

/**
 * 消息列表 store v2。引用稳定（getSnapshot）、写时复制；修正 v1 的 emit 时机：
 * - `remove` / `removeWhere` 仅在**确实删除**时 emit（修 H6）。
 * - 读操作（get/getByType/getLatest）**不** emit（修 H9）。
 */
export class MessageStore extends BaseListStore<Message, MessageStoreEvents> {
  add(message: Message): void {
    this.setList([...this.list, message]);
    this.emit('message:add', message);
    this.emitChanged();
  }

  addMany(messages: Message[]): void {
    if (messages.length === 0) return;
    this.setList([...this.list, ...messages]);
    this.emit('message:addMany', messages);
    this.emitChanged();
  }

  update(id: string, updates: Partial<Message>): boolean {
    // 流式热路径优化：流式输出几乎总是更新最后一条消息，先查尾部，
    // 命中则免去整表 findIndex（高频 token 更新下从 O(n) 降到 O(1) 定位）。
    const lastIdx = this.list.length - 1;
    const idx =
      lastIdx >= 0 && this.list[lastIdx].id === id
        ? lastIdx
        : this.list.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    const next = this.list.slice();
    next[idx] = { ...next[idx], ...updates } as Message;
    this.setList(next);
    this.emit('message:update', id, { ...updates });
    this.emitChanged();
    return true;
  }

  remove(id: string): boolean {
    const next = this.list.filter((m) => m.id !== id);
    if (next.length === this.list.length) return false; // 未命中：不 emit（修 H6）
    this.setList(next);
    this.emit('message:remove', id);
    this.emitChanged();
    return true;
  }

  removeWhere(predicate: (m: Message) => boolean): number {
    const next = this.list.filter((m) => !predicate(m));
    const removed = this.list.length - next.length;
    if (removed === 0) return 0;
    this.setList(next);
    this.emitChanged();
    return removed;
  }

  get(id: string): Message | undefined {
    return this.list.find((m) => m.id === id);
  }

  getByType<R extends Message>(guard: (m: Message) => m is R): R[] {
    return this.list.filter(guard) as R[];
  }

  getLatest(count: number): ReadonlyArray<Message> {
    return count <= 0 ? [] : this.list.slice(-count);
  }

  init(messages: ReadonlyArray<Message> = []): void {
    this.setList(messages);
    this.emit('message:init');
    this.emitChanged();
  }
}
