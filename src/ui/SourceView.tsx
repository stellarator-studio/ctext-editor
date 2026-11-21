/**
 * Raw cText text editing (CodeMirror). Leaving this mode re-parses the text
 * into the structured editor; undo history of the structured editor is reset
 * only if the text actually changed.
 */
import { useEffect, useRef } from 'preact/hooks';
import { EditorView, basicSetup } from 'codemirror';
import { Decoration, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { scheduleSave, setSourceTextGetter } from '../app/state';

const tagMatcher = new MatchDecorator({
  regexp: /<\/?(scanbegin|scanend|scanbreak|scanskip|seq|entity)\b[^>]*>|<[^>]+>|\{\{\{|\}\}\}|\{\{|\}\}|[{}【】〖〗|]/g,
  decoration: (m) => Decoration.mark({ class: m[1] ? `cm-ct-${m[1]}` : 'cm-ct-sym' }),
});
const highlightTags = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = tagMatcher.createDeco(view);
    }
    update(u: ViewUpdate) {
      this.decorations = tagMatcher.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

export function SourceView({ initial, onLeave }: { initial: string; onLeave: (text: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const cm = new EditorView({
      doc: initial,
      parent: ref.current!,
      extensions: [
        basicSetup,
        EditorView.lineWrapping,
        highlightTags,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) scheduleSave();
        }),
      ],
    });
    setSourceTextGetter(() => cm.state.doc.toString());
    const leave = () => onLeave(cm.state.doc.toString());
    document.addEventListener('ct-leave-source', leave);
    cm.focus();
    return () => {
      document.removeEventListener('ct-leave-source', leave);
      cm.destroy();
    };
  }, []);
  return (
    <div class="source-wrap">
      <p class="muted pad-x">原始 cText 文字。可直接修改標籤；切回「所見即所得」時重新解析。</p>
      <div ref={ref} class="cm-host" />
    </div>
  );
}
