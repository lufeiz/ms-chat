import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageStore } from '../../src/v2/store/MessageStore';
import { resetDevMode, setDevMode } from '../../src/v2/core/devMode';
import type { Message, TextMessage } from '../../src/model';

const text = (id: string, content = 'hi'): TextMessage => ({
  id,
  type: 'text',
  content,
});

afterEach(() => {
  resetDevMode();
  vi.restoreAllMocks();
});

describe('MessageStore', () => {
  describe('reference stability (P1/§2.0)', () => {
    it('getSnapshot returns the same reference until a mutation', () => {
      const store = new MessageStore();
      const s1 = store.getSnapshot();
      const s2 = store.getSnapshot();
      expect(s1).toBe(s2); // 同引用

      store.add(text('a'));
      const s3 = store.getSnapshot();
      expect(s3).not.toBe(s1); // 变更后换新引用
      expect(s3.data).not.toBe(s1.data);
      expect(s3.version).toBe(s1.version + 1);
    });

    it('snapshot.data reflects the list', () => {
      const store = new MessageStore();
      store.add(text('a'));
      store.add(text('b'));
      expect(store.getSnapshot().data.map((m) => m.id)).toEqual(['a', 'b']);
    });
  });

  describe('emit timing', () => {
    it('add emits message:add and changed', () => {
      const store = new MessageStore();
      const onAdd = vi.fn();
      const onChanged = vi.fn();
      store.on('message:add', onAdd);
      store.on('changed', onChanged);
      const msg = text('a');
      store.add(msg);
      expect(onAdd).toHaveBeenCalledWith(msg);
      expect(onChanged).toHaveBeenCalledOnce();
    });

    it('remove on a missing id does NOT emit (fixes H6)', () => {
      const store = new MessageStore();
      store.add(text('a'));
      const onRemove = vi.fn();
      const onChanged = vi.fn();
      store.on('message:remove', onRemove);
      store.on('changed', onChanged);
      const result = store.remove('does-not-exist');
      expect(result).toBe(false);
      expect(onRemove).not.toHaveBeenCalled();
      expect(onChanged).not.toHaveBeenCalled();
    });

    it('remove on an existing id emits and returns true', () => {
      const store = new MessageStore();
      store.add(text('a'));
      const onRemove = vi.fn();
      store.on('message:remove', onRemove);
      expect(store.remove('a')).toBe(true);
      expect(onRemove).toHaveBeenCalledWith('a');
      expect(store.getSnapshot().data).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('updates by id and returns true; missing id returns false', () => {
      const store = new MessageStore();
      store.add(text('a', 'old'));
      expect(store.update('a', { content: 'new' } as Partial<Message>)).toBe(
        true,
      );
      expect((store.get('a') as TextMessage).content).toBe('new');
      expect(store.update('missing', { content: 'x' } as Partial<Message>)).toBe(
        false,
      );
    });

    it('update replaces the element immutably (new array, new element)', () => {
      const store = new MessageStore();
      store.add(text('a', 'old'));
      const before = store.getSnapshot();
      store.update('a', { content: 'new' } as Partial<Message>);
      const after = store.getSnapshot();
      expect(after.data).not.toBe(before.data);
      expect(after.data[0]).not.toBe(before.data[0]);
    });
  });

  describe('reads do not emit (fixes H9)', () => {
    it('get / getLatest / getByType are side-effect free', () => {
      const store = new MessageStore();
      store.add(text('a'));
      const onChanged = vi.fn();
      store.on('changed', onChanged);
      store.get('a');
      store.getLatest(1);
      store.getByType((m): m is TextMessage => m.type === 'text');
      expect(onChanged).not.toHaveBeenCalled();
    });
  });

  describe('queries', () => {
    it('getLatest returns the tail; <=0 returns empty', () => {
      const store = new MessageStore();
      store.addMany([text('a'), text('b'), text('c')]);
      expect(store.getLatest(2).map((m) => m.id)).toEqual(['b', 'c']);
      expect(store.getLatest(0)).toEqual([]);
    });

    it('getByType narrows', () => {
      const store = new MessageStore();
      store.add(text('a'));
      const texts = store.getByType((m): m is TextMessage => m.type === 'text');
      expect(texts).toHaveLength(1);
    });

    it('addMany with empty array is a no-op', () => {
      const store = new MessageStore();
      const onChanged = vi.fn();
      store.on('changed', onChanged);
      store.addMany([]);
      expect(onChanged).not.toHaveBeenCalled();
    });
  });

  describe('dev freeze (mutate-bypass guard)', () => {
    it('snapshot data is frozen in dev mode', () => {
      setDevMode(true);
      const store = new MessageStore();
      store.add(text('a'));
      const data = store.getSnapshot().data as Message[];
      expect(Object.isFrozen(data)).toBe(true);
      expect(() => data.push(text('b'))).toThrow();
    });
  });
});
