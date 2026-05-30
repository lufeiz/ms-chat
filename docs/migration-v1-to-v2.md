# 迁移指南：v1 → v2

> 适用：`@ms-chat/core` 0.0.x → 1.0.0
> 状态：随 Phase 1–3 持续补充

## 总览

v2 是 `@ms-chat/core` 的重构版 API，以**子路径**独立导出，**与 v1 双轨并存**：

```ts
// v1（默认入口，继续可用，已标 @deprecated 的部分会显示删除线）
import { EventSourceService } from '@ms-chat/core';

// v2（新代码用）
import { SSEClient } from '@ms-chat/core/v2';
```

- v1 全部保留，**不破坏**现有代码；已有 v2 替代的 API 标记 `@deprecated`，计划在 **2.0.0** 移除。
- v2 走 `@ms-chat/core/v2` subpath，按需引入、独立 tree-shaking，不影响 v1 体积。
- 贯穿原则「引用稳定语义」「devMode 校验」等见 [refactor-rfc.md](./refactor-rfc.md)。

## 迁移状态

| v1 | v2 | 状态 | PR |
|---|---|---|---|
| `EventEmitter`（event/） | `EventEmitter`（v2/core） | ✅ 可迁移 | #2 |
| `EventSourceService`（api/） | `SSEClient`（v2/transport） | ✅ 可迁移 | #3 |
| `PluginSystem` / `createWrappedFunction`（store/） | 同名（v2/plugin） | ✅ 可迁移 | #6 |
| `ChatStore` / 各子 Store | v2 Store（组合子 store） | ✅ 可迁移 | #7 |
| `registryMessageType`（全局） | `ComponentRegistry`（实例） | ✅ 可迁移 | #7 |
| `CardConversationManager` / `CommandToolboxManager` | 继承 BaseStatefulManager | ✅ 可迁移 | #7 |
| `ThemeManager` | v2 ThemeManager（继承 EventEmitter） | ⏳ Phase 3 | — |

> 未列「可迁移」的 v1 API **暂不要** deprecate / 迁移——其 v2 版本尚未就绪。

---

## EventEmitter

```ts
// ── v1 ──
import { EventEmitter } from '@ms-chat/core';
const ee = new EventEmitter();
ee.on('change', handler);
ee.off('change', handler);

// ── v2 ──
import { EventEmitter } from '@ms-chat/core/v2';
const ee = new EventEmitter<{ change: [next: Foo] }>(); // 类型化事件
const dispose = ee.on('change', handler);   // 返回 disposer
dispose();                                   // 取消订阅，无需持有 handler 引用
```

变化点：

- 构造可传 `{ stopOnError, onError, maxListeners }`。默认**错误隔离**：一个 handler 抛错不再中断其余 handler（经 `onError(err, eventName)` 透出）。
- `on` / `once` 返回 disposer；`off(event, originalHandler)` 也能移除用 `once` 注册的监听。
- `emit` 内部对监听器快照后再迭代——handler 内部 `off` 不会影响同轮派发。
- 新增 `listenerCount` / `removeAllListeners`；DEV 下监听器数超 `maxListeners` 告警。

---

## EventSourceService → SSEClient

```ts
// ── v1 ──
import { EventSourceService } from '@ms-chat/core';
const sse = new EventSourceService<{ message: string }>();
await sse.connect(
  { url: '/stream/chat', method: 'POST', body: { query }, openWhenHidden: false },
  { onMessage: (data) => {/* ... */}, onClose: () => {} },
);
sse.disconnect();
// ⚠️ 不能再次 sse.connect()，AbortController 已 abort，必须 new 一个

// ── v2 ──
import { SSEClient } from '@ms-chat/core/v2';
const sse = new SSEClient<{ message: string }>();
await sse.connect(
  {
    url: '/stream/chat',
    method: 'POST',
    body: { query },
    reconnect: { enabled: true, backoff: [500, 1000, 2000], maxRetries: 3 },
  },
  {
    onMessage: (data, raw) => {/* ... */},
    onReconnect: (attempt) => console.warn('reconnecting', attempt),
    onError: (err, retryCount) => {/* 重连耗尽 */},
    onClose: () => {},
  },
);
sse.disconnect();
await sse.connect(/* ... */);   // ✅ 同实例可复用
```

