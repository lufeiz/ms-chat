<template>
  <div class="chat-bubble-content-markdown">
    <div v-for="(item, idx) in strr" :key="idx">
      <div v-if="item.type">
        <slot name="mdExt" v-bind="item" />
      </div>
      <!-- 安全：渲染结果经 renderMarkdown 消毒后再 v-html，防 XSS -->
      <div v-else v-html="renderMarkdown(item.content)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import MarkdownIt from 'markdown-it';
import MarkdownItHighlightjs from 'markdown-it-highlightjs';
import DOMPurify from 'dompurify';
import type { IMarkdownMessageProps } from '@ms-chat/core';

const props = defineProps<IMarkdownMessageProps>();
// html:false 关闭原始 HTML 透传（XSS 主向量），保留全部 markdown 语法（表格/代码/链接等）。
const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: true,
}).use(MarkdownItHighlightjs);

/**
 * 渲染并消毒 markdown。LLM/用户内容是不可信文本，必须消毒后才能 v-html，
 * 否则 `<script>` / `<img onerror>` / `javascript:` 等会在会话内执行（XSS）。
 * 浏览器走 DOMPurify；SSR（无 window）下 html:false 已避免原始 HTML 注入。
 */
function renderMarkdown(content: string): string {
  const html = markdown.render(content ?? '');
  return typeof window === 'undefined' ? html : DOMPurify.sanitize(html);
}

const strr = computed(() => {
  if (!props.content) return [];
  return Array.isArray(props.content)
    ? props.content
    : [{ content: props.content }];
});
</script>

<style scoped>
.chat-bubble-content-markdown {
  padding-left: 10px;
}
:deep(pre) {
  white-space: pre-wrap;
  word-break: break-all;
  overflow-wrap: break-word;
}

</style>
