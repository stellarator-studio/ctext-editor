/**
 * Protection for <seq sid/> anchors (translation alignment).
 *
 * Invariant: the document always contains exactly the original seq anchors,
 * with unchanged sids, in the original relative order. Position may change.
 *
 * - Edits that delete seqs (delete, cut, typing over a selection) are allowed,
 *   and appendTransaction puts the deleted seqs back where the deleted range
 *   collapsed. One mechanism covers every input path.
 * - During IME composition the restore is deferred until compositionend:
 *   changing the DOM mid-composition breaks the IME (leaves stray 注音 behind).
 * - Transactions that add seqs, change a sid, or reorder seqs (e.g. dragging a
 *   seq past its neighbour) are rejected by filterTransaction.
 * - Pasted seqs are stripped by pasteGuard (paste.ts).
 */
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Mapping } from 'prosemirror-transform';

interface SeqAt {
  sid: string;
  pos: number;
  node: PMNode;
}
type Pending = { pos: number; node: PMNode }[];
type Meta = 'bypass' | 'restore' | { defer: Pending } | 'flushed';

export const seqGuardKey = new PluginKey<Pending>('seqGuard');

export function seqsOf(doc: PMNode): SeqAt[] {
  const out: SeqAt[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'seq') out.push({ sid: node.attrs.sid, pos, node });
    return node.isBlock; // don't descend into inline nodes
  });
  return out;
}

/** True if `after` only contains sids from `before` (respecting counts) in the same relative order. */
export function isOrderedSubset(before: string[], after: string[]): boolean {
  let i = 0;
  for (const sid of after) {
    while (i < before.length && before[i] !== sid) i++;
    if (i === before.length) return false;
    i++;
  }
  return true;
}

/** Insert seq nodes, grouped by position, preserving their order within a group. */
function insertSeqs(tr: Transaction, items: Pending): Transaction {
  const groups = new Map<number, PMNode[]>();
  for (const { pos, node } of items) groups.set(pos, [...(groups.get(pos) ?? []), node]);
  for (const [at, nodes] of [...groups].sort((a, b) => b[0] - a[0])) tr.insert(Math.min(at, tr.doc.content.size), nodes);
  return tr;
}

export function seqGuard(): Plugin<Pending> {
  let composing = false;

  const flush = (view: EditorView) => {
    const pending = seqGuardKey.getState(view.state) ?? [];
    if (!pending.length) return;
    const tr = insertSeqs(view.state.tr, pending).setMeta(seqGuardKey, 'flushed' satisfies Meta);
    view.dispatch(tr.setMeta('addToHistory', true));
  };

  return new Plugin<Pending>({
    key: seqGuardKey,
    state: {
      init: () => [],
      apply(tr, pending) {
        const meta = tr.getMeta(seqGuardKey) as Meta | undefined;
        if (meta === 'flushed') return [];
        const mapped = pending.map((p) => ({ pos: tr.mapping.map(p.pos, -1), node: p.node }));
        return meta && typeof meta === 'object' ? [...mapped, ...meta.defer] : mapped;
      },
    },
    filterTransaction(tr, state) {
      if (!tr.docChanged) return true;
      const meta = tr.getMeta(seqGuardKey) as Meta | undefined;
      if (meta === 'bypass' || meta === 'flushed') return true;
      return isOrderedSubset(
        seqsOf(state.doc).map((s) => s.sid),
        seqsOf(tr.doc).map((s) => s.sid),
      );
    },
    appendTransaction(trs, oldState, newState) {
      if (!trs.some((t) => t.docChanged)) return null;
      const remaining = new Map<string, number>();
      for (const s of seqsOf(newState.doc)) remaining.set(s.sid, (remaining.get(s.sid) ?? 0) + 1);
      const missing = seqsOf(oldState.doc).filter((s) => {
        const c = remaining.get(s.sid) ?? 0;
        if (c > 0) {
          remaining.set(s.sid, c - 1);
          return false;
        }
        return true;
      });
      if (!missing.length) return null;

      const mapping = new Mapping();
      for (const t of trs) for (const m of t.mapping.maps) mapping.appendMap(m);
      const items = missing.map((s) => ({ pos: mapping.map(s.pos, -1), node: s.node.mark([]) }));
      if (composing) return newState.tr.setMeta(seqGuardKey, { defer: items } satisfies Meta);
      return insertSeqs(newState.tr, items).setMeta(seqGuardKey, 'restore' satisfies Meta);
    },
    props: {
      handleDOMEvents: {
        compositionstart() {
          composing = true;
          return false;
        },
        compositionend(view) {
          composing = false;
          // Let ProseMirror finish reading the composition first.
          setTimeout(() => flush(view), 0);
          return false;
        },
      },
    },
  });
}

/**
 * Backspace/Delete next to a seq with an empty selection: step over it instead
 * of deleting it (deletion would just be restored, leaving the user stuck).
 */
export function stepOverSeq(dir: -1 | 1): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void) => {
    const sel = state.selection;
    if (!sel.empty) return false;
    let pos = sel.from;
    let moved = false;
    for (;;) {
      const $p = state.doc.resolve(pos);
      const n = dir < 0 ? $p.nodeBefore : $p.nodeAfter;
      if (n?.type.name !== 'seq') break;
      pos += dir * n.nodeSize;
      moved = true;
    }
    if (!moved) return false;
    dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, pos)));
    return true;
  };
}
