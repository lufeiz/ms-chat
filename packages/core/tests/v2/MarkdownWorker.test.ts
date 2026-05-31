import '@vitest/web-worker';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownWorkerClient } from '../../src/v2/workers/MarkdownWorker';
import type { WorkerResponse } from '../../src/v2/workers/protocol';
import type { MarkdownMeta } from '../../src/v2/workers/markdownParser';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const EMPTY_META: MarkdownMeta = { headings: [], codeBlocks: 0 };

/**
 * 可控假 Worker，驱动 client 编排逻辑（并发/coalesce/cancel/dispose/崩溃/分发）。
 * 解析正确性由 markdownParser.test.ts 覆盖；真实 worker 端到端由下方单个 smoke 用例覆盖。
 * （@vitest/web-worker 反复 create/terminate 真实 worker 存在跨用例状态污染，故编排用假 worker。）
 */
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: Array<{ kind: string; seq: number; source?: string; options?: unknown }> = [];
  terminated = false;

  postMessage(msg: any): void {
    this.posted.push(msg);
  }
  terminate(): void {
    this.terminated = true;
  }
  respond(seq: number, html = '<p>ok</p>', meta = EMPTY_META): void {
    this.onmessage?.({ data: { kind: 'result', seq, html, meta } as WorkerResponse } as MessageEvent);
  }
  crash(message: string): void {
    this.onerror?.(new ErrorEvent('error', { message }));
  }
}

/** 创建一个用假 worker 的 client，并返回创建出的 fake 列表（含重建）。 */
function withFakeWorkers(
  opts: { poolSize?: number; coalesce?: boolean } = {},
): { client: MarkdownWorkerClient; created: FakeWorker[] } {
  const created: FakeWorker[] = [];
  const client = new MarkdownWorkerClient({
    ...opts,
    workerFactory: () => {
      const w = new FakeWorker();
      created.push(w);
      return w as unknown as Worker;
    },
  });
  return { client, created };
}

describe('MarkdownWorkerClient', () => {
  it('end-to-end: parses through a real worker and returns html + meta', async () => {
    const client = new MarkdownWorkerClient();
    const r = await client.parse({
      id: 'm1',
      source: '# Title\n\n```js\nconst a = 1;\n```',
    });
    expect(r.id).toBe('m1');
    expect(r.html).toContain('Title');
    expect(r.meta.headings).toEqual([{ level: 1, text: 'Title' }]);
    expect(r.meta.codeBlocks).toBe(1);
    client.dispose();
  });

  it('resolves with the user id echoed back', async () => {
    const { client, created } = withFakeWorkers();
    const p = client.parse({ id: 'msg-42', source: 'x' });
    created[0].respond(created[0].posted[0].seq, '<p>x</p>');
    const r = await p;
    expect(r).toEqual({ id: 'msg-42', html: '<p>x</p>', meta: EMPTY_META });
    client.dispose();
  });

  it('handles concurrent distinct ids without crosstalk', async () => {
    const { client, created } = withFakeWorkers({ poolSize: 2, coalesce: false });
    const pa = client.parse({ id: 'a', source: 'a' }); // → worker 0
    const pb = client.parse({ id: 'b', source: 'b' }); // → worker 1
    created[0].respond(created[0].posted[0].seq, '<p>a</p>');
    created[1].respond(created[1].posted[0].seq, '<p>b</p>');
    expect((await pa).html).toBe('<p>a</p>');
    expect((await pb).html).toBe('<p>b</p>');
    client.dispose();
  });

  it('coalesce: a new request for the same id cancels the in-flight one', async () => {
    const { client, created } = withFakeWorkers({ coalesce: true });
    const p1 = client.parse({ id: 'x', source: 'first' });
    const rejection = expect(p1).rejects.toThrow(/cancelled/);
    const p2 = client.parse({ id: 'x', source: 'second' }); // 取消 p1
    await rejection;
    // 用第二次请求的 seq 回应
    const seq2 = created[0].posted[1].seq;
    created[0].respond(seq2, '<p>second</p>');
    expect((await p2).html).toBe('<p>second</p>');
    client.dispose();
  });

  it('cancel(id) rejects the in-flight request with AbortError', async () => {
    const { client } = withFakeWorkers();
    const p = client.parse({ id: 'a', source: 'a' });
    const rejection = expect(p).rejects.toMatchObject({ name: 'AbortError' });
    client.cancel('a');
    await rejection;
    client.dispose();
  });

  it('ignores a stale result that arrives after cancel', async () => {
    const { client, created } = withFakeWorkers();
    const p = client.parse({ id: 'a', source: 'a' });
    const rejection = expect(p).rejects.toMatchObject({ name: 'AbortError' });
    const seq = created[0].posted[0].seq;
    client.cancel('a');
    await rejection;
    // 过时结果到达——不应抛错、不应有未处理状态
    expect(() => created[0].respond(seq)).not.toThrow();
    client.dispose();
  });

  it('dispose rejects in-flight and subsequent parses', async () => {
    const { client } = withFakeWorkers();
    const p = client.parse({ id: 'a', source: 'a' });
    const rejection = expect(p).rejects.toThrow(/disposed/);
    client.dispose();
    await rejection;
    await expect(client.parse({ id: 'b', source: 'x' })).rejects.toThrow(
      /disposed/,
    );
  });

  it('round-robins requests across the pool', () => {
    const { client, created } = withFakeWorkers({ poolSize: 2, coalesce: false });
    client.parse({ id: 'a', source: 'a' }).catch(() => {});
    client.parse({ id: 'b', source: 'b' }).catch(() => {});
    expect(created[0].posted).toHaveLength(1);
    expect(created[1].posted).toHaveLength(1);
    client.dispose();
  });

  it('passes parse options through to the worker', () => {
    const { client, created } = withFakeWorkers();
    client
      .parse({ id: 'a', source: 'x', options: { streamingMode: true } })
      .catch(() => {});
    expect(created[0].posted[0].options).toEqual({ streamingMode: true });
    client.dispose();
  });

  it('a worker crash rejects only its own in-flight requests and respawns it', async () => {
    const { client, created } = withFakeWorkers({ poolSize: 2, coalesce: false });
    const pa = client.parse({ id: 'a', source: 'a' }); // → worker 0
    const pb = client.parse({ id: 'b', source: 'b' }); // → worker 1
    const rejection = expect(pa).rejects.toThrow(/boom/);

    created[0].crash('boom'); // 仅 worker 0 崩溃
    await rejection;

    created[1].respond(created[1].posted[0].seq, '<p>b</p>'); // worker 1 不受影响
    expect((await pb).html).toBe('<p>b</p>');

    expect(created[0].terminated).toBe(true);
    expect(created.length).toBe(3); // 2 初始 + 1 重建，池容量保持
    client.dispose();
  });

  describe('SSR fallback (no Worker)', () => {
    it('parses on the main thread with the same API', async () => {
      vi.stubGlobal('Worker', undefined);
      const client = new MarkdownWorkerClient();
      expect(client.isFallback()).toBe(true);
      const r = await client.parse({ id: 'a', source: '# Title' });
      expect(r.id).toBe('a');
      expect(r.html).toContain('<h1');
      expect(r.meta.headings).toEqual([{ level: 1, text: 'Title' }]);
      client.dispose();
    });
  });
});
