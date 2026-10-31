import { useEffect, useRef, useState } from 'react';
import { Bot, Settings, Workflow } from 'lucide-react';
import type { useWorkspaceData } from './useWorkspaceData';

type Props = { data: ReturnType<typeof useWorkspaceData> };

export function SidebarFooter({ data }: Props) {
  const { setPage } = data;
  const [userName, setUserName] = useState('Perfil local');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void window.karont
      .systemUser()
      .then(({ name }) => {
        if (active && name.trim()) setUserName(name.trim());
      })
      .catch(() => {
        if (active) setUserName('Perfil local');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  function openPage(page: 'settings' | 'agents' | 'automations') {
    setMenuOpen(false);
    setPage(page);
  }

  return (
    <footer className="k-sidebar-footer ks-sidebar-footer">
      <div className="ks-profile-row">
        <span className="ks-avatar" aria-hidden="true">
          {userName.slice(0, 1).toLocaleUpperCase() || 'P'}
        </span>
        <span className="ks-profile-name" title={userName}>
          {userName}
        </span>
        <div className="ks-profile-menu" ref={menuRef}>
          <button
            className="ks-icon-button ks-settings-button"
            type="button"
            title="Configurações e ferramentas"
            aria-label="Configurações e ferramentas"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Settings aria-hidden="true" />
          </button>
          {menuOpen && (
            <div className="ks-settings-menu" role="menu" aria-label="Configurações e ferramentas">
              <button type="button" role="menuitem" onClick={() => openPage('settings')}>
                <Settings aria-hidden="true" />
                Configurações e ferramentas
              </button>
              <button type="button" role="menuitem" onClick={() => openPage('agents')}>
                <Bot aria-hidden="true" />
                Agentes
              </button>
              <button type="button" role="menuitem" onClick={() => openPage('automations')}>
                <Workflow aria-hidden="true" />
                Automações
              </button>
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
