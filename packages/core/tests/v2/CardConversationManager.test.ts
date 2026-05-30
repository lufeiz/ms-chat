import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardConversationManager } from '../../src/v2/managers/CardConversationManager';
import { resetDevMode, setDevMode } from '../../src/v2/core/devMode';
import type { CardContent } from '../../src/model';

const card = (text: string): CardContent => ({ type: 'info', content: text });

let idCounter = 0;
const makeManager = (opts = {}) =>
  new CardConversationManager({
    now: () => 1000,
    idGenerator: () => `card-${idCounter++}`,
    ...opts,
  });

beforeEach(() => {
  idCounter = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  resetDevMode();
  vi.restoreAllMocks();
});

describe('CardConversationManager', () => {
  it('adds a card in entering phase and emits card:add', () => {
    const m = makeManager();
    const onAdd = vi.fn();
    m.on('card:add', onAdd);
    const msg = m.addCard(card('hello'));
    expect(msg.animation.phase).toBe('entering');
    expect(msg.type).toBe('card');
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('transitions entering → visible after delay + duration', () => {
    const m = makeManager();
    const onAnim = vi.fn();
    m.on('card:animation', onAnim);
    m.addCard(card('hi'), { delay: 0, duration: 100 });
    expect(m.getMessages()[0].animation.phase).toBe('entering');
    vi.advanceTimersByTime(100);
    expect(m.getMessages()[0].animation.phase).toBe('visible');
    expect(m.getMessages()[0].animation.enteredAt).toBe(1000);
    expect(onAnim).toHaveBeenCalled();
  });

  describe('reference stability (§2.0)', () => {
    it('getMessages returns the same reference until a mutation', () => {
      const m = makeManager();
      m.addCard(card('a'), { delay: 0, duration: 10 });
      const a = m.getMessages();
      const b = m.getMessages();
      expect(a).toBe(b);
      m.addCard(card('b'), { delay: 0, duration: 10 });
      expect(m.getMessages()).not.toBe(a);
    });

    it('getContext is cached until a mutation', () => {
      const m = makeManager();
      m.addCard(card('a'), { delay: 0, duration: 10 });
      const c1 = m.getContext();
      expect(m.getContext()).toBe(c1);
      m.rememberText('user said hi');
      expect(m.getContext()).not.toBe(c1);
    });
  });

  it('updateCard replaces content and returns false on missing id', () => {
    const m = makeManager();
    const msg = m.addCard(card('old'), { id: 'c1' });
    expect(msg.id).toBe('c1');
    expect(m.updateCard('c1', card('new'))).toBe(true);
    expect((m.getMessages()[0].content as CardContent).content).toBe('new');
    expect(m.updateCard('missing', card('x'))).toBe(false);
  });

  it('markLeaving flips the phase', () => {
    const m = makeManager();
    m.addCard(card('a'), { id: 'c1', delay: 0, duration: 10 });
    expect(m.markLeaving('c1')).toBe(true);
    expect(m.getMessages()[0].animation.phase).toBe('leaving');
  });

  it('rememberText records user input as lastUserInput', () => {
    const m = makeManager();
    m.rememberText('hello there', { role: 'user' });
    expect(m.getContext().lastUserInput).toBe('hello there');
  });

  it('enforces the memory limit', () => {
    const m = makeManager({ memoryLimit: 2 });
    m.addCard(card('a'));
    m.addCard(card('b'));
    m.addCard(card('c'));
    expect(m.getMemory()).toHaveLength(2);
  });

  it('reset clears messages and pending timers', () => {
    const m = makeManager();
    m.addCard(card('a'), { delay: 0, duration: 100 });
    expect(m.pendingTimers).toBe(1);
    m.reset();
    expect(m.getMessages()).toHaveLength(0);
    expect(m.pendingTimers).toBe(0);
  });

  it('destroy stops further animation emits', () => {
    const m = makeManager();
    const onAnim = vi.fn();
    m.on('card:animation', onAnim);
    m.addCard(card('a'), { delay: 0, duration: 100 });
    m.destroy();
    vi.advanceTimersByTime(100);
    expect(onAnim).not.toHaveBeenCalled();
  });

  it('freezes snapshots in dev mode', () => {
    setDevMode(true);
    const m = makeManager();
    m.addCard(card('a'), { delay: 0, duration: 10 });
    expect(Object.isFrozen(m.getMessages())).toBe(true);
  });
});
