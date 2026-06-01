import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Sender from '../src/components/Sender/index';
import type { ISenderProps } from '../src/types/components-types';

function makeProps(over: Partial<ISenderProps['input']> = {}): ISenderProps {
  return {
    input: {
      pending: false,
      hidden: false,
      disabled: false,
      placeholder: '请输入',
      onfocus: () => {},
      query: 'hello',
      ...over,
    },
    onSendMsg: vi.fn(),
    onStopMsg: vi.fn(),
    onUpdateQuery: vi.fn(),
    onUploadFiles: vi.fn(),
  };
}

describe('Sender a11y (S4 regression net)', () => {
  it('send control is an accessible, focusable button', () => {
    render(<Sender {...makeProps()} />);
    const send = screen.getByRole('button', { name: '发送' });
    expect(send).toHaveAttribute('tabindex', '0');
    send.focus();
    expect(send).toHaveFocus(); // 裸 div 时不可能
  });

  it('upload control is an accessible button', () => {
    render(<Sender {...makeProps()} />);
    expect(screen.getByRole('button', { name: '上传文件' })).toBeInTheDocument();
  });

  it('textarea exposes an aria-label (from placeholder)', () => {
    render(<Sender {...makeProps({ placeholder: '问我' })} />);
    expect(screen.getByLabelText('问我')).toBeInTheDocument();
  });

  it('send marks aria-disabled when query is empty', () => {
    render(<Sender {...makeProps({ query: '' })} />);
    expect(screen.getByRole('button', { name: '发送' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('Enter on the send button triggers onSendMsg (keyboard activation)', () => {
    const props = makeProps();
    render(<Sender {...props} />);
    const send = screen.getByRole('button', { name: '发送' });
    fireEvent.keyDown(send, { key: 'Enter' });
    expect(props.onSendMsg).toHaveBeenCalledTimes(1);
  });

  it('Space on the send button triggers onSendMsg', () => {
    const props = makeProps();
    render(<Sender {...props} />);
    fireEvent.keyDown(screen.getByRole('button', { name: '发送' }), {
      key: ' ',
    });
    expect(props.onSendMsg).toHaveBeenCalledTimes(1);
  });

  it('shows an accessible stop button while pending', () => {
    const props = makeProps({ pending: true });
    render(<Sender {...props} />);
    const stop = screen.getByRole('button', { name: '停止' });
    fireEvent.keyDown(stop, { key: 'Enter' });
    expect(props.onStopMsg).toHaveBeenCalledTimes(1);
  });
});
