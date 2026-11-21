import type { Command } from 'prosemirror-state';

/**
 * Backspace/Delete next to an inline atom (page boundary, scanbreak, …) with an
 * empty selection deletes the atom. Deleting a page boundary = merging pages.
 * seq atoms are excluded (see stepOverSeq).
 */
export function deleteAdjacentAtom(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    if (!sel.empty) return false;
    const $p = sel.$from;
    const n = dir < 0 ? $p.nodeBefore : $p.nodeAfter;
    if (!n || n.isText || !n.isInline || n.type.name === 'seq') return false;
    const from = dir < 0 ? $p.pos - n.nodeSize : $p.pos;
    dispatch?.(state.tr.delete(from, from + n.nodeSize).scrollIntoView());
    return true;
  };
}
