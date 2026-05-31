import { EventEmitter } from '../event';

// ─── 类型定义 ───

export type CommandHandler = (ctx: CommandExecutionContext) => void | Promise<void>;

export type PanelAnimationPhase = 'hidden' | 'opening' | 'visible' | 'closing';

export interface CommandItem {
    id: string;
    label: string;
    description?: string;
    icon?: string;
    category?: string;
    keywords?: string[];
    shortcut?: string;
    disabled?: boolean;
    hidden?: boolean;
    handler: CommandHandler;
}

export interface CommandExecutionContext {
    commandId: string;
    inputValue: string;
    query: string;
    timestamp: number;
}

export interface CommandGroup {
    category: string;
    commands: CommandItem[];
}

export interface PanelAnimationState {
    phase: PanelAnimationPhase;
    duration: number;
    direction: 'up' | 'down';
    startedAt?: number;
}

export interface CommandToolboxState {
    visible: boolean;
    animation: PanelAnimationState;
    filteredCommands: CommandItem[];
    groups: CommandGroup[];
    activeIndex: number;
    query: string;
    triggerChar: string;
}

export interface CommandToolboxOptions {
    triggerChar?: string;
    animationDuration?: number;
    animationDirection?: 'up' | 'down';
    maxVisible?: number;
    debounceFilter?: number;
    now?: () => number;
}

export enum COMMAND_TOOLBOX_ACTION_TYPE {
    OPEN = 'commandToolbox:open',
    CLOSE = 'commandToolbox:close',
    ANIMATION_CHANGE = 'commandToolbox:animationChange',
    FILTER = 'commandToolbox:filter',
    NAVIGATE = 'commandToolbox:navigate',
    SELECT = 'commandToolbox:select',
    EXECUTE = 'commandToolbox:execute',
    REGISTER = 'commandToolbox:register',
    UNREGISTER = 'commandToolbox:unregister',
    STATE_CHANGE = 'commandToolbox:stateChange',
}

// ─── 默认配置 ───

const DEFAULT_OPTIONS: Required<CommandToolboxOptions> = {
    triggerChar: '/',
    animationDuration: 220,
    animationDirection: 'up',
    maxVisible: 8,
    debounceFilter: 100,
    now: () => Date.now(),
};

// ─── 管理器 ───

export class CommandToolboxManager extends EventEmitter {
    private commands: Map<string, CommandItem> = new Map();
    private filteredCommands: CommandItem[] = [];
    private activeIndex = 0;
    private query = '';
    private visible = false;
    private animation: PanelAnimationState;
    private options: Required<CommandToolboxOptions>;
    private filterTimer: ReturnType<typeof setTimeout> | null = null;
    private animationTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(options: CommandToolboxOptions = {}) {
        super();
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.animation = {
            phase: 'hidden',
            duration: this.options.animationDuration,
            direction: this.options.animationDirection,
        };
    }

    // ─── 命令注册 ───

    register(command: CommandItem): void {
        this.commands.set(command.id, command);
        this.emit(COMMAND_TOOLBOX_ACTION_TYPE.REGISTER, { ...command });
        if (this.visible) {
            this.applyFilter(this.query);
        }
    }

    registerMany(commands: CommandItem[]): void {
        commands.forEach((cmd) => this.register(cmd));
    }

    unregister(commandId: string): boolean {
        const existed = this.commands.delete(commandId);
        if (existed) {
            this.emit(COMMAND_TOOLBOX_ACTION_TYPE.UNREGISTER, commandId);
            if (this.visible) {
                this.applyFilter(this.query);
            }
        }
        return existed;
    }

    getCommand(commandId: string): CommandItem | undefined {
        const cmd = this.commands.get(commandId);
        return cmd ? { ...cmd } : undefined;
    }

    getAllCommands(): CommandItem[] {
        return [...this.commands.values()].map((c) => ({ ...c }));
    }

    // ─── 输入检测 ───