变化点：

- **可复用**：每次 `connect()` 内部新建 AbortController，`disconnect()` 后可再次 `connect()`。
- **重连退避**：`reconnect.enabled` 开启后按 `backoff[]` 重试到 `maxRetries`，每次回调 `onReconnect(attempt)`；耗尽后 `onError(err, retryCount)` 并 reject。正常结束（服务端关流）不会重连。
- **请求语义修正**：GET 不带 body；POST 空 body 不再发字符串 `"undefined"`。
- `onMessage(data, raw)` 的 `raw` 是 `EventSourceMessage`（含 id/event/data）。
- `strictJSON`（默认 true）：坏 chunk 丢弃；设 false 则把 raw 字符串透传。
- `headers` 可传函数，每次 connect 重新求值（适合 token 刷新）。

---

## PluginSystem

```ts
// ── v1 ──
import { PluginSystem, createWrappedFunction } from '@ms-chat/core';
const ps = new PluginSystem();
ps.register({ targetFunction: 'addMessage', hookType: 'before', handler });
// ⚠️ 无法卸载

// ── v2 ──
import { PluginSystem, createWrappedFunction } from '@ms-chat/core/v2';
const ps = new PluginSystem();
const dispose = ps.register({ targetFunction: 'addMessage', hookType: 'before', handler });
dispose();                       // 或 ps.unregister(id) / ps.unregisterAll('addMessage')
```

变化点：

- 流水线 `before → transform → fn → after`，错误跳 `error`。
- **可卸载**：`register()` 返回 disposer；新增 `unregister(id)` / `unregisterAll(targetFunction?)` / `list()`。
- **transform 钩子**：返回 `{ args }` 改写下游参数；返回 `{ result }` 短路原函数。
- **before 短路**：返回 `false` 跳过原函数（wrapped 调用 resolve 为 `false`）。
- DEV 下 `register()` 校验 hookType 拼写与 handler 类型。

---

## ChatStore / 状态层

```ts
// ── v1 ──
import { ChatStore } from '@ms-chat/core';
const store = new ChatStore(config);
store.addMessage(msg);                 // 45 个扁平委派方法
store.getAllMessages();                // 每次返回新数组
import { registryMessageType } from '@ms-chat/core';
registryMessageType('text', TextCard); // ⚠️ 全局，多实例互相污染

// ── v2 ──
import { ChatStore } from '@ms-chat/core/v2';
const store = new ChatStore({ config });
store.messages.add(msg);               // 直接用子 store，全类型化
store.messages.getSnapshot();          // { version, data }，引用稳定
store.registry.register('text', TextCard); // 实例级，互不污染（修 E1）
```

变化点：

- 子 store 暴露为只读属性：`store.messages` / `store.conversations` / `store.msgInput` / `store.config` / `store.registry`。
- 列表 store 继承 BaseListStore，`getSnapshot()` 引用稳定，订阅 `changed` 事件。
- `remove` 未命中不再 emit（修 H6）；读操作不 emit（修 H9）。
- 消息组件注册表从全局 `registryMessageType` 改为 `store.registry`（实例级）。

React 桥接示例见 `packages/react/demo/v2`（`useMessages` 用 `changed` + disposer 清理）。

## Managers（CardConversation / CommandToolbox）

```ts
// ── v1 ──
import { CardConversationManager } from '@ms-chat/core';
// ── v2 ──
import { CardConversationManager } from '@ms-chat/core/v2';
```

变化点：

- 两者现继承 `BaseStatefulManager`，定时器统一托管——`destroy()` / `reset()` 不再漏清。
- `getMessages()` / `getContext()`（Card）、`getState()`（CommandToolbox）引用稳定，去掉 v1 每次调用的浅克隆（修 P2/P5）。
- `CommandToolboxManager.register()` 返回 disposer。
- 事件名改为命名空间式（如 `card:add` / `toolbox:filter`），不再用 v1 的 enum 常量。

## devMode（v2 通用）

v2 引入 `__DEV__` 死代码消除层：开发期做契约校验（throw/warn），生产构建零开销。
测试可用 `setDevMode(boolean)` 强制切换。详见 [refactor-rfc.md §2.1.9](./refactor-rfc.md)。
