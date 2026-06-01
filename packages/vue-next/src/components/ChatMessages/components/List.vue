<template>
  <!-- role=log + aria-live=polite：流式助手回复被读屏增量播报（无障碍） -->
  <div v-if="!isEmptyData" class="chat-message-list" role="log" aria-live="polite" aria-label="对话消息列表">
    <!-- <n-scrollbar
      v-if="!useVirtual"
      style="max-height: 100%"
      ref="scrollbarRef"
      @scroll="handleScroll"
    >
      <div v-for="item in data" :key="item.id">
        <ChatBubble v-bind="item" >
          <template v-for="(_, slot) in $slots" #[slot]="props">
            <slot :name="slot" v-bind="props"/>
          </template>
        </ChatBubble>
      </div>
    </n-scrollbar> -->
    <n-virtual-list
      style="max-height: 100%"
      :item-size="58"
      :items="runData"
      :key-field="'id'"
      item-resizable
      ref="scrollbarRef"
      @scroll="handleScroll"
    >
      <template #default="{ item }">
        <ChatBubble v-bind="item">
          <template v-for="(_, slot) in $slots" #[slot]="props">
            <slot :name="slot" v-bind="props"/>
          </template>
        </ChatBubble>
      </template>
    </n-virtual-list>

    <float-btn />
  </div>
</template>

<script setup lang="ts">
import { NScrollbar, NVirtualList } from 'naive-ui';
import ChatBubble from '../../ChatBubble/index.vue';
import FloatBtn from './FloatBtn.vue';
import { injectStore } from '../hooks/index.js';

const store = injectStore();

const { data, runData, scrollbarRef, handleScroll, isEmptyData } = store;

</script>

<style lang="less" scoped>
.chat-message-list {
  position: relative;
  height: 100%;
}
</style>
