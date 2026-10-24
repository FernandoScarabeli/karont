import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
export default function Editor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    const view = new EditorView({
      parent: ref.current!,
      doc: value,
      extensions: [
        basicSetup,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': 'Editor de teste' }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) change.current(update.state.doc.toString());
        }),
        EditorView.theme({
          '&': { height: '210px', backgroundColor: '#101513', color: '#dbe4db' },
          '.cm-content': { fontFamily: 'monospace' },
          '.cm-gutters': { backgroundColor: '#171d19', color: '#8e9d92', border: 'none' },
          '.cm-cursor': { borderLeftColor: '#c1df85' },
          '.cm-scroller': { overflow: 'auto' },
        }),
      ],
    });
    return () => view.destroy();
  }, []);
  return <div ref={ref} />;
}
