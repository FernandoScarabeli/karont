// Níveis de movimento (Fluid Functionalism). Os mesmos números estão em
// styles/tokens.css como --k-motion-*. Mantenha os dois lados iguais.

export const MOTION_MS = {
  fast: 80,
  moderate: 160,
  slow: 240,
} as const;

export const MOTION_EXIT_MS = {
  fast: 60,
  moderate: 120,
  slow: 160,
} as const;
