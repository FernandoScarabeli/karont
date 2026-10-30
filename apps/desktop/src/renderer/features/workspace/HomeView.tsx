import type { RefObject } from 'react';
import { ArrowUp, CornerDownLeft, Plus } from 'lucide-react';

type Props = {
  page: string;
  draft: string;
  setDraft: (draft: string) => void;
  draftRef: RefObject<HTMLTextAreaElement | null>;
  newChat: (projectId?: string | null, seed?: string) => Promise<void>;
  busy: boolean;
  loading: boolean;
  greeting: string;
};

export function HomeView({
  page,
  draft,
  setDraft,
  draftRef,
  newChat,
  busy,
  loading,
  greeting,
}: Props) {
  return (
    <>
      {page === 'home' && (
        <section className="k-home">
          <div className="k-home-content">
            <h1>{loading ? 'Abrindo seu workspace…' : `${greeting}.`}</h1>
            <form
              className={`k-composer ${draft ? 'has-draft' : ''}`}
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim()) void newChat(null, draft);
              }}
            >
              <textarea
                ref={draftRef}
                aria-label="Nova ideia"
                placeholder="Vamos começar uma nova ideia?"
                value={draft}
                maxLength={8000}
                aria-invalid={new TextEncoder().encode(draft).byteLength > 8000}
                aria-describedby="home-draft-limit"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    if (draft.trim()) void newChat(null, draft);
                  }
                }}
              />
              <div className="k-composer-actions">
                <button
                  type="button"
                  className="k-icon"
                  title="Anexos ainda não disponíveis neste adaptador"
                  aria-label="Adicionar contexto — em breve"
                  disabled
                >
                  <Plus />
                </button>
                <button
                  className="k-icon k-send"
                  title="Abrir conversa com este rascunho"
                  aria-label="Abrir conversa com este rascunho"
                  disabled={
                    !draft.trim() ||
                    busy ||
                    loading ||
                    new TextEncoder().encode(draft).byteLength > 8000
                  }
                >
                  <ArrowUp size={18} />
                </button>
              </div>
              <span
                id="home-draft-limit"
                className={
                  new TextEncoder().encode(draft).byteLength > 8000 ? 'k-form-error' : 'sr-only'
                }
                role="status"
              >
                {new TextEncoder().encode(draft).byteLength > 8000
                  ? 'Limite de 8.000 bytes excedido. Reduza o texto para continuar.'
                  : 'Limite de 8.000 bytes.'}
              </span>
              {!draft && (
                <div className="k-suggestions">
                  {['Explorar uma ideia', 'Planejar os próximos passos', 'Revisar um texto'].map(
                    (text) => (
                      <button
                        type="button"
                        key={text}
                        onClick={() => {
                          setDraft(text);
                          draftRef.current?.focus();
                        }}
                      >
                        <span>{text}</span>
                        <CornerDownLeft size={12} />
                      </button>
                    ),
                  )}
                </div>
              )}
            </form>
          </div>
        </section>
      )}
    </>
  );
}
