import type { DotConfig } from './database';
import { TERMINAL_DOT_ID } from './builtinDots';

type ProjectAuthorization = { id: string; origin: string };
type GrantLookup = (projectId: string, dotId: string) => boolean;

export function dotAllowedInProject(
  dot: Pick<DotConfig, 'id' | 'projectIds' | 'source'>,
  project: ProjectAuthorization,
  hasGrant: GrantLookup,
) {
  if (dot.source === 'builtin' || dot.source === 'detected' || dot.source === 'custom') return true;
  // Compatibilidade com Dots criados por código legado e com o Terminal explicitamente
  // redefinido em dots.json.
  if (dot.id === TERMINAL_DOT_ID) return true;
  if (project.origin === 'config') return dot.projectIds.includes(project.id);
  return hasGrant(project.id, dot.id);
}
