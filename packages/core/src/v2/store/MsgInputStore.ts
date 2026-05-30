import { EventEmitter } from '../core/EventEmitter';
import type { MsgInput } from '../../model';
import { msgInputDefault } from '../../model';

export type MsgInputStoreEvents = {
  'msgInput:set': [value: MsgInput];
  'msgInput:init': [];
};

/**
 * 用户输入 store v2（非列表，直接继承 EventEmitter）。
 * `get()` 不 emit（修 H9）；`set` 写时复制保证引用稳定语义。
 */
export class MsgInputStore extends EventEmitter<MsgInputStoreEvents> {
  private value: MsgInput = { ...msgInputDefault };

  set(value: MsgInput): void {
    this.value = { ...value };
    this.emit('msgInput:set', this.value);
  }

  get(): MsgInput {
    return this.value;
  }

  init(): void {
    this.value = { ...msgInputDefault };
    this.emit('msgInput:init');
  }
}
