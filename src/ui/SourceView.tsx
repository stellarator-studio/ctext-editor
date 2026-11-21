/**
 * Raw cText text editing (CodeMirror). Leaving this mode re-parses the text
 * into the structured editor; undo history of the structured editor is reset
 * only if the text actually changed.
 */
import { useEffect, useRef } from 'preact/hooks';
import { EditorView, basicSetup } from 'codemirror';
import { Decoration, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import { findBar, scheduleSave, setSourceTextGetter, sourceSearch, sourceTick } from '../app/state';
import { selectionSeed } from './FindBar';

/** Find-bar highlights: all matches, plus the current one. */
const setFindHighlights = StateEffect.define<{ ranges: { from: number; to: number }[]; current: number }>();
const findHighlights = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setFindHighlights)) continue;
      const { ranges, current } = e.value;
      deco = Decoration.set(ranges.map((r, i) => Decoration.mark({ class: i === current ? 'cm-ct-find cm-ct-find-cur' : 'cm-ct-find' }).range(r.from, r.to)));
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

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
        findHighlights,
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          scheduleSave();
          sourceTick.value++;
        }),
      ],
    });
    setSourceTextGetter(() => cm.state.doc.toString());
    sourceSearch.value = {
      text: () => cm.state.doc.toString(),
      select: (from, to) => cm.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) }),
      highlight: (ranges, current) => cm.dispatch({ effects: setFindHighlights.of({ ranges, current }) }),
      replace: (changes) => cm.dispatch({ changes, userEvent: 'input.replace' }),
    };
    const leave = () => onLeave(cm.state.doc.toString());
    document.addEventListener('ct-leave-source', leave);
    cm.focus();
    return () => {
      document.removeEventListener('ct-leave-source', leave);
      sourceSearch.value = null;
      cm.destroy();
    };
  }, []);
  return (
    <div class="source-wrap">
      <div class="row tight pad-x">
        <span class="muted grow">原始 cText 文字。可直接修改標籤；切回「所見即所得」時重新解析。</span>
        <button onClick={() => (findBar.value = { replace: false, seed: selectionSeed() })} title="搜尋與取代整份原始文字 (Ctrl+F / Ctrl+H)">
          搜尋
        </button>
      </div>
      <div ref={ref} class="cm-host" />
    </div>
  );
}
