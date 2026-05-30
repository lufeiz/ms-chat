# MS-Chat Core 重构 RFC

> 状态：**Draft**（等待 review）
> 目标版本：`@ms-chat/core@1.0.0`
> 兼容策略：**新旧双轨**，旧 API 标 `@deprecated`，至少保留一个大版本
> 写于：2026-05-26

---

## 0. TL;DR

本 RFC 不动代码，只描述：

1. **当前问题盘点**（含具体文件 + 行号 + 复现路径）
2. **重构后的目标架构**（接口签名级别）
3. **双轨迁移方案**（新 API 在 `v2/` 命名空间，旧 API 全部保留并标记 deprecated）
4. **vitest 测试矩阵**（哪个模块写哪些用例、覆盖率门槛）
5. **分阶段落地路线 + PR 拆分建议**

执行时按 **P0 → P1 → P2 → P3 → P4** 顺序，每个阶段独立 PR 可独立合并、独立发版（minor）。最终 1.0.0 GA 时把所有 `@deprecated` 的入口在下一个 major（2.0.0）合并删除。

**已定稿的关键决议**（详见 §7）：
- ✅ 继续手写 EventEmitter，不切换到 EventTarget
- ✅ 不引入 immer，BaseListStore 自己做写时复制
- ✅ Web Worker 化 markdown 解析纳入 1.0 范围（PR-10）
- ✅ ThemeManager 合并到 EventEmitter 订阅模型
- ✅ 引入 `__DEV__` 死代码消除的 devMode 校验层

**横贯全 v2 的设计原则**（§2.0）：所有 getter / snapshot / emit payload 都遵循"引用稳定语义" —— 状态不变时多次调用 `===` 相等，订阅方可用引用相等做 memo 短路。

---

## 1. 当前架构观察

```
packages/core/src/
├── api/              # SSE 封装（EventSourceService）
├── card-conversation/# 卡片对话管理器（330 行单文件）
├── command-toolbox/  # 命令面板管理器（440 行）+ 2 个裸 .js 草稿
├── event/            # EventEmitter（44 行，无错误隔离）
├── model/            # 类型定义（messages/conversation/plugin/...）
├── store/            # ChatStore + 4 个子 store + 全局 registry
├── theme/            # ThemeManager（JSON 序列化深克隆）
├── ui-interface/     # 各 UI 组件 props 类型
├── utils/            # 消息构造器
└── utils.ts          # ⚠️ 与上面 utils/ 目录冲突
```

### 1.1 红色问题（影响发布/正确性）

| # | 位置 | 问题 | 影响 |
|---|---|---|---|
| R1 | [packages/core/src/utils.ts](../packages/core/src/utils.ts) vs [packages/core/src/utils/](../packages/core/src/utils/) | 同名文件 + 同名目录共存；`index.ts` 只 export `./utils`，根目录的 `utils.ts`（debounce/shuffleArray/formatDateTime）实际**未被导出** | 调用方拿不到这三个函数；某些构建器会报模块解析歧义 |
| R2 | [packages/core/src/command-toolbox/deepClone.js](../packages/core/src/command-toolbox/deepClone.js) | 文件结尾含 `console.log` 测试代码 + `module.exports`（CJS 在 ESM 库里） | 被 `command-toolbox/index.ts` 同目录隐式拖入构建；产物含调试日志 |
| R3 | [packages/core/src/command-toolbox/retry.js](../packages/core/src/command-toolbox/retry.js) | 函数体是空的 `// code here...`，但同样在目录内 | 调用即 hang |
| R4 | [package.json:10](../package.json) | `"build": "cd ./packages/vue && npm run build"`，但目录是 `vue-next` | `pnpm build` 失败，release 流程已坏 |
| R5 | [packages/core/src/model/message.ts:13](../packages/core/src/model/message.ts) | `type: 'card' \| 'markdown' \| ... \| unknown` | `unknown` 让整个判别联合失效，所有 `if (msg.type === 'text')` 分支收窄失败 |
| R6 | [packages/core/src/model/index.ts:7](../packages/core/src/model/index.ts) | 末尾遗留乱码注释 "你好sss我号大aaaa家号啊啊啊sss" | 仅观感，但出现在公开包源码里 |
| R7 | [packages/core/src/store/base/msgInputStore.ts:23](../packages/core/src/store/base/msgInputStore.ts) | `setMsgInput` 里有 `console.log('setMsgInputsetMsgInput: 2', this.msgInput)` | 调试日志泄露，性能开销 |
| R8 | [packages/core/src/store/index.ts:52](../packages/core/src/store/index.ts) | `initConfig = <T extends keyof ChatConfig>(config: T): void` — 签名要求传 key 字符串，实际实现 [configStore.ts:12](../packages/core/src/store/base/configStore.ts) 期望整个 config 对象 | 类型与实现完全错位 |

### 1.2 健壮性问题

