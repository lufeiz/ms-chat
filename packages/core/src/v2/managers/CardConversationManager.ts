import type { CardContent, CardMessage } from '../../model';
import { isDevMode } from '../core/devMode';
import {
  BaseStatefulManager,
  type StatefulManagerOptions,
} from './BaseStatefulManager';

export type CardConversationRole = 'user' | 'system';
export type CardAnimationPhase = 'entering' | 'visible' | 'leaving';
export type CardMemoryContent = string | CardContent;

export interface CardAnimationState {
  phase: CardAnimationPhase;
  duration: number;
  delay: number;
  enteredAt?: number;
}

export interface AnimatedCardMessage extends CardMessage {
  animation: CardAnimationState;
}

export interface CardConversationMemory {
  id: string;
  role: CardConversationRole;
  type: 'text' | 'card';
  content: CardMemoryContent;
  timestamp: number;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface CardConversationContext {
  conversationId?: string;
  activeCardId?: string;
  messages: ReadonlyArray<AnimatedCardMessage>;
  memory: ReadonlyArray<CardConversationMemory>;
  lastUserInput?: string;
  metadata: Record<string, unknown>;
}

export interface AddCardOptions {
  id?: string;
  role?: CardConversationRole;
  conversationId?: string;
  timestamp?: number;
  duration?: number;
  delay?: number;
  summary?: string;
  remember?: boolean;
  metadata?: Record<string, unknown>;
}

export interface RememberTextOptions {
  id?: string;
  role?: CardConversationRole;
  timestamp?: number;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface CardConversationManagerOptions extends StatefulManagerOptions {
  conversationId?: string;
  memoryLimit?: number;
  animationDuration?: number;
  animationStagger?: number;
}

export type CardConversationEvents = {
  'card:add': [message: AnimatedCardMessage];
  'card:update': [message: AnimatedCardMessage];
  'card:animation': [message: AnimatedCardMessage];
  'card:remember': [record: CardConversationMemory];
  'card:context': [context: CardConversationContext];
  'card:reset': [];
};

const DEFAULTS = {
  memoryLimit: 20,
  animationDuration: 260,
  animationStagger: 80,
};

/**
 * 卡片对话管理器 v2（RFC §2.1.2，重写 v1 card-conversation）。
 *
 * 相比 v1：
 * - 继承 BaseStatefulManager —— 定时器统一托管，destroy 不再漏清（v1 用裸 Map 手动管理）。
 * - **引用稳定**：getMessages/getContext 按 version 缓存，无变更返回同一引用，
 *   emit 直接传内部引用，去掉 v1 每次 emit 的浅克隆（修 P2）。DEV 下冻结。
 */
export class CardConversationManager extends BaseStatefulManager<CardConversationEvents> {
  private messages: AnimatedCardMessage[] = [];
  private memory: CardConversationMemory[] = [];
  private metadata: Record<string, unknown> = {};
  private lastUserInput?: string;
  private conversationId?: string;
  private readonly memoryLimit: number;
  private readonly animationDuration: number;
  private readonly animationStagger: number;

  private version = 0;
  private cachedMessages: ReadonlyArray<AnimatedCardMessage> | null = null;
  private cachedContext: CardConversationContext | null = null;

  constructor(options: CardConversationManagerOptions = {}) {
    super(options);
    this.conversationId = options.conversationId;
    this.memoryLimit = options.memoryLimit ?? DEFAULTS.memoryLimit;
    this.animationDuration =
      options.animationDuration ?? DEFAULTS.animationDuration;
    this.animationStagger =
      options.animationStagger ?? DEFAULTS.animationStagger;
  }

  addCard(card: CardContent, options: AddCardOptions = {}): AnimatedCardMessage {
    const now = options.timestamp ?? this.now();
    const id = options.id ?? this.generateId();
    const delay = options.delay ?? this.messages.length * this.animationStagger;
    const duration = options.duration ?? this.animationDuration;

    const message: AnimatedCardMessage = {
      type: 'card',
      content: card,
      id,
      role: options.role ?? 'system',
      conversationId: options.conversationId ?? this.conversationId,
      timestamp: now,
      animation: { phase: 'entering', duration, delay },
    };

    this.messages = [...this.messages, message];
    this.bump();
    this.emit('card:add', message);

    if (options.remember !== false) {
      this.pushMemory({
        id,
        role: options.role ?? 'system',
        type: 'card',
        content: card,
        timestamp: now,
        summary: options.summary,
        metadata: options.metadata,
      });
    }

    this.scheduleVisible(id, delay + duration);
    this.emitContext();
    return message;
  }

