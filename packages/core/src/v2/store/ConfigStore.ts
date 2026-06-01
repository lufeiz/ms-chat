import { EventEmitter, type EmitterOptions } from '../core/EventEmitter';
import type { ChatConfig } from '../../model';

export type ConfigStoreEvents = {
  'config:init': [config: ChatConfig];
  'config:update': [key: keyof ChatConfig, value: unknown];
  'config:delete': [key: keyof ChatConfig];
};

/**
 * 配置 store v2。读操作（get/query）不 emit（修 H9）；写操作走不可变复制。
 */
export class ConfigStore extends EventEmitter<ConfigStoreEvents> {
  private config: ChatConfig;

  constructor(initial: ChatConfig = {}, options: EmitterOptions = {}) {
    super(options);
    this.config = initial;
  }

  init(config: ChatConfig): void {
    this.config = config;
    this.emit('config:init', config);
  }

  get(): ChatConfig {
    return this.config;
  }

  query<K extends keyof ChatConfig>(key: K): ChatConfig[K] | undefined {
    return this.config[key];
  }

  update<K extends keyof ChatConfig>(
    key: K,
    value: Partial<ChatConfig[K]>,
  ): void {
    this.config = {
      ...this.config,
      [key]: { ...this.config[key], ...value },
    };
    this.emit('config:update', key, value);
  }

  remove<K extends keyof ChatConfig>(key: K): void {
    const next = { ...this.config };
    delete next[key];
    this.config = next;
    this.emit('config:delete', key);
  }
}