| # | 位置 | 问题 | 复现 |
|---|---|---|---|
| H1 | [api/eventSourceWrapper.ts:21](../packages/core/src/api/eventSourceWrapper.ts) | `AbortController` 只在构造器创建一次。`disconnect()` 后 `connect()` 立即被 aborted | `const s = new EventSourceService(); await s.connect(...); s.disconnect(); await s.connect(...)` → 第二次调用永远不会 fire onMessage |
| H2 | 同上 | 无重连、无指数退避；`onerror` 抛错后 fetchEventSource 会自动重试，但用户无控制 | 网络抖动场景下重连间隔不可调 |
| H3 | 同上 | `body: JSON.stringify(config.body)` 对 `undefined` 会序列化成 `"undefined"`；GET 请求被强加 body | GET 模式不可用 |
| H4 | [event/eventEmitter.ts:30](../packages/core/src/event/eventEmitter.ts) | `emit` 内 `handlers.forEach(handler => handler(...args))`，一个 handler 抛错则后续不执行；`emit` 内若 handler 触发 `off` 会改 array 长度导致漏 fire | 流式高频更新下偶发漏更新 |
| H5 | 同上 | `once` 用闭包包装，无法用原 handler 引用 `off` 掉 | 内存泄露隐患 |
| H6 | [store/base/messageListStore.ts:46-48](../packages/core/src/store/base/messageListStore.ts) | `deleteMessage` 不论是否真的删掉都 `emit(DELETE)`；`deleteMessages` 总 emit `predicate` 函数（不是被删的消息列表） | 订阅方收到误报；payload 语义不清 |
| H7 | [store/base/conversationsStore.ts:64](../packages/core/src/store/base/conversationsStore.ts) | `updateConversation` 直接改 `this.conversations[index]` 索引位（虽然是新对象赋值，但 emit 的是新值引用 + 老数组） | 订阅者拿到的 `getAllConversations()` 快照引用与 emit payload 不一致 |
| H8 | [store/pluginSystem.ts:40](../packages/core/src/store/pluginSystem.ts) | 注释 `// 差个卸载` — 没有 `unregister` | 插件无法热卸载、HMR 后重复注册堆叠 |
| H9 | 所有 store | `getXxx` 在 emit 里同时把内部状态广播出去（GET/GETALL），把读操作当事件 | 读放大、订阅噪声、潜在循环触发 |
| H10 | [theme/themeStore.ts:22](../packages/core/src/theme/themeStore.ts) `findChangedValues` | 只递归 1 层（com → son），三层及以上的 ThemeConfig 改动不会 apply 到 CSS 变量 | 嵌套配置静默失效 |

### 1.3 扩展性问题

| # | 描述 |
|---|---|
| E1 | [store/registry.ts](../packages/core/src/store/registry.ts) 是模块级全局 `Map`，多实例 ChatStore 共享同一份消息组件注册表，无法做沙箱 |
| E2 | `CardConversationManager` 与 `CommandToolboxManager` 都重复实现：定时器 map、动画相位机、emit 时浅克隆。应抽 `BaseStatefulManager` |
| E3 | `ChatStore` 用了 45+ 行手写适配代理子 store 方法，每加一个子 store 方法要改两处 |
| E4 | `PluginSystem` 只有 `before/after/error` 三种 hook，缺 `transform`（修改 args 或 return value）和短路（return false 阻断） |
| E5 | `ChatConfig` 用可选嵌套，无法约束插件之间的字段依赖；缺 `ConfigSchema` 校验 |
| E6 | 子 store 各持有独立 PluginSystem 实例，跨 store 的插件（例如「消息发出时也更新会话时间」）必须注册两份 |

### 1.4 性能问题

| # | 场景 | 现状 | 影响 |
|---|---|---|---|
| P1 | 流式消息 30Hz 更新 | `getAllMessages` 每次返回 `[...this.messageList]`；订阅者收 ADD/UPDATE 后通常再读一次全量 | O(n) 每帧拷贝，n 大时 GC 飙升 |
| P2 | `CardConversationManager.cloneMessage` 在 emit 时浅克隆 message + content + animation | 每个动画 tick 都触发 | 内存抖动 |
| P3 | `ThemeManager.getThemeConfig` 用 `JSON.parse(JSON.stringify(...))` | 主题嵌套深时极慢；不支持函数/Map 等 | 高频读取场景明显延迟 |
| P4 | React/Vue 端订阅都是逐条 emit 触发 setState/triggerRef | 一条消息更新一次 re-render | 流式输出时主线程长任务 |
| P5 | `CommandToolboxManager.applyFilter` 每次 `[...commands.values()].filter(...)` + `toLowerCase()` 全量重算 | 命令多时 keystroke 卡顿 |
| P6 | `MessageListStore.deleteMessages(predicate)` 用 `filter` 再 emit | 大列表 O(n) 拷贝 |

### 1.5 工程化缺口

- 零测试。
- `vite.config.ts` 三套各写各的，没共享配置（externals、bundle 名）。
- 没有 `tsc --noEmit` 校验流程；`tsconfig.json` 未开 `strict`。
- 没有 CI（无 `.github/workflows`）。
- `pnpm-workspace.yaml` 有但 `package.json:10` build 脚本绕过 workspace。

---

## 2. 目标架构（v2）

> 命名空间策略：v2 新 API 放在 `@ms-chat/core/v2` subpath 导出（package.json 的 `exports` 字段补一条）。
> v1 全部保留，仅在文件头加 `@deprecated since 1.0.0, use v2/xxx instead`。

### 2.0 跨切面原则：**引用稳定语义（Stable Reference Semantics）**

v2 所有暴露给消费方的 getter / snapshot / payload 都遵循同一份契约：

> **在两次状态变更之间，任何 getter 多次调用返回 `===` 相等的引用。**

这条原则不再只属于 `BaseListStore`，而是 v2 的强制约束。它影响以下设计：

| API | v1 行为 | v2 行为 |
|---|---|---|
| `MessageStore.getSnapshot()` | 每次 `[...messageList]` 新数组 | 同版本号返回同一 `ReadonlyArray` 引用 |
| `ConversationsStore.getAllConversations()` | 每次 `[...conversations]` | 同上 |
| `CardConversationManager.getMessages()` | 每次 `.map(item => clone(item))` | 同版本号返回同一 readonly 数组；每条 message 也保持引用稳定，直到自身被改 |
| `CommandToolboxManager.getState()` | 每次重建 state + 浅克隆每个 command | 同上，state 只在 visible/filtered/index 任一变更时重建 |
| `ThemeManager.getThemeConfig()` | `JSON.parse(JSON.stringify(...))` | 每次返回同一 `Object.freeze` 后的引用，setTheme 后才换新 |
| emit payload（如 `MESSAGE_ADD`）| 浅克隆 message | 直接传 frozen 原引用 |

**为什么这条独立成节**：

