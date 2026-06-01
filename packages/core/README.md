# @ms-chat/core

MS-Chat 的框架无关核心：事件总线、SSE 传输、插件系统、引用稳定状态层、主题、Web Worker markdown 解析等。React / Vue 适配包共用它。

- 默认入口为 v1（逐步 `@deprecated`）；新代码用子路径 `@ms-chat/core/v2`。
- 完整文档、架构图与迁移指南见仓库根 [README](../../README.md) 与 [docs/](../../docs/)。

```ts
import { SSEClient, ChatStore, ThemeManager } from '@ms-chat/core/v2';
```

MIT License.
