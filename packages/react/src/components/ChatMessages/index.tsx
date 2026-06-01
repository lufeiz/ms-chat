import React from 'react';
import List from './components/List/index';
import Empty from './components/Empty/index';
import { ChatListContext } from './contexts';
import { useChatList } from './hooks/useChatList';
import type { IChatMessagesProps } from '../../types/index';
import './index.less';

const ChatMessages: React.FC<IChatMessagesProps> = ({
  data,
  config,
  ...scopeSlots
}) => {
  const store = useChatList({ data, config });

  return (
    <ChatListContext.Provider value={store}>
      {/* role=log + aria-live=polite：流式助手回复会被读屏增量播报（无障碍） */}
      <div
        className="chat-message-list"
        role="log"
        aria-live="polite"
        aria-label="对话消息列表"
      >
        <List {...scopeSlots} />
        <Empty />
      </div>
    </ChatListContext.Provider>
  );
};

export default ChatMessages;