- 性能：流式 30Hz 更新场景，订阅者用 `prev === next` 做 React.memo / Vue shallowRef 短路，避免无意义 re-render（修 P1/P2/P4）
- 正确性：emit payload 与下一次 `getSnapshot()` 引用一致，订阅者不会拿到状态不一致的"快照"（修 H7）
- 实现：要求所有内部状态写时复制 + `Object.freeze`（DEV mode 才 freeze，PROD 不 freeze 省开销，见 §2.1.9 devMode）

**实现细节**：每个 manager / store 内部维护 `version: number` 和 `snapshotCache`。任何 mutate 操作走统一 `mutate(next)` 助手，自增 version 并清缓存。getter 命中缓存就直接返回，未命中就以当前内部状态生成 frozen 视图并缓存。



```
packages/core/src/
├── v1/                       # 原结构原封不动迁入，作为 deprecated 入口
│   └── ...                   # 现有所有文件
├── v2/
│   ├── core/
│   │   ├── EventEmitter.ts          # 重写：错误隔离 + 可取消 once + onceAny + listenerCount
│   │   ├── BaseStatefulManager.ts   # 抽公共基类（timer/clone/snapshot）
│   │   └── Scheduler.ts             # microtask 批处理调度器
│   ├── transport/
│   │   ├── SSEClient.ts             # 替代 EventSourceService，支持重连/退避/可复用
│   │   └── retry.ts                 # 通用 retry（替换 retry.js）
│   ├── store/
│   │   ├── Store.ts                 # 通用 Store 基类（不再每个子 store 重复 emit）
│   │   ├── MessageStore.ts
│   │   ├── ConversationStore.ts
│   │   ├── ConfigStore.ts
│   │   ├── MsgInputStore.ts
│   │   ├── ChatStore.ts             # 用 Proxy 自动委派，移除手写适配层
│   │   └── ComponentRegistry.ts     # 实例化注册表，替换全局 Map
│   ├── plugin/
│   │   ├── PluginSystem.ts          # 加 transform/短路/unregister
│   │   └── hooks.ts                 # before/after/error/transform 类型化定义
│   ├── theme/
│   │   └── ThemeManager.ts          # 结构化共享 + 深度变更检测
│   ├── managers/
│   │   ├── CardConversationManager.ts   # 继承 BaseStatefulManager
│   │   └── CommandToolboxManager.ts     # 继承 BaseStatefulManager
│   ├── model/                       # 修正 unknown 联合 + 严格判别
│   └── utils/
│       ├── debounce.ts
│       ├── throttle.ts
│       ├── deepClone.ts             # ts 版本，无副作用
│       └── formatDateTime.ts
└── index.ts                  # 同时 export v1（默认）+ v2 namespace
```

### 2.1 关键 API 设计（v2）

#### 2.1.1 EventEmitter（错误隔离 + 可取消 once）

```ts
type Disposer = () => void;
interface EmitterOptions {
  /** handler 抛错是否打断后续 handler。默认 false（隔离） */
  stopOnError?: boolean;
  /** 全局错误回调，所有 handler 异常会经过这里 */
  onError?: (err: unknown, eventName: string) => void;
  /** 单事件 listener 上限，超过 warn。默认 100 */
  maxListeners?: number;
}

class EventEmitter<EventMap extends Record<string, any[]> = any> {
  constructor(options?: EmitterOptions);
  on<K extends keyof EventMap>(
    event: K,
    handler: (...args: EventMap[K]) => void,
  ): Disposer;                          // ← 返回 disposer 是新增
  off<K extends keyof EventMap>(event: K, handler?: Function): void;
  once<K extends keyof EventMap>(
    event: K,
    handler: (...args: EventMap[K]) => void,
  ): Disposer;                          // ← 同样返回 disposer，解决 H5
  emit<K extends keyof EventMap>(event: K, ...args: EventMap[K]): void;
  listenerCount(event: keyof EventMap): number;
  removeAllListeners(event?: keyof EventMap): void;
}
```

**内部实现要点**：
- `emit` 用 `slice()` 拍快照后再迭代，避免 handler 在内部 `off` 影响遍历（修 H4）
- 每个 handler 用 `try/catch` 包，异常走 `onError`（修 H4）
- `once` 把 wrapper 与原 handler 双向 map，`off(name, originalHandler)` 也能命中（修 H5）

#### 2.1.2 SSEClient（替代 EventSourceService）

```ts
interface SSEClientOptions {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string> | (() => Record<string, string>);
  body?: unknown;                       // 仅 POST 时序列化
  credentials?: RequestCredentials;
  openWhenHidden?: boolean;
  /** 自动重连 */
  reconnect?: {
    enabled: boolean;
    /** 指数退避，单位 ms。默认 [500, 1000, 2000, 5000] */
    backoff?: number[];
    /** 最多重试次数。默认 4 */
    maxRetries?: number;
  };
  /** JSON parse 失败时是否丢弃 chunk（默认 true）；false 则透传 raw 字符串 */
  strictJSON?: boolean;
}

interface SSEHandlers<T> {
  onOpen?: (response: Response) => void | Promise<void>;
  onMessage: (data: T, raw: MessageEvent) => void;
  onError?: (err: Error, retryCount: number) => void;
  onClose?: () => void;
  onReconnect?: (attempt: number) => void;
}

class SSEClient<T = unknown> {
  connect(options: SSEClientOptions, handlers: SSEHandlers<T>): Promise<void>;
  disconnect(): void;
  /** 同一实例可多次 connect（每次内部新建 AbortController），修 H1 */
  isActive(): boolean;
}
```

修复点：
- 每次 `connect()` 时 `this.abortController = new AbortController()`（修 H1）
- GET 时不序列化 body；POST 时空 body 不发 `"undefined"`（修 H3）
- 重连失败到达上限时调 `onError(err, retryCount)` 并 reject（修 H2）

#### 2.1.3 Store 基类与批处理

