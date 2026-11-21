/**
 * Editing commands used by the toolbar, keymap and inspector.
 */
import type { MarkType, Node as PMNode } from 'prosemirror-model';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { freshIid } from '../core/ids';
import { schema } from '../core/schema';
import type { Page } from '../core/pageIndex';
import { pageAt } from './pageCommands';

export type SpanMark = 'big' | 'note' | 'margin' | 'inverted' | 'circled';

function rangeHasMark(state: EditorState, type: MarkType): boolean {
  const { from, to } = state.selection;
  let has = false;
  state.doc.nodesBetween(from, to, (n) => {
    if (n.isInline && type.isInSet(n.marks)) has = true;
  });
  return has;
}

/** Wrap the selection in a span ({{ }}, { }, …) or remove that span type from it. */
export function toggleSpanMark(name: SpanMark): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (empty) return false;
    const type = schema.marks[name];
    const tr = rangeHasMark(state, type) ? state.tr.removeMark(from, to, type) : state.tr.addMark(from, to, type.create({ iid: freshIid() }));
    dispatch?.(tr);
    return true;
  };
}

export interface EntityAttrs {
  entityid: string;
  type: string;
  extra?: Record<string, string>;
}

export function applyEntity(attrs: EntityAttrs): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (empty) return false;
    const mark = schema.marks.entity.create({ iid: freshIid(), raw: null, entityid: attrs.entityid, type: attrs.type, extra: attrs.extra ?? {} });
    dispatch?.(state.tr.addMark(from, to, mark));
    return true;
  };
}

/** Innermost entity mark at the cursor, and the extent of that span within its block. */
export function entityAt(state: EditorState): { mark: ReturnType<MarkType['create']>; from: number; to: number } | null {
  const $pos = state.selection.$from;
  const parent = $pos.parent;
  const offsets: number[] = [];
  let off = 0;
  for (let i = 0; i < parent.childCount; i++) {
    offsets.push(off);
    off += parent.child(i).nodeSize;
  }
  const entityOf = (i: number) => (i >= 0 && i < parent.childCount ? [...parent.child(i).marks].reverse().find((m) => m.type.name === 'entity') : undefined);
  const idx = $pos.index();
  // the node before counts only when the cursor sits exactly on a node boundary
  const ci = entityOf(idx) ? idx : $pos.textOffset === 0 && entityOf(idx - 1) ? idx - 1 : -1;
  if (ci < 0) return null;
  const mark = entityOf(ci)!;
  let i = ci;
  let j = ci;
  while (i > 0 && mark.isInSet(parent.child(i - 1).marks)) i--;
  while (j < parent.childCount - 1 && mark.isInSet(parent.child(j + 1).marks)) j++;
  const base = $pos.start();
  return { mark, from: base + offsets[i], to: base + offsets[j] + parent.child(j).nodeSize };
}

export function updateEntity(attrs: EntityAttrs): Command {
  return (state, dispatch) => {
    const e = entityAt(state);
    if (!e) return false;
    const next = schema.marks.entity.create({ ...e.mark.attrs, raw: null, entityid: attrs.entityid, type: attrs.type, extra: attrs.extra ?? e.mark.attrs.extra });
    dispatch?.(state.tr.removeMark(e.from, e.to, e.mark).addMark(e.from, e.to, next));
    return true;
  };
}

export const removeEntity: Command = (state, dispatch) => {
  const e = entityAt(state);
  if (!e) return false;
  dispatch?.(state.tr.removeMark(e.from, e.to, e.mark));
  return true;
};

/**
 * Change attrs of the atom at `pos`. Only the raw source of the parts that
 * actually changed is dropped, so untouched tags stay byte-identical.
 */
export function setNodeAttrs(tr: Transaction, pos: number, patch: Record<string, unknown>): Transaction {
  const node = tr.doc.nodeAt(pos);
  if (!node) return tr;
  const changed = Object.keys(patch).filter((k) => node.attrs[k] !== patch[k]);
  if (!changed.length) return tr;
  const attrs: Record<string, unknown> = { ...node.attrs, ...patch };
  if (node.type.name === 'pageBoundary') {
    if (changed.some((k) => k === 'endFile' || k === 'endPage')) attrs.rawEnd = null;
    if (changed.some((k) => k === 'beginFile' || k === 'beginPage' || k === 'y')) attrs.rawBegin = null;
  } else if ('raw' in node.attrs) attrs.raw = null;
  return tr.setNodeMarkup(pos, null, attrs);
}

function fileHere(state: EditorState, pos = state.selection.from): string {
  return pageAt(state.doc, pos)?.file ?? '';
}

/** Insert <scanbreak/> (end of an original column) at `pos` (default: the cursor). */
export function insertScanBreakAt(pos?: number): Command {
  return (state, dispatch) => {
    const at = pos ?? state.selection.from;
    const node = schema.nodes.scanBreak.create({ file: fileHere(state, at) });
    dispatch?.(state.tr.insert(at, node).scrollIntoView());
    return true;
  };
}
export const insertScanBreak: Command = insertScanBreakAt();

export function insertScanSkip(n: number): Command {
  return (state, dispatch) => {
    const node = schema.nodes.scanSkip.create({ file: fileHere(state), y: String(n) });
    dispatch?.(state.tr.insert(state.selection.from, node).scrollIntoView());
    return true;
  };
}

/**
 * Shift the page numbers of page `fromIdx` and all following pages of the same
 * file id by `delta` (gaps are preserved). The matching <scanend/> numbers are
 * corrected by pageGuard's consistency pass.
 */
export function shiftPageNumbers(pages: Page[], fromIdx: number, delta: number): Command {
  return (state, dispatch) => {
    const start = pages[fromIdx];
    if (!start || start.markerPos === null || delta === 0) return false;
    const tr = state.tr;
    for (const p of pages.slice(fromIdx)) {
      if (p.markerPos === null || p.file !== start.file) continue;
      const n = Number(p.page);
      if (!Number.isInteger(n)) continue;
      const key = p.markerType === 'pageStart' ? 'page' : 'beginPage';
      setNodeAttrs(tr, p.markerPos, { [key]: String(n + delta) });
    }
    if (!tr.docChanged) return false;
    dispatch?.(tr);
    return true;
  };
}

/** Delete the marker that starts page `idx` (merging it into the previous page). */
export function mergeWithPrevious(pages: Page[], idx: number): Command {
  return (state, dispatch) => {
    const p = pages[idx];
    if (!p || p.markerType !== 'pageBoundary' || p.markerPos === null) return false;
    dispatch?.(state.tr.delete(p.markerPos, p.markerPos + 1));
    return true;
  };
}

export function isAtom(n: PMNode | null | undefined): n is PMNode {
  return !!n && n.isInline && !n.isText;
}
