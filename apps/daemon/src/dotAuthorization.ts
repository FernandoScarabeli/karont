import type { DotConfig } from './database';
import { TERMINAL_DOT_ID } from './builtinDots';

type ProjectAuthorization = { id: string; origin: string };
type GrantLookup = (projectId: string, dotId: string) => boolean;

export function dotAllowedInProject(
  dot: Pick<DotConfig, 'id' | 'projectIds'>,
  project: ProjectAuthorization,
  hasGrant: GrantLookup,
) {
  if (dot.id === TERMINAL_DOT_ID) return true;
  if (project.origin === 'config') return dot.projectIds.includes(project.id);
  return hasGrant(project.id, dot.id);
}
