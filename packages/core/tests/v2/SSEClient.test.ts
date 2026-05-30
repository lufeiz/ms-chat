import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SSEClient } from '../../src/v2/transport/SSEClient';

const URL = 'https://example.test/chat';

/** 构造一个 text/event-stream Response，按 `data: <chunk>\n\n` 逐条发送后关闭。 */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(encoder.encode(`data: ${c}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** 构造一个发送一条后保持打开（不关闭）的流，用于测试 disconnect。 */
function openSseResponse(firstChunk: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${firstChunk}\n\n`));
      // 不 close：模拟长连接
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function errorResponse(status: number): Response {
  return new Response('error', {
    status,
    headers: { 'content-type': 'text/plain' },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SSEClient', () => {
  it('streams POST chunks to onMessage and resolves on close', async () => {
    mockFetch.mockResolvedValue(sseResponse(['{"v":1}', '{"v":2}', '{"v":3}']));
    const onMessage = vi.fn();
    const onClose = vi.fn();
    const client = new SSEClient<{ v: number }>();

    await client.connect(
      { url: URL, method: 'POST', body: { q: 'hi' } },
      { onMessage, onClose },
    );

    expect(onMessage).toHaveBeenCalledTimes(3);
    expect(onMessage).toHaveBeenNthCalledWith(1, { v: 1 }, expect.anything());
    expect(onMessage).toHaveBeenNthCalledWith(3, { v: 3 }, expect.anything());
    expect(onClose).toHaveBeenCalledOnce();
    expect(client.isActive()).toBe(false);
  });

  describe('request shaping (H3)', () => {
    it('GET carries no body; method/headers reach fetch', async () => {
      mockFetch.mockResolvedValue(sseResponse(['{"v":1}']));
      const client = new SSEClient();
      await client.connect(
        { url: URL, method: 'GET', headers: { 'x-token': 'abc' } },
        { onMessage: vi.fn() },
      );
      const [, init] = mockFetch.mock.calls[0];
      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();
      expect(init.headers['x-token']).toBe('abc');
    });

    it('POST with no body does not send the string "undefined"', async () => {
      mockFetch.mockResolvedValue(sseResponse(['{"v":1}']));
      const client = new SSEClient();
      await client.connect({ url: URL, method: 'POST' }, { onMessage: vi.fn() });
      expect(mockFetch.mock.calls[0][1].body).toBeUndefined();
    });

    it('POST serializes the body object', async () => {
      mockFetch.mockResolvedValue(sseResponse(['{"v":1}']));
      const client = new SSEClient();
      await client.connect(
        { url: URL, method: 'POST', body: { q: 1 } },
        { onMessage: vi.fn() },
      );
      expect(mockFetch.mock.calls[0][1].body).toBe('{"q":1}');
    });

    it('re-evaluates a headers function on every connect', async () => {
      // 每次返回新流：ReadableStream 只能被消费一次
      mockFetch.mockImplementation(() => sseResponse(['{"v":1}']));
      let n = 0;
      const headersFn = vi.fn(() => ({ 'x-token': String(++n) }));
      const client = new SSEClient();
      await client.connect({ url: URL, headers: headersFn }, { onMessage: vi.fn() });
      await client.connect({ url: URL, headers: headersFn }, { onMessage: vi.fn() });
      expect(headersFn).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][1].headers['x-token']).toBe('1');
      expect(mockFetch.mock.calls[1][1].headers['x-token']).toBe('2');
    });
  });

  describe('reuse (H1)', () => {
    it('can connect again after disconnect', async () => {
      mockFetch.mockImplementation(() => sseResponse(['{"v":1}']));
      const client = new SSEClient<{ v: number }>();

      const onMessage1 = vi.fn();
      await client.connect({ url: URL }, { onMessage: onMessage1 });
      expect(onMessage1).toHaveBeenCalledOnce();

      client.disconnect();

      const onMessage2 = vi.fn();
      await client.connect({ url: URL }, { onMessage: onMessage2 });
      expect(onMessage2).toHaveBeenCalledOnce();
    });
  });

  describe('disconnect', () => {
    it('aborts an open stream and resolves without calling onError', async () => {
      mockFetch.mockResolvedValue(openSseResponse('{"v":1}'));
      const onError = vi.fn();
      const onMessage = vi.fn();
      const client = new SSEClient();

      const p = client.connect({ url: URL }, { onMessage, onError });
      await sleep(20); // 让首条消息到达
      client.disconnect();
      await p;

      expect(onMessage).toHaveBeenCalledOnce();
      expect(onError).not.toHaveBeenCalled();
      expect(client.isActive()).toBe(false);
    });
  });

  describe('reconnect (H2)', () => {
    it('retries after a 5xx and succeeds', async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse(500))
        .mockResolvedValueOnce(sseResponse(['{"v":1}']));
      const onMessage = vi.fn();
      const onReconnect = vi.fn();
      const client = new SSEClient<{ v: number }>();

      await client.connect(
        {
          url: URL,
          reconnect: { enabled: true, backoff: [1], maxRetries: 3 },
        },
        { onMessage, onReconnect },
      );

      expect(onReconnect).toHaveBeenCalledWith(1);
      expect(onMessage).toHaveBeenCalledWith({ v: 1 }, expect.anything());
    });

    it('rejects and calls onError after exhausting maxRetries', async () => {
      mockFetch.mockResolvedValue(errorResponse(500));
      const onError = vi.fn();
      const onReconnect = vi.fn();
      const client = new SSEClient();

      await expect(
        client.connect(
          {
            url: URL,
            reconnect: { enabled: true, backoff: [1], maxRetries: 2 },
          },
          { onMessage: vi.fn(), onError, onReconnect },
        ),
      ).rejects.toBeTruthy();

      expect(onReconnect).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.calls[0][1]).toBe(3); // retryCount at failure
    });

    it('does not retry when reconnect is disabled', async () => {
      mockFetch.mockResolvedValue(errorResponse(500));
      const onError = vi.fn();
      const client = new SSEClient();

      await expect(
        client.connect({ url: URL }, { onMessage: vi.fn(), onError }),
      ).rejects.toBeTruthy();

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(onError).toHaveBeenCalledOnce();
    });
  });

  describe('JSON parsing', () => {
    it('strictJSON (default) drops a malformed chunk but keeps valid ones', async () => {
      mockFetch.mockResolvedValue(sseResponse(['not-json', '{"v":2}']));
      const onMessage = vi.fn();
      const client = new SSEClient<{ v: number }>();
      await client.connect({ url: URL }, { onMessage });
      expect(onMessage).toHaveBeenCalledOnce();
      expect(onMessage).toHaveBeenCalledWith({ v: 2 }, expect.anything());
    });

    it('strictJSON: false passes the raw string through', async () => {
      mockFetch.mockResolvedValue(sseResponse(['not-json']));
      const onMessage = vi.fn();
      const client = new SSEClient<string>();
      await client.connect({ url: URL, strictJSON: false }, { onMessage });
      expect(onMessage).toHaveBeenCalledWith('not-json', expect.anything());
    });
  });
});
