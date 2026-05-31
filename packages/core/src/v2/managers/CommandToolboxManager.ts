import { isDevMode } from '../core/devMode';
import { IS_DEV } from '../core/env';
import type { Disposer } from '../core/EventEmitter';
import {
  BaseStatefulManager,
  type StatefulManagerOptions,
} from './BaseStatefulManager';

export type CommandHandler = (
  ctx: CommandExecutionContext,
) => void | Promise<void>;

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
  filteredCommands: ReadonlyArray<CommandItem>;
  groups: ReadonlyArray<CommandGroup>;
  activeIndex: number;
  query: string;
  triggerChar: string;
}

export interface CommandToolboxManagerOptions extends StatefulManagerOptions {
  triggerChar?: string;
  animationDuration?: number;
  animationDirection?: 'up' | 'down';
  maxVisible?: number;
  debounceFilter?: number;
}

export type CommandToolboxEvents = {
  'toolbox:open': [state: CommandToolboxState];
  'toolbox:close': [state: CommandToolboxState];
  'toolbox:animation': [animation: PanelAnimationState];
  'toolbox:filter': [
    payload: { query: string; results: ReadonlyArray<CommandItem> },
  ];
  'toolbox:navigate': [
    payload: { activeIndex: number; activeCommand: CommandItem | null },
  ];
  'toolbox:select': [command: CommandItem];
  'toolbox:execute': [
    payload: { command: CommandItem; context: CommandExecutionContext },
  ];
  'toolbox:register': [command: CommandItem];
  'toolbox:unregister': [commandId: string];
  'toolbox:state': [state: CommandToolboxState];
};

const DEFAULTS = {
  triggerChar: '/',
  animationDuration: 220,
  animationDirection: 'up' as const,
  maxVisible: 8,
  debounceFilter: 100,
};

/**
 * 命令面板管理器 v2（RFC §2.1.2，重写 v1 command-toolbox）。
 *
 * 相比 v1：继承 BaseStatefulManager（定时器统一托管）；getState 引用稳定
 * （按 version 缓存，替代 v1 每次重建 + 浅克隆每个 command，修 P5）；register 返回 disposer。
 */
export class CommandToolboxManager extends BaseStatefulManager<CommandToolboxEvents> {
  private commands = new Map<string, CommandItem>();
  private filteredCommands: CommandItem[] = [];
  private activeIndex = 0;
  private query = '';
  private visible = false;
  private animation: PanelAnimationState;

  private readonly triggerChar: string;
  private readonly animationDuration: number;
  private readonly maxVisible: number;
  private readonly debounceFilter: number;

  private filterTimer: ReturnType<typeof setTimeout> | null = null;
  private animationTimer: ReturnType<typeof setTimeout> | null = null;

  private version = 0;
  private cachedState: CommandToolboxState | null = null;

  constructor(options: CommandToolboxManagerOptions = {}) {
    super(options);
    this.triggerChar = options.triggerChar ?? DEFAULTS.triggerChar;
    this.animationDuration =
      options.animationDuration ?? DEFAULTS.animationDuration;
    this.maxVisible = options.maxVisible ?? DEFAULTS.maxVisible;
    this.debounceFilter = options.debounceFilter ?? DEFAULTS.debounceFilter;
    this.animation = {
      phase: 'hidden',
      duration: this.animationDuration,
      direction: options.animationDirection ?? DEFAULTS.animationDirection,
    };
  }

  // ─── 命令注册 ───