```ts
type Snapshot<T> = { version: number; data: ReadonlyArray<T> };

class BaseListStore<T, Events extends Record<string, any[]>> extends EventEmitter<Events> {
  /** 内部 list 永远当 immutable 用，写时复制 */
  protected list: ReadonlyArray<T> = [];
  private version = 0;
  private cachedSnapshot: Snapshot<T> | null = null;

  /** 增删改后版本号 +1，下一次 getSnapshot 才重建 */
  protected mutate(next: ReadonlyArray<T>): void {
    this.list = next;
    this.version++;
    this.cachedSnapshot = null;
  }

  /** 同版本号返回同一引用，订阅方可用 === 判定（修 P1） */
  getSnapshot(): Snapshot<T> {
    if (!this.cachedSnapshot) {
      this.cachedSnapshot = { version: this.version, data: this.list };
    }
    return this.cachedSnapshot;
  }
}
```

**批处理调度器**：

```ts
class Scheduler {
  private queued = new Set<() => void>();
  private flushScheduled = false;
  schedule(fn: () => void): void;       // 多次调用同一 fn 仅执行一次
  flush(): void;                        // 立即执行
}
// 用法：MessageStore.addMessages 内 emit 不直接同步触发，而是
// scheduler.schedule(() => this.emit('changed', this.getSnapshot()))
// 一个 microtask 内多次 addMessage 只触发一次 'changed' —— 修 P4
```

#### 2.1.4 PluginSystem（含 transform + 短路 + unregister）

```ts
type HookType = 'before' | 'after' | 'error' | 'transform';

interface PluginContext<TArgs extends any[] = any[], TResult = any> {
  functionName: string;
  args: TArgs;
  result?: TResult;
  error?: Error;
  metadata?: Record<string, unknown>;
  /** before 钩子返回 false 中断后续 + 不执行原函数 */
  /** transform 钩子可返回 { args?, result? } 改写流水线 */
}

interface PluginRegistration<TArgs extends any[] = any[], TResult = any> {
  id?: string;                          // 给 unregister 用
  targetFunction: string;
  hookType: HookType;
  handler: (ctx: PluginContext<TArgs, TResult>) => any;
  priority?: number;
}

class PluginSystem {
  register(reg: PluginRegistration): Disposer;     // 返回 disposer（修 H8）
  unregister(id: string): boolean;
  unregisterAll(targetFunction?: string): void;
  /** debug 用 */
  list(targetFunction?: string): PluginRegistration[];
  /** 执行一次带流水线的调用；before 短路时返回 false。createWrappedFunction 基于此。 */
  run<TArgs extends any[], TResult>(
    functionName: string,
    originalFn: (...args: TArgs) => TResult | Promise<TResult>,
    args: TArgs,
    metadata?: Record<string, unknown>,
  ): Promise<TResult | false>;
}
```

**流水线（PR-3 已落地）**：`before → transform → 原函数 → after`，任一阶段抛错跳到 `error` 并 rethrow。
- `before` 返回 `false` → 短路，不执行原函数，wrapped 调用 resolve 为 `false`。
- `transform` 返回 `{ args }` → 替换下游传给原函数的参数；返回 `{ result }` → 用该值短路原函数（跳过 fn，仍走 after）。
- `register` 返回 disposer；`unregister(id)` / `unregisterAll(fn?)` 支持热卸载（修 H8）。

#### 2.1.5 ChatStore（组合子 store）

> **PR-5 定稿**：放弃初稿的 Proxy 动态委派（运行时不透明 + mapped-type 展平难维护），
> 改为**直接把子 store 暴露为只读属性**——组合优于扁平化，完全类型化、零运行时魔法。

```ts
class ChatStore<TComp = unknown> {
  readonly messages: MessageStore;
  readonly conversations: ConversationStore;
  readonly msgInput: MsgInputStore;
  readonly config: ConfigStore;
  readonly registry: ComponentRegistry<TComp>;   // 实例级，替代全局 registryMessageType
  constructor(options?: { config?: ChatConfig });
  destroy(): void;
}

// 用法：store.messages.add(msg) / store.conversations.setCurrent(id) / store.registry.register(...)
```

子 store 全部继承 BaseListStore（或 EventEmitter），自带引用稳定 `getSnapshot()` 与
`changed` 事件；读操作不再 emit（修 H9），删除未命中不 emit（修 H6）。

#### 2.1.6 ComponentRegistry（实例化，修 E1）

```ts
class ComponentRegistry<TComp = unknown> {
  register(type: string, comp: TComp): Disposer;
  get(type: string): TComp | undefined;
  has(type: string): boolean;
  clear(): void;
  list(): string[];
}
// ChatStore 持有一份 registry，UI 层从 ChatStore 注入消费，不再用模块全局。
```

#### 2.1.7 ThemeManager（继承 EventEmitter + 结构化共享 + 深度递归）

> **决议（§7-4）**：去掉独立的 `subscribe` 接口，统一走 EventEmitter 订阅模型。

```ts
type ThemeEvents = {
  'theme:change': [theme: Readonly<ThemeConfig>, changes: ReadonlyArray<ThemeChange>];
};

interface ThemeChange {
  path: string;                          // 扁平路径，如 "conversation.item.bg"
  cssVar: string;                        // 已转换好的 CSS 变量名
  oldValue: string | undefined;
  newValue: string | undefined;
}

class ThemeManager extends EventEmitter<ThemeEvents> {
  // 内部 frozen 引用，setThemeConfig 后才换新 —— 修 P3
  getThemeConfig(): Readonly<ThemeConfig>;
  setThemeConfig(updates: DeepPartial<ThemeConfig>): void;
  // 内部 diff 递归任意层级（修 H10），变更收集成扁平 CSS var path 后批量 apply
  // 订阅方：themeManager.on('theme:change', (theme, changes) => ...)
}
```

迁移成本：v1 没有 `subscribe`（只是单向 set），所以这次合并不构成 break；新增的 `theme:change` 事件是纯增量能力。

#### 2.1.8 MarkdownWorker（Web Worker 解析）

