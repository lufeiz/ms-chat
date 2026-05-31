<!--
 * ChatBubble.vue – 悬浮气泡入口
 * ----------------------------
 * 职责：
 * 1. 右下角固定气泡按钮，点击切换聊天面板显隐。
 * 2. 内部嵌套 ChatH5 组件。
 -->
<template>
  <div>
    <div
      class="chat-toggle"
      :style="{
        backgroundImage: `url(${bubbleOptions?.iconBgUrl || defaultIconBgUrl})`,
      }"
      @click="toggleChat"
      aria-label="打开对话"
    >
      {{ bubbleOptions?.iconTitle }}
    </div>
    <!-- 使用 ChatH5 组件并启用拖拽 -->
    <ChatH5
      v-if="visible"
      v-bind="$attrs"
      :draggable="true"
      :draggable-options="{
        initialPosition: { x: rect.x, y: rect.y },
        initialSize: { width: rect.w, height: rect.h },
        minSize: { width: 300, height: 500 },
        showCloseButton: true,
        onClose: toggleChat,
      }"
    >
      <template v-for="(_, slot) in $slots" #[slot]="props">
        <slot :name="slot" v-bind="props" />
      </template>
    </ChatH5>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { IMsChatProps } from '../../types/index';
import useDraggable from '../hooks/useChatBubble';
import ChatH5 from '../ChatH5/index.vue';

const props = defineProps<IMsChatProps>();

const { visible, toggleChat, rect } = useDraggable();

// 内联 SVG data URI 作默认头像：离线可用、不泄露内网地址。
const defaultIconBgUrl = computed(() => {
  return (
    props.bubbleOptions?.iconBgUrl ||
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' rx='8' fill='%238568fe'/%3E%3Ctext x='20' y='25' font-family='sans-serif' font-size='15' font-weight='bold' text-anchor='middle' fill='white'%3EAI%3C/text%3E%3C/svg%3E"
  );
});
</script>

<style lang="less" scoped>
@import url('./index.less');
</style>
