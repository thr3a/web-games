import { useState } from 'react';

// 使い方
// <ButtonCopy content='内容' label='コピー' />
// <ButtonCopy content='内容' /> でアイコンのみ

export function ButtonCopy({ content, label }: { content: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 500);
  };

  return (
    <button type='button' onClick={handleCopy}>
      {label ? label : copied ? '✓' : '📋'}
    </button>
  );
}