  register(command: CommandItem): Disposer {
    this.commands.set(command.id, command);
    this.bump();
    this.emit('toolbox:register', command);
    if (this.visible) this.applyFilter(this.query);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this.unregister(command.id);
    };
  }

  registerMany(commands: CommandItem[]): Disposer {
    const disposers = commands.map((c) => this.register(c));
    return () => disposers.forEach((d) => d());
  }

  unregister(commandId: string): boolean {
    const existed = this.commands.delete(commandId);
    if (existed) {
      this.bump();
      this.emit('toolbox:unregister', commandId);
      if (this.visible) this.applyFilter(this.query);
    }
    return existed;
  }

  getCommand(commandId: string): CommandItem | undefined {
    return this.commands.get(commandId);
  }

  getAllCommands(): CommandItem[] {
    return [...this.commands.values()];
  }

  // ─── 输入检测 ───

  handleInput(value: string): boolean {
    if (value.startsWith(this.triggerChar)) {
      this.query = value.slice(this.triggerChar.length);
      if (!this.visible) this.open();
      this.scheduleFilter(this.query);
      return true;
    }
    if (this.visible) this.close();
    return false;
  }

  // ─── 面板动画 ───

  open(): void {
    if (this.visible) return;
    if (this.animationTimer) this.clearTimer(this.animationTimer);
    this.visible = true;
    this.activeIndex = 0;
    this.applyFilter(this.query);
    this.setAnimation('opening');
    this.emit('toolbox:open', this.getState());
    this.animationTimer = this.schedule(
      () => this.setAnimation('visible'),
      this.animationDuration,
    );
  }

  close(): void {
    if (!this.visible) return;
    if (this.animationTimer) this.clearTimer(this.animationTimer);
    // 取消挂起的 debounce filter，否则它可能在关闭后 fire 并用旧 query 回填隐藏态
    if (this.filterTimer) this.clearTimer(this.filterTimer);
    this.setAnimation('closing');
    this.emit('toolbox:close', this.getState());
    this.animationTimer = this.schedule(() => {
      this.visible = false;
      this.query = '';
      this.filteredCommands = [];
      this.activeIndex = 0;
      this.setAnimation('hidden');
    }, this.animationDuration);
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
    this.activeIndex = (this.activeIndex + 1) % this.filteredCommands.length;
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
    this.emit('toolbox:select', command);
    this.executeCommand(command);
    this.close();
    return command;
  }

  selectById(commandId: string): CommandItem | null {
    const command = this.commands.get(commandId);
    if (!command || command.disabled) return null;
    this.emit('toolbox:select', command);
    this.executeCommand(command);
    this.close();
    return command;
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

  // ─── 状态查询（引用稳定）───

  getState(): CommandToolboxState {
    if (!this.cachedState) {
      const state: CommandToolboxState = {
        visible: this.visible,
        animation: this.animation,
        filteredCommands: this.filteredCommands,
        groups: this.buildGroups(this.filteredCommands),
        activeIndex: this.activeIndex,
        query: this.query,
        triggerChar: this.triggerChar,
      };
      this.cachedState = IS_DEV && isDevMode() ? Object.freeze(state) : state;
    }
    return this.cachedState;
  }

  isVisible(): boolean {
    return this.visible;
  }

  getAnimationPhase(): PanelAnimationPhase {
    return this.animation.phase;
  }

  getActiveCommand(): CommandItem | null {
    return this.filteredCommands[this.activeIndex] ?? null;
  }

  // ─── 清理 ───

  reset(): void {
    this.clearAllTimers();
    this.filterTimer = null;
    this.animationTimer = null;
    this.commands.clear();
    this.filteredCommands = [];
    this.activeIndex = 0;
    this.query = '';
    this.visible = false;
    this.animation = {
      phase: 'hidden',
      duration: this.animationDuration,
      direction: this.animation.direction,
    };
    this.bump();
    this.emit('toolbox:state', this.getState());
  }

  override destroy(): void {
    this.reset();
    super.destroy();
  }

  // ─── 内部 ───

  private executeCommand(command: CommandItem): void {
    const ctx: CommandExecutionContext = {
      commandId: command.id,
      inputValue: `${this.triggerChar}${this.query}`,
      query: this.query,
      timestamp: this.now(),
    };
    try {
      void command.handler(ctx);
    } catch {
      // 由消费方自行处理异常
    }
    this.emit('toolbox:execute', { command, context: ctx });
  }

  private scheduleFilter(query: string): void {
    if (this.filterTimer) this.clearTimer(this.filterTimer);
    if (this.debounceFilter <= 0) {
      this.applyFilter(query);
      return;
    }
    this.filterTimer = this.schedule(
      () => this.applyFilter(query),
      this.debounceFilter,
    );
  }

  private applyFilter(query: string): void {
    const q = query.toLowerCase().trim();
    const all = [...this.commands.values()].filter((c) => !c.hidden);
    this.filteredCommands = (
      q ? all.filter((cmd) => this.matchCommand(cmd, q)) : all
    ).slice(0, this.maxVisible);
    this.activeIndex = Math.min(
      this.activeIndex,
      Math.max(0, this.filteredCommands.length - 1),
    );
    this.bump();
    this.emit('toolbox:filter', {
      query: this.query,
      results: this.filteredCommands,
    });
    this.emit('toolbox:state', this.getState());
  }

  private matchCommand(cmd: CommandItem, q: string): boolean {
    if (cmd.label.toLowerCase().includes(q)) return true;
    if (cmd.description?.toLowerCase().includes(q)) return true;
    if (cmd.id.toLowerCase().includes(q)) return true;
    if (cmd.keywords?.some((k) => k.toLowerCase().includes(q))) return true;
    return false;
  }

  private buildGroups(commands: ReadonlyArray<CommandItem>): CommandGroup[] {
    const map = new Map<string, CommandItem[]>();
    for (const cmd of commands) {
      const cat = cmd.category ?? '';
      const bucket = map.get(cat);
      if (bucket) bucket.push(cmd);
      else map.set(cat, [cmd]);
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
      startedAt:
        phase === 'opening' || phase === 'closing'
          ? this.now()
          : this.animation.startedAt,
    };
    this.bump();
    this.emit('toolbox:animation', this.animation);
    this.emit('toolbox:state', this.getState());
  }

  private emitNavigate(): void {
    this.bump();
    this.emit('toolbox:navigate', {
      activeIndex: this.activeIndex,
      activeCommand: this.getActiveCommand(),
    });
    this.emit('toolbox:state', this.getState());
  }

  private bump(): void {
    this.version += 1;
    this.cachedState = null;
  }
}
