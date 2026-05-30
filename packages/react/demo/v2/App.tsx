import { useMemo, useRef, useState } from 'react';
import { ChatStore } from '@ms-chat/core/v2';
import { constructTextMessage, constructMarkdownMessage } from '@ms-chat/core';
import { useMessages } from './useChatStoreV2';

/**
 * v2 验证 demo：用 `@ms-chat/core/v2` 的 ChatStore 跑通一个最小聊天回路，
 * 演示引用稳定订阅 + 流式更新。不依赖 antd / 业务接口，自包含可独立运行。
 */
export default function App() {
  const store = useMemo(() => new ChatStore(), []);
  const { data: messages, version } = useMessages(store);
  const [input, setInput] = useState('');
  const idRef = useRef(0);

  const send = () => {
    const text = input.trim();
    if (!text) return;

    store.messages.add(
      constructTextMessage(text, { id: `u${idRef.current++}`, role: 'user' }),
    );

    // 模拟流式助手回复：先插一条空 markdown，再逐字 update（同 id 触发更新）
    const aid = `a${idRef.current++}`;
    store.messages.add(constructMarkdownMessage('', { id: aid, role: 'system' }));
    const reply = `收到：**${text}** ✅ —— v2 引用稳定 + 流式更新演示`;
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      store.messages.update(aid, { content: reply.slice(0, i) });
      if (i >= reply.length) clearInterval(timer);
    }, 25);

    setInput('');
  };

  return (
    <div
      style={{
        maxWidth: 560,
        margin: '40px auto',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h2 style={{ marginBottom: 4 }}>@ms-chat/core v2 · React 验证 demo</h2>
      <p style={{ color: '#888', marginTop: 0, fontSize: 13 }}>
        snapshot version: <b data-testid="version">{version}</b> · 消息数{' '}
        <b data-testid="count">{messages.length}</b>
      </p>

      <div
        data-testid="messages"
        style={{
          border: '1px solid #eee',
          borderRadius: 8,
          padding: 12,
          minHeight: 240,
          background: '#fafafa',
        }}
      >
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              margin: '8px 0',
              textAlign: m.role === 'user' ? 'right' : 'left',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                background: m.role === 'user' ? '#d6e4ff' : '#f0f0f0',
                padding: '6px 10px',
                borderRadius: 8,
                maxWidth: '80%',
              }}
            >
              {typeof m.content === 'string'
                ? m.content
                : JSON.stringify(m.content)}
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input
          data-testid="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="输入消息后回车 / 点发送…"
          style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #ddd' }}
        />
        <button
          data-testid="send"
          onClick={send}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: 'none',
            background: '#1677ff',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          发送
        </button>
      </div>
    </div>
  );
}
