import React from 'react';
import type { IMsChatProps } from '../../types';
import ChatH5 from '../ChatH5/index';
import { useChatPanel } from '../hooks/useChatPanel';
import './index.less';

// 内联 SVG data URI 作默认头像：离线可用、不泄露内网地址。可经 bubbleOptions.iconBgUrl 覆盖。
const defaultIconBgUrl =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' rx='8' fill='%238568fe'/%3E%3Ctext x='20' y='25' font-family='sans-serif' font-size='15' font-weight='bold' text-anchor='middle' fill='white'%3EAI%3C/text%3E%3C/svg%3E";

const ChatBubble: React.FC<IMsChatProps> = (props) => {
  const { bubbleOptions, ...chatProps } = props;

  const { visible, toggleChat, rect } = useChatPanel();

  return (
    <div>
      <div
        className="chat-toggle"
        style={{
          backgroundImage: `url(${
            bubbleOptions?.iconBgUrl || defaultIconBgUrl
          })`,
        }}
        onClick={toggleChat}
        aria-label="打开对话"
      >
        {bubbleOptions?.iconTitle}
      </div>
      {visible && (
        <ChatH5
          draggable={true}
          draggableOptions={{
            showCloseButton: true,
            initialPosition: { x: rect.x, y: rect.y },
            initialSize: { width: rect.w, height: rect.h },
            minSize: { width: 375, height: 667 },
            onClose: toggleChat,
          }}
          {...chatProps}
        />
      )}
    </div>
  );
};

export default ChatBubble;