    handleInput(value: string): boolean {
        const { triggerChar } = this.options;

        if (value.startsWith(triggerChar)) {
            const query = value.slice(triggerChar.length);
            this.query = query;
            if (!this.visible) {
                this.open();
            }
            this.scheduleFilter(query);
            return true;
        }

        if (this.visible) {
            this.close();
        }
        return false;
    }

    // ─── 面板动画控制 ───

    open(): void {
        if (this.visible) return;

        this.clearAnimationTimer();
        this.visible = true;
        this.activeIndex = 0;
        this.applyFilter(this.query);

        this.setAnimation('opening');
        this.emit(COMMAND_TOOLBOX_ACTION_TYPE.OPEN, this.getState());

        this.animationTimer = setTimeout(() => {
            this.setAnimation('visible');
        }, this.options.animationDuration);
    }

    close(): void {
        if (!this.visible) return;

        this.clearAnimationTimer();
        // 取消挂起的 debounce filter，否则它可能在关闭后 fire 并用旧 query 回填隐藏态
        this.clearFilterTimer();

        this.setAnimation('closing');
        this.emit(COMMAND_TOOLBOX_ACTION_TYPE.CLOSE, this.getState());

        this.animationTimer = setTimeout(() => {
            this.visible = false;
            this.query = '';
            this.filteredCommands = [];
            this.activeIndex = 0;
            this.setAnimation('hidden');
        }, this.options.animationDuration);
    }

    toggle(): void {
        if (this.visible) {
            this.close();
        } else {
            this.query = '';
            this.open();
        }
    }

    // ─── 键盘导航 ───

    navigateUp(): void {
        if (!this.visible || this.filteredCommands.length === 0) return;
        this.activeIndex =
            (this.activeIndex - 1 + this.filteredCommands.length) %
            this.filteredCommands.length;
        this.emitNavigate();
    }

    navigateDown(): void {
        if (!this.visible || this.filteredCommands.length === 0) return;
        this.activeIndex =
            (this.activeIndex + 1) % this.filteredCommands.length;
        this.emitNavigate();
    }

    navigateTo(index: number): void {
        if (!this.visible) return;
        if (index < 0 || index >= this.filteredCommands.length) return;
        this.activeIndex = index;
        this.emitNavigate();
    }

    selectActive(): CommandItem | null {
        if (!this.visible || this.filteredCommands.length === 0) return null;
        const command = this.filteredCommands[this.activeIndex];
        if (!command || command.disabled) return null;

        this.emit(COMMAND_TOOLBOX_ACTION_TYPE.SELECT, { ...command });
        this.executeCommand(command);
        this.close();
        return { ...command };
    }

    selectById(commandId: string): CommandItem | null {
        const command = this.commands.get(commandId);
        if (!command || command.disabled) return null;

        this.emit(COMMAND_TOOLBOX_ACTION_TYPE.SELECT, { ...command });
        this.executeCommand(command);
        this.close();
        return { ...command };
    }

    handleKeydown(key: string): boolean {
        if (!this.visible) return false;

        switch (key) {
            case 'ArrowUp':
                this.navigateUp();
                return true;
            case 'ArrowDown':
                this.navigateDown();
                return true;
            case 'Enter':
                this.selectActive();
                return true;
            case 'Escape':
                this.close();
                return true;
            default:
                return false;
        }
    }

    // ─── 状态查询 ───

    getState(): CommandToolboxState {
        return {
            visible: this.visible,
            animation: { ...this.animation },
            filteredCommands: this.filteredCommands.map((c) => ({ ...c })),
            groups: this.buildGroups(this.filteredCommands),
            activeIndex: this.activeIndex,
            query: this.query,
            triggerChar: this.options.triggerChar,
        };
    }

    isVisible(): boolean {
        return this.visible;
    }

    getAnimationPhase(): PanelAnimationPhase {
        return this.animation.phase;
    }

    getActiveCommand(): CommandItem | null {
        const cmd = this.filteredCommands[this.activeIndex];
        return cmd ? { ...cmd } : null;
    }

    // ─── 清理 ───

