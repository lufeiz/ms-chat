import { parseMarkdown } from './markdownParser';
import type { WorkerRequest, WorkerResponse } from './protocol';

/**
 * Markdown 解析 Worker。无状态：逐条处理 parse 请求，解析后回显 `seq`。
 * 不引入任何 React/Vue/DOM 依赖——仅纯解析（markdownParser）。
 *
 * 本地最小化声明 worker 作用域，避免引入 `webworker` lib 与项目的 `DOM` lib 冲突。
 */
declare const self: {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
  close: () => void;
};

function post(res: WorkerResponse): void {
  self.postMessage(res);
}

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const msg = event.data;

  if (msg.kind === 'dispose') {
    self.close();
    return;
  }

  if (msg.kind === 'parse') {
    try {
      const { html, meta } = parseMarkdown(msg.source, msg.options);
      post({ kind: 'result', seq: msg.seq, html, meta });
    } catch (err) {
      post({
        kind: 'error',
        seq: msg.seq,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
};
