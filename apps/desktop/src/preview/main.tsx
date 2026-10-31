import { createWebBridge } from './webBridge';

const token =
  document.querySelector<HTMLMetaElement>('meta[name="karont-preview-token"]')?.content ?? '';

if (!token) {
  const root = document.querySelector<HTMLElement>('#root');
  if (root) root.textContent = 'Abra pelo `npm run preview:web`.';
} else {
  window.karont = createWebBridge(token);

  const badge = document.createElement('div');
  badge.textContent = 'Preview no navegador · dev';
  badge.style.cssText = [
    'position:fixed',
    'right:calc(var(--space-unit) * 2)',
    'bottom:calc(var(--space-unit) * 2)',
    'z-index:1',
    'pointer-events:none',
    'padding:calc(var(--space-unit) * 1) calc(var(--space-unit) * 2)',
    'border:1px solid var(--border-control)',
    'border-radius:var(--radius-control)',
    'background:var(--bg-sidebar)',
    'color:var(--text-secondary)',
    'font:500 11px var(--font-ui)',
    'white-space:nowrap',
  ].join(';');
  document.body.append(badge);

  await import('../renderer/main');
}
