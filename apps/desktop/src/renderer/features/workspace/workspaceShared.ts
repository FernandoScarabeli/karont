import {
  Folder,
  CodeXml,
  Globe,
  Terminal,
  Layers,
  Briefcase,
  BookOpen,
  Rocket,
} from 'lucide-react';
import type { UiNavigation } from '../../lib/api';

export const projectIcons = {
  folder: Folder,
  'code-xml': CodeXml,
  globe: Globe,
  terminal: Terminal,
  layers: Layers,
  briefcase: Briefcase,
  'book-open': BookOpen,
  rocket: Rocket,
};

export const iconLabels = [
  'Pasta',
  'Código',
  'Web',
  'Terminal',
  'Camadas',
  'Trabalho',
  'Livro',
  'Foguete',
];

export const activeState = (state: string) => !['completed', 'failed', 'cancelled'].includes(state);

let overviewRequestQueue: Promise<void> = Promise.resolve();

export function overviewRequest<T>(
  request: () => Promise<T>,
  isActive: () => boolean = () => true,
) {
  const run = () =>
    isActive() ? request() : Promise.reject(new Error('A contagem deixou de estar visível.'));
  const result = overviewRequestQueue.then(run, run);
  overviewRequestQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function formatActivityLabel(updatedAt: number) {
  const elapsed = Math.max(0, Date.now() - updatedAt);
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(elapsed / 3600000);
  if (hours < 24) return `${hours} h`;
  if (hours < 48) return 'ontem';
  const days = Math.floor(elapsed / 86400000);
  if (days < 7) return `${days} dias`;
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' })
    .format(new Date(updatedAt))
    .replace(' de ', ' ');
}

export const emptyNavigation: UiNavigation = { workspaceId: null, projectId: null, chatId: null };

export async function allPages<T>(
  fetch: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>,
  isActive: () => boolean = () => true,
) {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    if (!isActive()) break;
    const page = await fetch(cursor);
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && isActive());
  return items;
}