> **决议（§7-3）**：将 markdown 解析从主线程迁移到 Worker，纳入 1.0 范围（而非延后到 1.1）。

**动机**：流式场景下每个 chunk 都要重新 parse markdown（含代码高亮、math、表格）。在主线程会和 UI 渲染抢 frame，是 P4（长任务）的主要来源。

**架构**：

```
v2/workers/
├── MarkdownWorker.ts         # 主线程侧 API
├── markdown.worker.ts        # Worker 内部实现（被 vite 用 ?worker 后缀编译）
└── protocol.ts               # 主线程 ↔ Worker 消息协议
```

**主线程 API**：

```ts
interface ParseRequest {
  id: string;                            // 由 manager 自动分配，用于幂等去重
  source: string;                        // markdown 原文
  options?: {
    highlightLanguages?: string[];       // 按需加载高亮语言
    streamingMode?: boolean;             // true 时容忍未闭合代码块
  };
}

interface ParseResult {
  id: string;
  html: string;
  meta: { headings: Array<{ level: number; text: string }>; codeBlocks: number };
}

class MarkdownWorkerClient {
  constructor(options?: {
    /** 几个 worker 实例。默认 1。多 conversation 并发场景可设 2-4 */
    poolSize?: number;
    /** 同一 id 的新请求自动取消旧的，避免流式输出堆积过时解析 */
    coalesce?: boolean;
  });

  parse(request: ParseRequest): Promise<ParseResult>;
  /** 主动取消某条 in-flight 请求 */
  cancel(id: string): void;
  /** 释放 worker 资源 */
  dispose(): void;

  /** 不支持 Worker 时的降级（SSR / 老浏览器）：主线程同步 parse */
  isFallback(): boolean;
}
```

**协议**（postMessage）：

```ts
type WorkerInbound =
  | { kind: 'parse'; id: string; source: string; options?: ParseOptions }
  | { kind: 'cancel'; id: string }
  | { kind: 'dispose' };

type WorkerOutbound =
  | { kind: 'result'; id: string; html: string; meta: ParseMeta }
  | { kind: 'error'; id: string; message: string }
  | { kind: 'progress'; id: string; partialHtml: string };   // 大文档可选
```

**关键实现要点**：

- 用 `new Worker(new URL('./markdown.worker.ts', import.meta.url), { type: 'module' })`，vite 原生支持，bundler 友好
- Worker 内不引入 React/Vue 依赖，只用纯 markdown lib（markdown-it 或 marked）+ shiki/prism 按需
- **请求合并（coalesce）**：流式输出同一条消息 id 高频更新时，新请求自动 cancel 同 id 的旧请求 —— 避免 worker 队列堆积
- **传输优化**：source 较大时用 `Transferable`（ArrayBuffer）传，避免结构化克隆开销
- **SSR/降级**：`typeof Worker === 'undefined'` 时自动 fallback 到主线程同步解析，API 表面不变
- **接入点**：v2 不直接消费 MarkdownWorkerClient，而是通过 `MessageStore` 的 markdown 类型钩子可选注入。React/Vue 适配包负责实例化和注入。

**收益估算**：流式场景主线程 long task 从 30ms+/chunk 降到 <5ms（仅消息派发），动画/输入响应不再阻塞。

#### 2.1.9 devMode（开发期校验）

> **决议（§7-5）**：v2 加 devMode，PROD 编译时通过 `process.env.NODE_ENV === 'production'` 死代码消除剔除。

**目的**：开发期把"易错的隐式契约"显式校验出来；上线零开销。

**校验项**：

| 校验 | DEV 行为 | PROD 行为 |
|---|---|---|
| EventEmitter listener 类型 | `emit` 时检查参数与事件 map 是否匹配，不匹配 `console.error` | 不校验 |
| EventEmitter 监听器泄漏 | 单事件 listener > `maxListeners`（默认 100）警告并打印调用栈 | 不检查 |
| 引用稳定 | 所有 frozen 视图实际 `Object.freeze` + 试图修改时抛 TypeError | 不 freeze，不抛 |
| PluginSystem 签名 | 注册时校验 `hookType` 拼写、`targetFunction` 是否存在、priority 数值 | 不校验 |
| Store mutate 路径 | 检测是否绕过 `mutate()` 直接改 `this.list`（用 Proxy 包内部数组），命中即 throw | 不包 Proxy |
| SSEClient | 检测 `body` 类型与 `Content-Type` 一致性；headers 全小写化 | 不检查 |
| ThemeManager | `setThemeConfig` 传入未声明字段时 warn | 不检查 |

**开关机制（PR-1 已落地，实测见下）**：

```ts
// v2/global.d.ts —— 全局环境声明，所有 v2 文件可直接用 __DEV__
declare const __DEV__: boolean;          // 由 bundler define 注入

// v2/core/devMode.ts
const COMPILE_DEV = typeof __DEV__ !== 'undefined' ? __DEV__ : true; // 未注入时默认 dev
let override: boolean | null = null;
export function setDevMode(v: boolean | null): void { override = v; }   // 测试用
export function resetDevMode(): void { override = null; }               // 测试 afterEach
export function isDevMode(): boolean { return override !== null ? override : COMPILE_DEV; }

export function devAssert(cond: unknown, msg: string): asserts cond {
  if (__DEV__ && isDevMode() && !cond) throw new Error(`[ms-chat/core] ${msg}`);
}
export function devWarn(cond: unknown, msg: string): void {
  if (__DEV__ && isDevMode() && !cond) console.warn(`[ms-chat/core] ${msg}`);
}
```

`vite.config.ts` 注入 `__DEV__: JSON.stringify(process.env.NODE_ENV !== 'production')`；
`vitest.config.ts` 注入 `__DEV__: 'true'`。

**双层守卫约定（重要——所有 v2 dev-only 分支都遵循）**：

