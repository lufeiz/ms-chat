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

    it('init copies the incoming array (prod mode) so later caller mutation cannot leak in', () => {
      setDevMode(false); // 走 prod 分支（dev 分支本就 slice+freeze）
      const store = new MessageStore();
      const external = [text('a'), text('b')];
      store.init(external);
      external.push(text('c')); // 调用方事后篡改外部数组
      expect(store.getSnapshot().data).toHaveLength(2); // 不应泄漏进快照
    });
  });

  describe('emit timing', () => {
    it('add emits message:add (sync) and changed (after flush)', () => {
      const store = new MessageStore();
      const onAdd = vi.fn();
      const onChanged = vi.fn();
      store.on('message:add', onAdd);
      store.on('changed', onChanged);
      const msg = text('a');
      store.add(msg);
      expect(onAdd).toHaveBeenCalledWith(msg); // 细粒度事件同步
      expect(onChanged).not.toHaveBeenCalled(); // changed 批处理：尚未派发
      store.flush();
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

  describe('microtask batching (P3-1)', () => {
    const tick = () => Promise.resolve();

    it('coalesces a sync burst of adds into a single changed (but N message:add)', async () => {
      const store = new MessageStore();
      const onAdd = vi.fn();
      const onChanged = vi.fn();
      store.on('message:add', onAdd);
      store.on('changed', onChanged);
      store.add(text('a'));
      store.add(text('b'));
      store.add(text('c'));
      expect(onAdd).toHaveBeenCalledTimes(3); // 细粒度同步
      expect(onChanged).not.toHaveBeenCalled(); // 尚未派发
      await tick();
      expect(onChanged).toHaveBeenCalledOnce(); // 合并成一次
    });

    it('getSnapshot is up to date synchronously, before the changed fires', () => {
      const store = new MessageStore();
      store.add(text('a'));
      store.add(text('b'));
      // 读不延迟：mutate 后立即可见最新
      expect(store.getSnapshot().data.map((m) => m.id)).toEqual(['a', 'b']);
    });

    it('flush() makes changed observable immediately', () => {
      const store = new MessageStore();
      const onChanged = vi.fn();
      store.on('changed', onChanged);
      store.add(text('a'));
      store.flush();
      expect(onChanged).toHaveBeenCalledOnce();
    });

    it('add then remove in one tick → one changed, correct final snapshot', async () => {
      const store = new MessageStore();
      const onChanged = vi.fn();
      store.on('changed', onChanged);
      store.add(text('a'));
      store.add(text('b'));
      store.remove('a');
      await tick();
      expect(onChanged).toHaveBeenCalledOnce();
      expect(store.getSnapshot().data.map((m) => m.id)).toEqual(['b']);
    });

    it('destroy() cancels the pending changed and stops further emits', async () => {
      const store = new MessageStore();
      const onChanged = vi.fn();
      store.on('changed', onChanged);
      store.add(text('a')); // 排了一个 changed
      store.destroy(); // 取消挂起 + 移除监听
      await tick();
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

  describe('bounded growth (S2 maxSize)', () => {
    it('trims oldest items from the head when exceeding maxSize', () => {
      const store = new MessageStore({ maxSize: 3 });
      store.add(text('a'));
      store.add(text('b'));
      store.add(text('c'));
      store.add(text('d')); // 超界 → 'a' 被裁剪
      expect(store.getSnapshot().data.map((m) => m.id)).toEqual([
        'b',
        'c',
        'd',
      ]);
    });

    it('addMany respects maxSize', () => {
      const store = new MessageStore({ maxSize: 2 });
      store.addMany([text('a'), text('b'), text('c')]);
      expect(store.getSnapshot().data.map((m) => m.id)).toEqual(['b', 'c']);
    });

    it('maxSize unset (default) keeps everything', () => {
      const store = new MessageStore();
      for (let i = 0; i < 50; i++) store.add(text(`m${i}`));
      expect(store.getSnapshot().data).toHaveLength(50);
    });
  });

  describe('streaming update fast path (S2)', () => {
    it('updates the last message correctly (hot path)', () => {
      const store = new MessageStore();
      store.add(text('u1', 'user'));
      store.add(text('a1', ''));
      store.update('a1', { content: 'streaming…' } as Partial<Message>);
      expect((store.get('a1') as TextMessage).content).toBe('streaming…');
      expect((store.get('u1') as TextMessage).content).toBe('user');
    });

    it('still updates a non-last message via fallback findIndex', () => {
      const store = new MessageStore();
      store.add(text('a', 'old'));
      store.add(text('b', 'keep'));
      expect(store.update('a', { content: 'new' } as Partial<Message>)).toBe(
        true,
      );
      expect((store.get('a') as TextMessage).content).toBe('new');
      expect((store.get('b') as TextMessage).content).toBe('keep');
    });

    it('keeps immutability: new array + element ref per update', () => {
      const store = new MessageStore();
      store.add(text('a', 'x'));
      const before = store.getSnapshot();
      store.update('a', { content: 'y' } as Partial<Message>);
      const after = store.getSnapshot();
      expect(after.data).not.toBe(before.data);
      expect(after.data[0]).not.toBe(before.data[0]);
    });
  });
});
