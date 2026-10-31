import type { ReactNode } from 'react';

export function formatHomeDate() {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).formatToParts(new Date());
  const weekday = (parts.find((part) => part.type === 'weekday')?.value ?? '').replace(
    /-feira$/,
    '',
  );
  const day = parts.find((part) => part.type === 'day')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const capitalized = weekday ? `${weekday[0].toLocaleUpperCase('pt-BR')}${weekday.slice(1)}` : '';
  return `${capitalized}, ${day} de ${month}`;
}

export function HomeHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <header className="kw-workspace-heading">
      <h1>{title}</h1>
      <div className="kw-workspace-summary">
        <time dateTime={new Date().toISOString()}>{formatHomeDate()}</time>
        {children}
      </div>
    </header>
  );
}
