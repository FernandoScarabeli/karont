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

export const emptyNavigation: UiNavigation = { workspaceId: null, projectId: null, chatId: null };

export async function allPages<T>(
  fetch: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>,
) {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetch(cursor);
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}