  addCards(
    cards: Array<{ card: CardContent; options?: AddCardOptions }>,
  ): AnimatedCardMessage[] {
    const baseDelay = this.messages.length * this.animationStagger;
    return cards.map(({ card, options = {} }, index) =>
      this.addCard(card, {
        ...options,
        delay: options.delay ?? baseDelay + index * this.animationStagger,
      }),
    );
  }

  rememberText(
    content: string,
    options: RememberTextOptions = {},
  ): CardConversationMemory {
    const record: CardConversationMemory = {
      id: options.id ?? this.generateId(),
      role: options.role ?? 'user',
      type: 'text',
      content,
      timestamp: options.timestamp ?? this.now(),
      summary: options.summary,
      metadata: options.metadata,
    };
    if (record.role === 'user') {
      this.lastUserInput = content;
    }
    this.pushMemory(record);
    this.emitContext();
    return record;
  }

  updateCard(id: string, content: CardContent): boolean {
    const idx = this.messages.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    const next = this.messages.slice();
    next[idx] = { ...next[idx], content };
    this.messages = next;
    const memIdx = this.memory.findIndex(
      (m) => m.id === id && m.type === 'card',
    );
    if (memIdx !== -1) {
      const mem = this.memory.slice();
      mem[memIdx] = { ...mem[memIdx], content };
      this.memory = mem;
    }
    this.bump();
    this.emit('card:update', next[idx]);
    this.emitContext();
    return true;
  }

  markLeaving(id: string): boolean {
    const idx = this.messages.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    const next = this.messages.slice();
    next[idx] = {
      ...next[idx],
      animation: { ...next[idx].animation, phase: 'leaving' },
    };
    this.messages = next;
    this.bump();
    this.emit('card:animation', next[idx]);
    this.emitContext();
    return true;
  }

  setMetadata(metadata: Record<string, unknown>): void {
    this.metadata = { ...this.metadata, ...metadata };
    this.bump();
    this.emitContext();
  }

  setConversationId(conversationId?: string): void {
    this.conversationId = conversationId;
    this.bump();
    this.emitContext();
  }

  getMessages(): ReadonlyArray<AnimatedCardMessage> {
    if (!this.cachedMessages) {
      this.cachedMessages =
        __DEV__ && isDevMode() ? Object.freeze(this.messages.slice()) : this.messages;
    }
    return this.cachedMessages;
  }

  getMemory(): ReadonlyArray<CardConversationMemory> {
    return this.memory;
  }

  getContext(): CardConversationContext {
    if (!this.cachedContext) {
      const activeCard = this.messages[this.messages.length - 1];
      const ctx: CardConversationContext = {
        conversationId: this.conversationId,
        activeCardId: activeCard?.id,
        messages: this.getMessages(),
        memory: this.memory,
        lastUserInput: this.lastUserInput,
        metadata: this.metadata,
      };
      this.cachedContext = __DEV__ && isDevMode() ? Object.freeze(ctx) : ctx;
    }
    return this.cachedContext;
  }

  reset(): void {
    this.clearAllTimers();
    this.messages = [];
    this.memory = [];
    this.metadata = {};
    this.lastUserInput = undefined;
    this.bump();
    this.emit('card:reset');
    this.emitContext();
  }

  override destroy(): void {
    this.reset();
    super.destroy();
  }

  private pushMemory(record: CardConversationMemory): void {
    const next = [...this.memory, record];
    this.memory = next.length > this.memoryLimit ? next.slice(-this.memoryLimit) : next;
    this.bump();
    this.emit('card:remember', record);
  }

  private scheduleVisible(id: string, delay: number): void {
    this.schedule(() => {
      const idx = this.messages.findIndex((m) => m.id === id);
      if (idx === -1) return;
      const next = this.messages.slice();
      next[idx] = {
        ...next[idx],
        animation: {
          ...next[idx].animation,
          phase: 'visible',
          enteredAt: this.now(),
        },
      };
      this.messages = next;
      this.bump();
      this.emit('card:animation', next[idx]);
      this.emitContext();
    }, delay);
  }

  private emitContext(): void {
    this.emit('card:context', this.getContext());
  }

  /** 任意状态变更后失效快照缓存。 */
  private bump(): void {
    this.version += 1;
    this.cachedMessages = null;
    this.cachedContext = null;
  }
}
