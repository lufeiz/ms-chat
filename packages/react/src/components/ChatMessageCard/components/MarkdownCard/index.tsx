import React, { useMemo } from 'react';
import MarkdownPreview from '@uiw/react-markdown-preview';
import rehypeSanitize from 'rehype-sanitize';
import type { IMarkdownCardProps } from '../../../../types/index';

// 安全：@uiw/react-markdown-preview 默认带 rehype-raw（渲染原始 HTML）且不消毒。
// 插入 rehype-sanitize（在 rehype-raw 之后、语法高亮 rehype-prism 之前执行），
// 剥离 <script>/on* 事件/javascript: 等危险节点，防止 LLM/用户内容造成 XSS。
const rehypePlugins = [rehypeSanitize];

const MarkdownCard: React.FC<IMarkdownCardProps> = (props) => {
  const { content, bubbleCardMdExt } = props;
  const contentArray = useMemo(() => {
    if (!content) return [];
    return Array.isArray(content) ? content : [{ content }];
  }, [content]);

  return (
    <div className="chat-bubble-content-markdown">
      {contentArray.map((item, idx) => (
        <div key={idx}>
          {item.type && bubbleCardMdExt ? (
            bubbleCardMdExt(props)
          ) : (
            <MarkdownPreview
              source={item.content}
              rehypePlugins={rehypePlugins}
              style={{
                backgroundColor: 'transparent',
                padding: 0,
                fontSize: '14px',
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
};

export default MarkdownCard;