    reset(): void {
        this.clearAnimationTimer();
        this.clearFilterTimer();
        this.commands.clear();
        this.filteredCommands = [];
        this.activeIndex = 0;
        this.query = '';
        this.visible = false;
        this.animation = {
            phase: 'hidden',
            duration: this.options.animationDuration,
            direction: this.options.animationDirection,
        };
        this.emitStateChange();
    }

    destroy(): void {
        this.reset();
    }

    // ─── 内部方法 ───

    private executeCommand(command: CommandItem): void {
        const ctx: CommandExecutionContext = {
            commandId: command.id,
            inputValue: `${this.options.triggerChar}${this.query}`,
            query: this.query,
            timestamp: this.options.now(),
        };

        try {
            command.handler(ctx);
        } catch (err) {
            // noop — 由消费方自行处理异常
        }

        this.emit(COMMAND_TOOLBOX_ACTION_TYPE.EXECUTE, {
            command: { ...command },
            context: ctx,
        });
    }

    private scheduleFilter(query: string): void {
        this.clearFilterTimer();
        if (this.options.debounceFilter <= 0) {
            this.applyFilter(query);
            return;
        }
        this.filterTimer = setTimeout(() => {
            this.applyFilter(query);
        }, this.options.debounceFilter);
    }

    private applyFilter(query: string): void {
        const q = query.toLowerCase().trim();
        const all = [...this.commands.values()].filter((c) => !c.hidden);

        if (!q) {
            this.filteredCommands = all.slice(0, this.options.maxVisible);
        } else {
            this.filteredCommands = all
                .filter((cmd) => this.matchCommand(cmd, q))
                .slice(0, this.options.maxVisible);
        }

        this.activeIndex = Math.min(
            this.activeIndex,
            Math.max(0, this.filteredCommands.length - 1),
        );

        this.emit(COMMAND_TOOLBOX_ACTION_TYPE.FILTER, {
            query: this.query,
            results: this.filteredCommands.map((c) => ({ ...c })),
        });
        this.emitStateChange();
    }

    private matchCommand(cmd: CommandItem, q: string): boolean {
        if (cmd.label.toLowerCase().includes(q)) return true;
        if (cmd.description?.toLowerCase().includes(q)) return true;
        if (cmd.id.toLowerCase().includes(q)) return true;
        if (cmd.keywords?.some((k) => k.toLowerCase().includes(q))) return true;
        return false;
    }

    private buildGroups(commands: CommandItem[]): CommandGroup[] {
        const map = new Map<string, CommandItem[]>();
        for (const cmd of commands) {
            const cat = cmd.category ?? '';
            if (!map.has(cat)) {
                map.set(cat, []);
            }
            map.get(cat)!.push({ ...cmd });
        }
        return [...map.entries()].map(([category, items]) => ({
            category,
            commands: items,
        }));
    }

    private setAnimation(phase: PanelAnimationPhase): void {
        this.animation = {
            ...this.animation,
            phase,
            startedAt: phase === 'opening' || phase === 'closing'
                ? this.options.now()
                : this.animation.startedAt,
        };
        this.emit(COMMAND_TOOLBOX_ACTION_TYPE.ANIMATION_CHANGE, {
            ...this.animation,
        });
        this.emitStateChange();
    }

    private emitNavigate(): void {
        this.emit(COMMAND_TOOLBOX_ACTION_TYPE.NAVIGATE, {
            activeIndex: this.activeIndex,
            activeCommand: this.getActiveCommand(),
        });
        this.emitStateChange();
    }

    private emitStateChange(): void {
        this.emit(COMMAND_TOOLBOX_ACTION_TYPE.STATE_CHANGE, this.getState());
    }

    private clearFilterTimer(): void {
        if (this.filterTimer !== null) {
            clearTimeout(this.filterTimer);
            this.filterTimer = null;
        }
    }

    private clearAnimationTimer(): void {
        if (this.animationTimer !== null) {
            clearTimeout(this.animationTimer);
            this.animationTimer = null;
        }
    }
}