- `__DEV__`：**编译期字面量**，PROD 折叠为 `false` → 整段分支（含字符串字面量）被 DCE，零运行时开销。
- `isDevMode()`：**运行时可覆盖**，仅在 `__DEV__=true` 的 dev/test 构建里被求值；测试用 `setDevMode(false)` 即可在一次 test run 内同时覆盖 dev / prod 两条路径。
- 二者组合 `if (__DEV__ && isDevMode() && ...)`：PROD 得 DCE，TEST 得运行时切换，两全。
- 体积敏感 / 字符串多的分支，**必须**在调用点写 `__DEV__ &&` 守卫（而非仅 `isDevMode()`），否则字符串无法被 DCE。

**PR-1 实测**（`vite build` 后 grep `dist/v2.es.js`）：`__DEV__`、`console.warn/error`、`[ms-chat/core]` dev 字符串均为 **0 残留**，v2 bundle 1.94 kB（gzip 0.78 kB）。验证了「PROD 零开销」不是口号。

---

## 3. 双轨兼容策略

### 3.1 导出结构

`packages/core/package.json` 的 `exports` 字段：

```jsonc
{
  "exports": {
    ".":            { /* v1 默认导出，保持不变 */ },
    "./v2":         { /* v2 全量入口 */ },
    "./v2/sse":     { /* 按需导入 */ },
    "./v2/store":   { /* 按需导入 */ },
    "./v2/event":   { /* 按需导入 */ }
  }
}
```

调用方迁移：

```ts
// v1（继续可用，编辑器会显示删除线 + deprecated tooltip）
import { EventSourceService, ChatStore } from '@ms-chat/core';

// v2（新代码用）
import { SSEClient } from '@ms-chat/core/v2/sse';
import { ChatStore } from '@ms-chat/core/v2/store';
```

### 3.2 deprecation 标注

v1 文件头统一加：

```ts
/** @deprecated since 1.0.0 — 使用 `@ms-chat/core/v2/sse` 的 `SSEClient`，将在 2.0 删除。迁移指南：docs/migration-v1-to-v2.md */
```

### 3.3 React/Vue 适配包

- `packages/react`、`packages/vue-next` 当前消费 v1，**第一阶段不动**。
- P2 阶段在适配包里新增 `MSChatV2` 入口（用 v2 ChatStore），与现有 `MSChat` 并存。
- demo 仓库给一份 v2 demo 验证。

---

## 4. 测试方案（vitest）

### 4.1 引入

