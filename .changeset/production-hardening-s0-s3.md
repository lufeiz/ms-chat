---
"@ms-chat/core": patch
"@ms-chat/react": patch
"@ms-chat/vue": patch
---

生产化加固 S0–S3：

- **安全**：修复 Markdown XSS（Vue DOMPurify / React rehype-sanitize）、移除硬编码网关凭证与内网域名、ThemeManager 原型链污染防护。
- **打包**：删除死依赖、修正 core publishConfig；恢复 vue 构建（`chatStoreInject` 未导出导致整包构建失败）并补全 vue 打包字段。
- **内核**：store 有界增长（`maxSize` 滑窗）、流式更新尾部快路径、统一 `onError` 错误通道、SSEClient 并发-connect 泄漏修复。
- **工程**：CI 扩展 react/vue 构建校验；引入 changesets 管理发布。
