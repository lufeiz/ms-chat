import { EventEmitter } from '../event';
import { CardContent, CardMessage } from '../model';
import { constructCardMessage } from '../utils/constructMessages';

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

export interface CardConversationContext {
    conversationId?: string;
    activeCardId?: string;
    messages: AnimatedCardMessage[];
    memory: CardConversationMemory[];
    lastUserInput?: string;
    metadata: Record<string, unknown>;
}

export interface CardConversationManagerOptions {
    conversationId?: string;
    memoryLimit?: number;
    animationDuration?: number;
    animationStagger?: number;
    idGenerator?: () => string;
    now?: () => number;
}

export enum CARD_CONVERSATION_ACTION_TYPE {
    ADD_CARD = 'cardConversation:addCard',
    UPDATE_CARD = 'cardConversation:updateCard',
    UPDATE_ANIMATION = 'cardConversation:updateAnimation',
    REMEMBER = 'cardConversation:remember',
    UPDATE_CONTEXT = 'cardConversation:updateContext',
    RESET = 'cardConversation:reset'
}

const DEFAULT_OPTIONS: Required<
    Pick<
        CardConversationManagerOptions,
        'memoryLimit' | 'animationDuration' | 'animationStagger' | 'idGenerator' | 'now'
    >
> = {
    memoryLimit: 20,
    animationDuration: 260,
    animationStagger: 80,
    idGenerator: () =>
        `card_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    now: () => Date.now()
};

export class CardConversationManager extends EventEmitter {
    private messages: AnimatedCardMessage[] = [];
    private memory: CardConversationMemory[] = [];
    private timers = new Map<string, ReturnType<typeof setTimeout>[]>();
    private options: CardConversationManagerOptions;
    private metadata: Record<string, unknown> = {};
    private lastUserInput?: string;

    constructor(options: CardConversationManagerOptions = {}) {
        super();
        this.options = {
            ...DEFAULT_OPTIONS,
            ...options
        };
    }

    addCard(card: CardContent, options: AddCardOptions = {}): AnimatedCardMessage {
        const now = options.timestamp ?? this.getNow();
        const id = options.id ?? this.generateId();
        const delay = options.delay ?? this.messages.length * this.getAnimationStagger();
        const duration = options.duration ?? this.getAnimationDuration();
        const message = {
            ...constructCardMessage(card, {
                id,
                role: options.role ?? 'system',
                conversationId: options.conversationId ?? this.options.conversationId,
                timestamp: now
            }),
            animation: {
                phase: 'entering' as CardAnimationPhase,
                duration,
                delay
            }
        };

        this.messages.push(message);
        this.emit(CARD_CONVERSATION_ACTION_TYPE.ADD_CARD, message);

        if (options.remember !== false) {
            this.pushMemory({
                id,
                role: options.role ?? 'system',
                type: 'card',
                content: card,
                timestamp: now,
                summary: options.summary,
                metadata: options.metadata
            });
        }

        this.scheduleVisible(message);
        this.emitContextUpdate();
        return this.cloneMessage(message);
    }

    addCards(
        cards: Array<{ card: CardContent; options?: AddCardOptions }>
    ): AnimatedCardMessage[] {
        const baseDelay = this.messages.length * this.getAnimationStagger();
        return cards.map(({ card, options = {} }, index) =>
            this.addCard(card, {
                ...options,
                delay: options.delay ?? baseDelay + index * this.getAnimationStagger()
            })
        );
    }

    rememberText(content: string, options: RememberTextOptions = {}): CardConversationMemory {
        const record: CardConversationMemory = {
            id: options.id ?? this.generateId(),
            role: options.role ?? 'user',
            type: 'text',
            content,
            timestamp: options.timestamp ?? this.getNow(),
            summary: options.summary,
            metadata: options.metadata
        };

        if (record.role === 'user') {
            this.lastUserInput = content;
        }

        this.pushMemory(record);
        this.emitContextUpdate();
        return this.cloneMemory(record);
    }

    updateCard(id: string, content: CardContent): boolean {
        const target = this.messages.find((item) => item.id === id);
        if (!target) {
            return false;
        }

        target.content = content;
        const memoryTarget = this.memory.find((item) => item.id === id && item.type === 'card');
        if (memoryTarget) {
            memoryTarget.content = content;
        }

        this.emit(CARD_CONVERSATION_ACTION_TYPE.UPDATE_CARD, this.cloneMessage(target));
        this.emitContextUpdate();
        return true;
    }

    markLeaving(id: string): boolean {
        const target = this.messages.find((item) => item.id === id);
        if (!target) {
            return false;
        }

        target.animation = {
            ...target.animation,
            phase: 'leaving'
        };
        this.emit(CARD_CONVERSATION_ACTION_TYPE.UPDATE_ANIMATION, this.cloneMessage(target));
        this.emitContextUpdate();
        return true;
    }

    setMetadata(metadata: Record<string, unknown>): void {
        this.metadata = {
            ...this.metadata,
            ...metadata
        };
        this.emitContextUpdate();
    }

    setConversationId(conversationId?: string): void {
        this.options.conversationId = conversationId;
        this.emitContextUpdate();
    }

    getMessages(): AnimatedCardMessage[] {
        return this.messages.map((item) => this.cloneMessage(item));
    }

    getMemory(): CardConversationMemory[] {
        return this.memory.map((item) => this.cloneMemory(item));
    }

    getContext(): CardConversationContext {
        const activeCard = this.messages[this.messages.length - 1];
        return {
            conversationId: this.options.conversationId,
            activeCardId: activeCard?.id,
            messages: this.getMessages(),
            memory: this.getMemory(),
            lastUserInput: this.lastUserInput,
            metadata: { ...this.metadata }
        };
    }

    reset(): void {
        this.clearTimers();
        this.messages = [];
        this.memory = [];
        this.metadata = {};
        this.lastUserInput = undefined;
        this.emit(CARD_CONVERSATION_ACTION_TYPE.RESET);
        this.emitContextUpdate();
    }

    destroy(): void {
        this.reset();
    }

    private pushMemory(record: CardConversationMemory): void {
        this.memory.push(record);
        const limit = this.options.memoryLimit ?? DEFAULT_OPTIONS.memoryLimit;
        if (this.memory.length > limit) {
            this.memory = this.memory.slice(-limit);
        }
        this.emit(CARD_CONVERSATION_ACTION_TYPE.REMEMBER, this.cloneMemory(record));
    }

    private scheduleVisible(message: AnimatedCardMessage): void {
        const timeout = setTimeout(() => {
            const target = this.messages.find((item) => item.id === message.id);
            if (!target) {
                return;
            }

            target.animation = {
                ...target.animation,
                phase: 'visible',
                enteredAt: this.getNow()
            };
            this.emit(
                CARD_CONVERSATION_ACTION_TYPE.UPDATE_ANIMATION,
                this.cloneMessage(target)
            );
            this.emitContextUpdate();
        }, message.animation.delay + message.animation.duration);

        const timers = this.timers.get(message.id ?? '') ?? [];
        timers.push(timeout);
        this.timers.set(message.id ?? '', timers);
    }

    private clearTimers(): void {
        this.timers.forEach((timers) => {
            timers.forEach((timer) => clearTimeout(timer));
        });
        this.timers.clear();
    }

    private emitContextUpdate(): void {
        this.emit(CARD_CONVERSATION_ACTION_TYPE.UPDATE_CONTEXT, this.getContext());
    }

    private getAnimationDuration(): number {
        return this.options.animationDuration ?? DEFAULT_OPTIONS.animationDuration;
    }

    private getAnimationStagger(): number {
        return this.options.animationStagger ?? DEFAULT_OPTIONS.animationStagger;
    }

    private getNow(): number {
        return this.options.now?.() ?? DEFAULT_OPTIONS.now();
    }

    private generateId(): string {
        return (this.options.idGenerator ?? DEFAULT_OPTIONS.idGenerator)();
    }

    private cloneMessage(message: AnimatedCardMessage): AnimatedCardMessage {
        return {
            ...message,
            content: { ...message.content },
            animation: { ...message.animation }
        };
    }

    private cloneMemory(record: CardConversationMemory): CardConversationMemory {
        return {
            ...record,
            content:
                typeof record.content === 'string'
                    ? record.content
                    : { ...record.content },
            metadata: record.metadata ? { ...record.metadata } : undefined
        };
    }
}
