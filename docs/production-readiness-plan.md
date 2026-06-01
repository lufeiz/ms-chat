# MS-Chat 生产化提升计划

> 状态：执行中 · 集成基线 **`release-3.0.0`**（S0–S5 所有 PR 都合入它）
> 来源：2026-06 基于 6 维并行审计（安全 / 架构 / 性能 / CI运维 / 产品DX / 测试）
> 受众定位：**外部开源 / 第三方接入** → a11y / i18n / 主题 / 命令面板按 P0

## 执行摘要

`@ms-chat/core` 内核工程质量高（错误隔离、引用稳定、DCE 干净、无泄漏）。但**面向用户的 react/vue 层 + 安全 + 发布/CI + 可观测性有硬缺口，未达 GA**。最高危是贯穿安全/测试/产品三维的 **Markdown XSS**。`命中维度` 越多 = 置信越高。

---

## 🔴 P0（GA 前必须）

| # | 问题 | 命中维度 | 位置 | 修复 | 量 |
|---|---|---|---|---|---|
| 1 | **Markdown XSS**：Vue `markdown-it html:true`+`v-html`；React `@uiw/react-markdown-preview` 含 rehype-raw 渲染原始 HTML；core marked 默认不消毒。不可信文本→可执行 HTML | 安全/测试/产品 | `MarkdownsCard.vue`、`MarkdownCard/index.tsx`、`markdownParser.ts` | Vue `html:false`+DOMPurify；React rehype-sanitize；core @security 文档 | M |
| 2 | **网关凭证硬编码进 git 历史** `sk-/ak-/app-id` | 安全 | `*/demo/request/*`、`Main.*` | demo 改 env；**吊销轮换+清历史（维护者操作）** | M |
| 3 | **react/vue 零测试零 CI** | CI/测试 | `ci.yml` 仅 core | CI 加 react/vue job + @testing-library 组件测试 | L |
| 4 | **发布流水线坏**：changesets 未装、`.es.ts` typo、main/exports 不一致、缺 README/files、无 sideEffects | CI | 各 `package.json` | 装 changesets+init；修打包字段 | M |
| 5 | **主题 CSS 变量前缀不一致** `--mschat--` vs `--ms-chat-`，Vue 组件程序化换肤静默失效 | 产品 | `ThemeManager.ts` vs `vue/*.less` | 统一前缀+映射表 | M |
| 6 | **MessageStore 无界 + 流式 O(n²)** | 架构/性能 | `MessageStore.ts`、`BaseListStore.ts` | maxSize+尾部专用更新路径 | M |
| 7 | **a11y 接近未做**：发送/停止/上传是裸 `<div onClick>`；流式无 `aria-live` | 产品/测试 | `Sender`、`ChatMessages` | 真实 `<button aria-label>`；`role=log aria-live` | M |

## 🟡 P1（重要）

| # | 问题 | 命中维度 | 量 |
|---|---|---|---|
| 8 | 产物体积浪费：marked 三份冗余+零功能负重、d3-array 死依赖（quick win） | 性能/CI | S |
| 9 | 无统一错误/telemetry 通道，PROD 静默失败（ChatStore 不传 onError） | 架构/CI | M |
| 10 | 流式每 chunk 全量 re-parse markdown（O(n²)）—— MarkdownWorker 未接入 react/vue | 性能 | L |
| 11 | CommandToolbox 在 react/vue 无 UI，core 键盘逻辑是死代码 | 产品 | L |
| 12 | 资源泄漏：React demo hook 无清理、SSEClient 并发 connect 泄漏+无超时、PluginSystem hook 无超时 | 架构 | M |
| 13 | 内网域名泄露 + dev 代理 SSRF 面 | 安全/产品 | S |
| 14 | i18n 完全缺失 + 内网图标 URL | 产品 | L |
| 15 | 无集成/e2e 测试（SSE→Store→Worker→渲染 回路） | 测试 | L |
| 16 | CI 缺 lint/audit/size/dependabot 门禁；无 provenance/tag | CI | M |
| 17 | 原型链污染防护缺失（theme structuralMerge / ConfigStore） | 安全 | S |

## 🟢 P2（打磨）
- v1（48 文件）零覆盖却仍从公共入口导出 → 补测或下线
- 覆盖率门槛设在现状之下 + 排除 worker 入口 → 贴现状 + diff 覆盖
- React 中文输入法 `handleSendMessage` 用 stale `input.query`
- 复制无成功反馈/失败仅 console；无重发/重试入口；SSE error 无 UI 态
- 仓库卫生：无 SECURITY.md/CONTRIBUTING/模板、双 LICENSE、缺 browserslist/engines/.nvmrc、`console.log` 残留
- React 把 antd 全家桶打进 lib（应 peer+external）；内存无界

---

## 执行分期（每期独立 PR → `release-3.0.0`）

| 期 | 主题 | 含 | 状态 |
|---|---|---|---|
| **S0 安全热修** | #1 XSS · #2 凭证/#13 内网域名 · #17 原型链 | 🔄 进行中 |
| **S1 快赢** | #8 体积（删 marked/d3-array）· #4 打包字段 | ⏳ |
| **S2 内核硬化** | #6 MessageStore 有界 · #9 统一错误通道 · #12 资源泄漏 | ⏳ |
| **S3 CI/发布** | #3 react/vue 进 CI · #4 changesets · #16 门禁/provenance | ⏳ |
| **S4 产品/a11y** | #7 a11y · #5 主题前缀 · #11 命令面板 · #14 i18n · #10 worker 接入 | ⏳ |
| **S5 测试补网** | #3 组件测试 · #15 集成/e2e · a11y 测试 · 覆盖门禁 | ⏳ |

## 维护者待办（非代码）
1. **吊销轮换** demo 里泄露的 `sk-`/`ak-` 网关凭证（已从工作树移除，但仍在 git 历史）。
2. 用 BFG / git-filter-repo 清理历史中的凭证（**仅 fork，勿推上游**）。
