---
"@ms-chat/react": patch
---

测试补网：为 React 包引入组件测试基建（vitest + @testing-library/react 12 + jsdom），并新增回归网——

- Sender 无障碍：发送/停止/上传可聚焦、role/aria-label/aria-disabled 正确、Enter/Space 键盘激活（守 S4）。
- MarkdownCard XSS：注入 `<script>`/`onerror`/`javascript:` 被剥离、正常 markdown 仍渲染（守 S0）。

CI 的 adapters job 现会运行 React 测试。修正 react package.json `exports` 中 `types` 的顺序（置于 import/require 之前）。
