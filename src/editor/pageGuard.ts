/**
 * Page-structure rules for the editor.
 *
 * 1. Dragging a page marker (pageStart / pageBoundary / pageEnd) must not
 *    change the order of pages: a drop that moves one past another is rejected.
 * 2. Consistency: each <scanend/> (pageBoundary.end*, pageEnd) must name the
 *    page it closes. After any edit (split, merge, renumber, drag) mismatches
 *    are corrected automatically. Untouched consistent markers keep their raw.
 * 3. A scanbreak/scanskip dropped into another page takes that page's file id.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection, Plugin, type Transaction } from 'prosemirror-state';

const PAGE_MARKERS = new Set(['pageStart', 'pageBoundary', 'pageEnd']);

/** Sequence of page markers (type + the page each one starts or ends). */
export function pageMarkerSeq(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((n) => {
    if (n.isBlock) return true;
    if (PAGE_MARKERS.has(n.type.name)) {
      const a = n.attrs;
      out.push(n.type.name === 'pageBoundary' ? `B:${a.beginFile}:${a.beginPage}` : n.type.name === 'pageStart' ? `S:${a.file}:${a.page}` : 'E');
    }
    return false;
  });
  return out;
}

/** Set end attrs to the page actually being closed; returns null if nothing to fix. */
export function fixPageEnds(doc: PMNode, tr: Transaction): boolean {
  let changed = false;
  let cur: { file: string; page: string } | null = null;
  doc.descendants((n, pos) => {
    if (n.isBlock) return true;
    const a = n.attrs;
    switch (n.type.name) {
      case 'pageStart':
        cur = { file: a.file, page: a.page };
        break;
      case 'pageBoundary':
        if (cur && (a.endFile !== cur.file || a.endPage !== cur.page)) {
          tr.setNodeMarkup(pos, null, { ...a, endFile: cur.file, endPage: cur.page, rawEnd: null });
          changed = true;
        }
        cur = { file: a.beginFile, page: a.beginPage };
        break;
      case 'pageEnd':
        if (cur && (a.file !== cur.file || a.page !== cur.page)) {
          tr.setNodeMarkup(pos, null, { ...a, file: cur.file, page: cur.page, raw: null });
          changed = true;
        }
        cur = null;
        break;
    }
    return false;
  });
  return changed;
}

function fileAt(doc: PMNode, pos: number): string | null {
  let file: string | null = null;
  doc.nodesBetween(0, pos, (n) => {
    if (n.type.name === 'pageStart') file = n.attrs.file;
    else if (n.type.name === 'pageBoundary') file = n.attrs.beginFile;
    return true;
  });
  return file;
}

export function pageGuard(): Plugin {
  return new Plugin({
    filterTransaction(tr, state) {
      if (!tr.docChanged || tr.getMeta('uiEvent') !== 'drop') return true;
      const a = pageMarkerSeq(state.doc);
      const b = pageMarkerSeq(tr.doc);
      return a.length === b.length && a.every((x, i) => x === b[i]);
    },
    appendTransaction(trs, _old, state) {
      if (!trs.some((t) => t.docChanged)) return null;
      const tr = state.tr;
      let changed = fixPageEnds(state.doc, tr);
      if (trs.some((t) => t.getMeta('uiEvent') === 'drop') && state.selection instanceof NodeSelection) {
        const n = state.selection.node;
        if (n.type.name === 'scanBreak' || n.type.name === 'scanSkip') {
          const file = fileAt(state.doc, state.selection.from);
          if (file !== null && file !== n.attrs.file) {
            tr.setNodeMarkup(state.selection.from, null, { ...n.attrs, file, raw: null });
            changed = true;
          }
        }
      }
      return changed ? tr : null;
    },
  });
}
