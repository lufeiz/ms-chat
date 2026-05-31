import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationStore } from '../../src/v2/store/ConversationStore';
import { MsgInputStore } from '../../src/v2/store/MsgInputStore';
import { ConfigStore } from '../../src/v2/store/ConfigStore';
import { ChatStore } from '../../src/v2/store/ChatStore';
import { resetDevMode, setDevMode } from '../../src/v2/core/devMode';
import type { Conversation } from '../../src/model';

const conv = (id: string, status = 0): Conversation => ({
  conversationId: id,
  name: id,
  status,
});

afterEach(() => {
  resetDevMode();
  vi.restoreAllMocks();
});

describe('ConversationStore', () => {
  it('adds and rejects duplicates', () => {
    setDevMode(false); // 静默 devWarn
    const store = new ConversationStore();
    expect(store.add(conv('a'))).toBe(true);
    expect(store.add(conv('a'))).toBe(false);
    expect(store.getSnapshot().data).toHaveLength(1);
  });

  it('tracks current and clears it on removal', () => {
    const store = new ConversationStore();
    store.add(conv('a'));
    store.add(conv('b'));
    const onCurrent = vi.fn();
    store.on('conversation:current', onCurrent);

    store.setCurrent('a');
    expect(store.getCurrent()?.conversationId).toBe('a');
    expect(onCurrent).toHaveBeenLastCalledWith(
      expect.objectContaining({ conversationId: 'a' }),
    );

    store.remove('a');
    expect(store.getCurrent()).toBeNull();
    expect(onCurrent).toHaveBeenLastCalledWith(null);
  });

  it('update keeps current in sync', () => {
    const store = new ConversationStore();
    store.add(conv('a'));
    store.setCurrent('a');
    store.update('a', { name: 'renamed' });
    expect(store.getCurrent()?.name).toBe('renamed');
  });

  it('init notifies conversation:current subscribers when it clears a selection', () => {
    const store = new ConversationStore();
    store.add(conv('a'));
    store.setCurrent('a');
    const onCurrent = vi.fn();
    store.on('conversation:current', onCurrent);
    store.init([conv('b')]);
    expect(store.getCurrent()).toBeNull();
    expect(onCurrent).toHaveBeenCalledWith(null);
  });

  it('init does not emit conversation:current when there was no selection', () => {
    const store = new ConversationStore();
    store.add(conv('a'));
    const onCurrent = vi.fn();
    store.on('conversation:current', onCurrent);
    store.init([conv('b')]); // current 本就为 null，不应多余 emit
    expect(onCurrent).not.toHaveBeenCalled();
  });

  it('getByStatus filters', () => {
    const store = new ConversationStore();
    store.add(conv('a', 1));
    store.add(conv('b', 2));
    expect(store.getByStatus(1).map((c) => c.conversationId)).toEqual(['a']);
  });
});

describe('MsgInputStore', () => {
  it('set / get / init; get does not emit', () => {
    const store = new MsgInputStore();
    const onSet = vi.fn();
    store.on('msgInput:set', onSet);
    store.set({ query: 'hello' });
    expect(store.get()).toEqual({ query: 'hello' });
    expect(onSet).toHaveBeenCalledOnce();

    store.get(); // 读不应 emit
    expect(onSet).toHaveBeenCalledOnce();

    store.init();
    expect(store.get()).toEqual({ query: '' });
  });
});

describe('ConfigStore', () => {
  it('init / get / query', () => {
    const store = new ConfigStore({ header: { hidden: false, options: {} } });
    expect(store.query('header')).toEqual({ hidden: false, options: {} });
    store.init({ welcome: { hidden: true, options: {} as never } });
    expect(store.query('header')).toBeUndefined();
  });

  it('update merges immutably', () => {
    const store = new ConfigStore({ header: { hidden: false, options: {} } });
    const before = store.get();
    store.update('header', { hidden: true });
    expect(store.get()).not.toBe(before);
    expect(store.query('header')?.hidden).toBe(true);
  });

  it('remove deletes a key', () => {
    const store = new ConfigStore({ header: { hidden: false, options: {} } });
    store.remove('header');
    expect(store.query('header')).toBeUndefined();
  });
});

describe('ChatStore', () => {
  it('composes sub-stores and an isolated registry', () => {
    const a = new ChatStore<string>();
    const b = new ChatStore<string>();
    a.registry.register('text', 'A-Text');
    expect(b.registry.has('text')).toBe(false); // 实例隔离（修 E1）

    a.messages.add({ id: 'm1', type: 'text', content: 'hi' });
    expect(a.messages.getSnapshot().data).toHaveLength(1);
    expect(b.messages.getSnapshot().data).toHaveLength(0);
  });

  it('passes config through to the ConfigStore', () => {
    const store = new ChatStore({
      config: { header: { hidden: true, options: {} } },
    });
    expect(store.config.query('header')?.hidden).toBe(true);
  });

  it('destroy clears listeners and registry', () => {
    const store = new ChatStore<string>();
    const onChanged = vi.fn();
    store.messages.on('changed', onChanged);
    store.registry.register('text', 'X');
    store.destroy();
    store.messages.add({ id: 'm', type: 'text', content: 'hi' });
    expect(onChanged).not.toHaveBeenCalled();
    expect(store.registry.size).toBe(0);
  });
});
