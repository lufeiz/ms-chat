/**
 * `@ms-chat/core/v2` —— 重构后的新 API 入口（RFC §3）。
 *
 * v1（默认入口 `@ms-chat/core`）保持不变并逐步标记 @deprecated。
 * v2 以子路径独立导出，consumer 按需引入、互不影响 tree-shaking。
 */
export * from './core';
export * from './transport';
export * from './plugin';
export * from './store';
export * from './managers';
export * from './theme';
