import type { Command } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../core/schema';

/** The page (file, page) that contains document position `pos`. */
export function pageAt(doc: PMNode, pos: number): { file: string; page: string } | null {
  let cur: { file: string; page: string } | null = null;
  doc.nodesBetween(0, pos, (node) => {
    if (node.type.name === 'pageStart') cur = { file: node.attrs.file, page: node.attrs.page };
    else if (node.type.name === 'pageBoundary') cur = { file: node.attrs.beginFile, page: node.attrs.beginPage };
    return true;
  });
  return cur;
}

/**
 * Split the page at `pos` (default: start of the selection): insert
 * <scanend/><scanbegin/> with page+1. Never deletes selected text.
 * (Renumbering the following pages is a separate, explicit operation.)
 */
export function splitPageAt(pos?: number): Command {
  return (state, dispatch) => {
    const from = pos ?? state.selection.from;
    const cur = pageAt(state.doc, from);
    if (!cur) return false;
    const next = /^\d+$/.test(cur.page) ? String(Number(cur.page) + 1) : cur.page;
    const node = schema.nodes.pageBoundary.create({
      endFile: cur.file,
      endPage: cur.page,
      beginFile: cur.file,
      beginPage: next,
    });
    dispatch?.(state.tr.insert(from, node).scrollIntoView());
    return true;
  };
}

export const splitPage: Command = splitPageAt();
