import type { HTMLAttributes } from 'react';

type Props = HTMLAttributes<HTMLSpanElement> & { label?: string };

export function LiveMoon({ label = 'Rodando', className = '', ...props }: Props) {
  return (
    <span
      {...props}
      className={`ks-live-moon ${className}`.trim()}
      role="img"
      aria-label={label}
      title={label}
    >
      <span className="ks-live-moon-orb" />
      <span className="ks-live-moon-reflection ks-live-moon-reflection-long" />
      <span className="ks-live-moon-reflection ks-live-moon-reflection-short" />
    </span>
  );
}
