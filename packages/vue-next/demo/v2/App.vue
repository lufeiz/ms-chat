<script setup lang="ts">
import { onUnmounted, ref, shallowRef } from 'vue';
import { ChatStore } from '@ms-chat/core/v2';
import { constructMarkdownMessage, constructTextMessage } from '@ms-chat/core';

/**
 * v2 验证 demo（Vue）：用 `@ms-chat/core/v2` 的 ChatStore 跑通最小聊天回路，
 * 演示引用稳定订阅 + microtask 批处理下的流式更新。自包含、不依赖业务接口。
 * 与 packages/react/demo/v2 对齐。
 */
const store = new ChatStore();

// 引用稳定快照桥接到 Vue：'changed' 批处理后用新快照引用触发 shallowRef 更新
const snapshot = shallowRef(store.messages.getSnapshot());
const dispose = store.messages.on('changed', (s) => {
  snapshot.value = s;
});
onUnmounted(() => {
  dispose();
  store.destroy();
});

const input = ref('');
let idCounter = 0;

function send(): void {
  const text = input.value.trim();
  if (!text) return;

  store.messages.add(
    constructTextMessage(text, { id: `u${idCounter++}`, role: 'user' }),
  );

  // 模拟流式助手回复：先插空 markdown，再逐字 update（同 id 触发更新）
  const aid = `a${idCounter++}`;
  store.messages.add(constructMarkdownMessage('', { id: aid, role: 'system' }));
  const reply = `收到：**${text}** ✅ —— v2 引用稳定 + 流式更新（Vue）`;
  let i = 0;
  const timer = setInterval(() => {
    i += 1;
    store.messages.update(aid, { content: reply.slice(0, i) });
    if (i >= reply.length) clearInterval(timer);
  }, 25);

  input.value = '';
}
</script>

<template>
  <div
    style="max-width: 560px; margin: 40px auto; font-family: system-ui, sans-serif"
  >
    <h2 style="margin-bottom: 4px">@ms-chat/core v2 · Vue 验证 demo</h2>
    <p style="color: #888; margin-top: 0; font-size: 13px">
      snapshot version: <b data-testid="version">{{ snapshot.version }}</b> ·
      消息数 <b data-testid="count">{{ snapshot.data.length }}</b>
    </p>

    <div
      data-testid="messages"
      style="
        border: 1px solid #eee;
        border-radius: 8px;
        padding: 12px;
        min-height: 240px;
        background: #fafafa;
      "
    >
      <div
        v-for="m in snapshot.data"
        :key="m.id"
        :style="{ margin: '8px 0', textAlign: m.role === 'user' ? 'right' : 'left' }"
      >
        <span
          :style="{
            display: 'inline-block',
            background: m.role === 'user' ? '#d6e4ff' : '#f0f0f0',
            padding: '6px 10px',
            borderRadius: '8px',
            maxWidth: '80%',
          }"
        >
          {{ typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }}
        </span>
      </div>
    </div>

    <div style="display: flex; gap: 8px; margin-top: 12px">
      <input
        data-testid="input"
        v-model="input"
        placeholder="输入消息后回车 / 点发送…"
        style="flex: 1; padding: 8px; border-radius: 6px; border: 1px solid #ddd"
        @keydown.enter="send"
      />
      <button
        data-testid="send"
        style="
          padding: 8px 16px;
          border-radius: 6px;
          border: none;
          background: #1677ff;
          color: #fff;
          cursor: pointer;
        "
        @click="send"
      >
        发送
      </button>
    </div>
  </div>
</template>
