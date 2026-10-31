import type { HTMLAttributes } from 'react';

type Props = HTMLAttributes<HTMLSpanElement> & { label?: string };

export function AttentionDot({ label = 'Precisa de você', className = '', ...props }: Props) {
  return (
    <span
      {...props}
      className={`ks-attention-dot ${className}`.trim()}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}
