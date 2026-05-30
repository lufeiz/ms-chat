import { useEffect, useState } from 'react';
import type { ChatStore, Snapshot } from '@ms-chat/core/v2';
import type { Message } from '@ms-chat/core';

/**
 * 把 v2 MessageStore 的引用稳定快照桥接到 React 状态。
 *
 * - 订阅 `changed`，事件携带引用稳定的 `Snapshot`；快照在无变更时 `===` 相等，
 *   React 可据此天然跳过无意义的子树 diff。
 * - `store.messages.on('changed', ...)` 返回 disposer，直接作为 effect 的清理函数——
 *   这是 v2 EventEmitter 相比 v1 的实用改进。
 */
export function useMessages(store: ChatStore): Snapshot<Message> {
  const [snapshot, setSnapshot] = useState<Snapshot<Message>>(() =>
    store.messages.getSnapshot(),
  );

  useEffect(() => {
    const dispose = store.messages.on('changed', setSnapshot);
    // 同步一次初值，避免订阅建立前发生的更新被漏掉
    setSnapshot(store.messages.getSnapshot());
    return dispose;
  }, [store]);

  return snapshot;
}
