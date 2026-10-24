// Shared acceptance gate. A success flag alone never establishes a safe run.
export const unsafeFlags = [
  '--no-sandbox',
  '--disable-seccomp-filter-sandbox',
  '--disable-namespace-sandbox',
  '--disable-setuid-sandbox',
  '--disable-gpu-sandbox',
  '--single-process',
];
export function desktopValid(run) {
  const s = run?.sandbox;
  return (
    run?.passed === true &&
    s?.verified === true &&
    s.preferences?.sandbox === true &&
    s.preferences?.contextIsolation === true &&
    s.preferences?.nodeIntegration === false &&
    s.runtime?.sandboxed === true &&
    s.runtime?.contextIsolated === true &&
    s.kernel?.seccomp === 2 &&
    s.kernel?.noNewPrivs === 1 &&
    Number.isInteger(s.kernel?.pid) &&
    s.kernel.pid > 0 &&
    Array.isArray(s.launchArgs) &&
    s.launchArgs.length > 0 &&
    !s.launchArgs.some((arg) =>
      unsafeFlags.some((flag) => arg === flag || arg.startsWith(flag + '=')),
    )
  );
}
export function distribution(values) {
  if (!values.length || values.some((v) => !Number.isFinite(v)))
    throw Error('Amostras ausentes ou inválidas');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    samples: sorted.length,
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    min: sorted[0],
    max: sorted.at(-1),
  };
}