```jsonc
// packages/core/package.json
{
  "devDependencies": {
    "vitest": "^2.0.0",
    "@vitest/coverage-v8": "^2.0.0"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

`packages/core/vitest.config.ts`：jsdom 环境（CSS var 测试需要 document）、覆盖率 lcov + text-summary。

### 4.2 覆盖率门槛

| 模块 | 行覆盖 | 分支覆盖 | 说明 |
|---|---|---|---|
| `v2/core/EventEmitter` | 95% | 90% | 核心基础设施，必须高覆盖 |
| `v2/core/devMode` | 100% | 95% | 极少代码，全覆盖 |
| `v2/transport/SSEClient` | 85% | 80% | fetch 用 msw mock |
| `v2/store/*` | 90% | 85% | 业务核心 |
| `v2/plugin/PluginSystem` | 90% | 85% | |
| `v2/managers/*` | 80% | 70% | 含定时器，用 vi.useFakeTimers |
| `v2/theme/ThemeManager` | 85% | 80% | |
| `v2/workers/MarkdownWorker` | 80% | 70% | worker 用 vitest 的 `@vitest/web-worker` 或主线程 mock |
| 整体 | ≥ 85% | ≥ 80% | CI 门槛 |

### 4.3 关键用例清单

#### `EventEmitter.test.ts`

- `on` 注册的 handler 在 `emit` 时按注册顺序触发
- 同一 handler 多次 `on` 触发多次（与原版一致）
- `off(name, handler)` 只移除该实例；`off(name)` 全清
- `once` handler 只触发一次；返回的 disposer 可在触发前取消
- **错误隔离**：第一个 handler 抛错，第二、第三个仍然执行
- **错误回调**：抛错经过 `onError(err, eventName)`
- **快照迭代**：handler 内部 `off` 自己，不影响同次 emit 的其他 handler
- `stopOnError: true` 时第一个错误后停止
- `maxListeners` 超过阈值 console.warn
- 类型测试（tsd / expect-type）：`emit('x', 1, 'a')` 与 `EventMap` 不匹配应报错

#### `SSEClient.test.ts`（用 msw）

- 正常 POST stream：onMessage 收到 N 条 chunk
- GET 请求不带 body；mock server 收到的 method/headers 正确
- 空 body POST 不发 `"undefined"`
- `disconnect()` 触发 AbortError，`onError` **不会**被调用（与 v1 一致）
- **可复用**：`disconnect()` 后再 `connect()`，第二次正常 fire onMessage
- **重连**：mock 第一次返回 500，验证 `onReconnect(1)` 被调用，第二次成功后 `onMessage` 触发
- 重连超过 `maxRetries`：`onError` 收到最后错误并 reject
- `strictJSON: false` 模式下 raw 字符串透传
- `headers` 是函数时每次 connect 重新求值（鉴权 token 刷新场景）

#### `MessageStore.test.ts`

- `addMessage` emit `changed` 一次；`addMessages([a,b])` emit 一次（不是两次）
- `deleteMessage(nonExistentId)` **不 emit**（修 H6）
- `getSnapshot()` 在无变更时返回同引用（`===` 判定通过）
- `updateMessages(id, partial)` 后 snapshot.version + 1，data 是新数组（不是 mutation）
- 插件 hook：注册 `before` hook 抛 `return false`，原函数不执行（修 E4）
- 插件 `transform` hook 改写 message.content
- 插件 `unregister(id)` 后该 hook 不再触发

#### `ConversationsStore.test.ts`

- `addConversation` 重复 ID 抛错
- 删除/更新 emit 时 payload 包含完整变更前后状态
- 不再在 `getXxx` 上 emit（修 H9）

#### `PluginSystem.test.ts`

- before/after/error/transform 四种钩子顺序：**before → transform → fn → after**，错误时跳到 error（PR-3 定稿：transform 在 fn 前，用于改写下游 args 或返回 result 短路 fn）
- priority 高的先执行
- `unregister(id)` 立即生效
- `unregisterAll(targetFunction)` 只清该函数的
- transform 返回 `{ args }` 改下游 args；返回 `undefined` 不变
- before return `false` 短路

#### `ThemeManager.test.ts`（jsdom）

- 浅层变更：CSS var 写入 `document.documentElement.style`
- 深层（3 层及以上）变更触发对应 CSS var（修 H10）
- 未变更字段不触发 setProperty（用 spy 验证调用次数）
- `undefined` / `null` 触发 `removeProperty`
- `getThemeConfig()` 多次调用返回同引用直到下次 `setThemeConfig`（修 P3）

#### `CardConversationManager.test.ts`（fakeTimers）

- `addCard` push 后 `entering` → `visible` 状态机推进 `delay + duration` 后切换
- `addCards` 多张按 stagger 排队
- memory 上限淘汰策略
- `reset()` 清所有定时器（用 `vi.getTimerCount()` 验证 0）
- 多次 `addCard` 中间 `destroy`：无后续 emit

#### `CommandToolboxManager.test.ts`（fakeTimers）

- `handleInput('/he')` 触发 open + filter
- debounce 期内多次输入只 filter 最后一次
- `handleKeydown('ArrowDown')` 导航边界 wrap
- `selectActive` 调 handler 后自动 close
- `register/unregister` 在 visible 状态下立即重 filter

#### `Scheduler.test.ts`

- 一个 microtask 内多次 schedule 同一 fn 只执行一次
- `flush()` 立即执行
- 跨 microtask 边界重置

#### `retry.test.ts`

- 成功 case：第一次成功直接返回
- 失败 case：失败 N 次后第 N+1 次成功
- 超过 count：reject 最后错误
- interval 等待：fakeTimers 验证间隔

#### `MarkdownWorker.test.ts`

- 基础 parse：传入 markdown 字符串，得到 html + meta（headings/codeBlocks 数量正确）
- 并发：连续派发 3 个不同 id，全部 resolve，html 互不干扰
- **coalesce**：同 id 的两次请求，先派发的被 cancel（其 promise reject `AbortError`），后派发的正常 resolve
- 主动 `cancel(id)`：对应 promise reject AbortError
- `dispose()` 后任何 parse 调用 reject 'disposed'
- **SSR fallback**：`globalThis.Worker = undefined` 时 `isFallback()` 返回 true，parse 在主线程完成且 API 行为一致
- worker 抛错：onerror 上来后该 id 的 promise reject，其他 in-flight 不受影响
- poolSize > 1 时请求负载均衡（用 spy 验证）

#### `devMode.test.ts`

- `__DEV__ = true` 时 `devAssert(false, msg)` throw；`__DEV__ = false` 时静默
- `devWarn` 同理
- EventEmitter 在 DEV 下，listener 超过 maxListeners 触发 warn（且只 warn 一次，不刷屏）
- BaseListStore 在 DEV 下，外部尝试改 `getSnapshot().data` 抛 TypeError（frozen）
- BaseListStore 在 DEV 下，子类绕过 `mutate()` 直接 `this.list.push(...)` 抛 "do not mutate directly"
- PluginSystem 在 DEV 下，注册时 `hookType: 'beofre'` 拼写错误抛错
- PROD build（`vi.stubGlobal('__DEV__', false)`）下所有上述校验静默；用 bundler 配合 dead-code-elimination 校验产物不含 `console.warn` 字面量（这条放到 Phase 4 的产物验证脚本里）

---

## 5. 落地路线 & PR 拆分

每个 PR 都自包含可独立合入。版本号每个阶段 minor bump。

### Phase 0 — 清洁（紧急）· 1 个 PR

- 删 `command-toolbox/deepClone.js`、`retry.js`
- 把 `utils.ts` 内容合并到 `utils/` 目录
- 修 `package.json:10` build 脚本路径
- 修 `model/index.ts` 乱码注释
- 修 `message.ts` 的 `unknown` 联合类型
- 移除 `msgInputStore.ts` 的 `console.log`
- 修 `store/index.ts:52` 的 `initConfig` 类型签名
- 加 `vitest` 依赖 + 一份冒烟测试（验 setup 工作）

**版本**：`0.0.3-beta.1`

### Phase 1 — 健壮性（v2 起步）· 4 个 PR

- **PR-1**：v2 目录骨架 + `devMode` 基础设施（`__DEV__` 注入、`devAssert/devWarn`）+ `EventEmitter` v2 + 完整单测（含 devMode 校验路径）
- **PR-2**：`SSEClient` v2 + msw + 完整单测
- **PR-3**：`PluginSystem` v2（含 unregister/transform/devMode 注册校验）+ 单测
- **PR-4**：`v1` 文件加 `@deprecated` 头注释 + `docs/migration-v1-to-v2.md` 骨架

**版本**：`1.0.0-rc.1`

### Phase 2 — 扩展性 · 3 个 PR

- **PR-5**：`BaseListStore`（引用稳定 snapshot + devMode 写入路径 Proxy 校验）+ `MessageStore` / `ConversationStore` / `MsgInputStore` v2
- **PR-6**：`ChatStore` v2（Proxy 委派）+ `ComponentRegistry`
- **PR-7**：`BaseStatefulManager` + `CardConversationManager` / `CommandToolboxManager` v2（含引用稳定 `getMessages` / `getState`）

**版本**：`1.0.0-rc.2`

### Phase 3 — 性能 · 3 个 PR

- **PR-8**：`Scheduler` 批处理（microtask flush）+ Store v2 接入
- **PR-9**：`ThemeManager` v2（继承 EventEmitter + 结构化共享 + 深度递归 diff）+ 单测
- **PR-10**：`MarkdownWorker` —— 主线程 client + worker 实现 + 协议 + Worker 池 + coalesce + SSR fallback + msw 等效的 worker mock 单测

**版本**：`1.0.0-rc.3`

### Phase 4 — GA & 工程化 · 2 个 PR

- **PR-11**：React/Vue 适配包加 v2 入口、demo 验证（含 `MarkdownWorker` 在 React/Vue demo 内的接线）
- **PR-12**：CI（lint + `tsc --strict` + test + coverage 门槛）；共享 vite config；定义 `__DEV__` 注入

**版本**：`1.0.0`

> ⚠️ v1 入口在 1.x 全程保留。计划在 `2.0.0` 删除。

---

## 6. 风险与回滚

| 风险 | 缓解 |
|---|---|
| v2 设计在使用中暴露问题，需要二次调整 | Phase 1-3 期间都是 `rc.x`，可随时迭代 ABI；GA 前定稿 |
| 现有用户错误依赖某个内部行为（如 GET 操作的 emit） | v1 完全不动，老行为完整保留 |
| 包体积膨胀（双份代码） | v2 用 subpath export，老用户 tree-shake 不会带 v2；新用户反过来 |
| 测试 mock 难以覆盖 fetchEventSource | 用 msw 网络层 mock；保留一个 e2e example 仓库 |
| Proxy 委派的 ChatStore 在某些低版本环境报错 | 编译目标 ES2017+，Proxy 是基础特性；旧环境继续用 v1 |
| **Web Worker 在 SSR / 老浏览器不可用** | `MarkdownWorkerClient` 内置 `Worker` 探测，无 Worker 时自动主线程 fallback，API 行为一致 |
| **Worker 模块在 bundler 配置错误时打包失败** | 用 `new URL(..., import.meta.url)` 模式，Vite/Rollup/Webpack 5 都原生支持；CI 跑产物 smoke test 验证 worker chunk 存在 |
| **devMode 校验在某些极端 prod 构建里未被消除** | Phase 4 加产物验证脚本，grep dist 输出确认无 `__DEV__` / `console.warn`（来自 devWarn）残留 |
| **引用稳定语义被消费方误用（拿到 frozen 对象直接改）** | DEV mode 真 freeze 会立即抛错暴露问题；PROD 不 freeze 但文档明确"返回值视为只读" |

---

## 7. 已决议事项（2026-05-26 review 后定稿）

| # | 议题 | 决议 | 落地章节 |
|---|---|---|---|
| 7-1 | 是否换 EventTarget 实现 | **不换**，继续自维护 EventEmitter，便于扩展 maxListeners / onError / disposer 返回值等定制语义 | §2.1.1 |
| 7-2 | 是否引入 immer | **不引入**，BaseListStore 用手写写时复制 + frozen 视图，避免 +6KB gzip 体积 | §2.0 / §2.1.3 |
| 7-3 | 是否将 markdown 解析迁到 Web Worker | **引入**，纳入 1.0 范围（不再延后），通过 `MarkdownWorkerClient` + Worker 池 + coalesce + SSR fallback 提供 | §2.1.8 / PR-10 |
| 7-4 | ThemeManager 订阅模型 | **合并到 EventEmitter**，去掉独立 `subscribe` 接口，emit `theme:change`（payload 含 theme + 扁平 changes 列表） | §2.1.7 |
| 7-5 | 是否加 devMode | **加**，通过 bundler 注入的 `__DEV__` 死代码消除，PROD 零开销；校验类型、监听器泄漏、freeze 违反、mutate 绕过、SSE 契约、Theme 字段 | §2.1.9 / PR-1 |

---

## 8. 附录 A：术语

- **v1**：现有 `@ms-chat/core` 0.0.x 暴露的所有 API
- **v2**：本 RFC 描述的新 API，从 `@ms-chat/core/v2` 子路径导出
- **disposer**：无参函数，调用即取消订阅 / 注销插件 / 移除 listener
- **snapshot**：带版本号的不可变数组视图，订阅方用引用相等判变更

## 9. 附录 B：迁移示例

```ts
// ─── before ───
import { EventSourceService, ChatStore } from '@ms-chat/core';

const sse = new EventSourceService();
await sse.connect({ url: '/chat', method: 'POST', body: { q } }, {
  onMessage: (data) => store.pushMessage(data),
});
sse.disconnect();
// ⚠️ 不能再 sse.connect()，需要 new 一个

// ─── after ───
import { SSEClient } from '@ms-chat/core/v2/sse';
import { ChatStore } from '@ms-chat/core/v2/store';

const sse = new SSEClient();
await sse.connect(
  { url: '/chat', method: 'POST', body: { q }, reconnect: { enabled: true } },
  {
    onMessage: (data) => store.messageListStore.addMessage(data),
    onReconnect: (n) => console.warn('reconnecting', n),
  },
);
sse.disconnect();
await sse.connect(/* ... */);   // ✅ 同实例可复用
```

---

**Review 历史**：

- 2026-05-26 初稿：提出问题盘点、双轨方案、四阶段拆分、五个待决议事项
- 2026-05-26 v2：§7 五项全部定稿（继续 EventEmitter / 不引 immer / Web Worker 纳入 1.0 / ThemeManager 合并 EventEmitter / 加 devMode），§2.0 提升"引用稳定语义"为全局原则，§5 PR 列表从 11 个扩为 12 个（新增 PR-10 MarkdownWorker）

**当前状态**：RFC 已完成 review，**准备进入 Phase 0 实施**。

下一步：

1. 开 `release-1.0.0` 的子分支 `chore/p0-cleanup`，执行 §5 Phase 0 的清洁工作
2. 同步 `docs/migration-v1-to-v2.md` 骨架（Phase 1 的 PR-4 起草）
3. 每个 PR 合入前更新本 RFC 顶部"Review 历史"小节
