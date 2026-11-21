/**
 * Editing commands used by the toolbar, keymap and inspector.
 */
import type { MarkType, Node as PMNode } from 'prosemirror-model';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { freshIid } from '../core/ids';
import { MILESTONES, schema } from '../core/schema';
import type { Page } from '../core/pageIndex';
import { pageAt } from './pageCommands';

export type SpanMark = 'big' | 'note' | 'margin' | 'inverted' | 'circled';
const SPAN_MARKS: SpanMark[] = ['big', 'note', 'margin', 'inverted', 'circled'];

/** Remove all span formatting ({{ }}, { }, {{{ }}}, 【】, 〖〗) from the selection. Entities are kept. */
export const clearFormat: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection;
  if (empty) return false;
  const tr = state.tr;
  for (const m of SPAN_MARKS) tr.removeMark(from, to, schema.marks[m]);
  if (!tr.docChanged) return false;
  dispatch?.(tr);
  return true;
};

const isMilestone = (n: PMNode) => !n.isText && MILESTONES.has(n.type.name);
/** Number of leading layout markers in a block (they stay before the '*' of a heading). */
function leadingMilestones(block: PMNode): number {
  let i = 0;
  while (i < block.childCount && isMilestone(block.child(i))) i++;
  return i;
}
/** True if the block content in [from, to) (positions inside it) has only layout markers. */
function onlyMilestones(doc: PMNode, from: number, to: number): boolean {
  let ok = true;
  doc.nodesBetween(from, to, (n) => {
    if (n.isInline && !isMilestone(n)) ok = false;
    return !n.isInline;
  });
  return ok;
}

/** Current block level at the cursor: 0 = paragraph, 1 = '*', 2 = '**'. */
export function blockLevel(state: EditorState): number {
  const p = state.selection.$from.parent;
  return p.type.name === 'heading' ? p.attrs.level : 0;
}

/**
 * Make the selected blocks headings (`*` × level) or paragraphs (level 0).
 * A selection inside one paragraph is first split off into its own block,
 * unless only layout markers (page / column breaks) are left beside it.
 */
export function setBlockLevel(level: number): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    const { $from, $to, empty } = state.selection;
    if (!empty && level > 0 && $from.sameParent($to) && $from.parent.isTextblock) {
      if (!onlyMilestones(state.doc, $to.pos, $to.end())) tr.split($to.pos);
      if (!onlyMilestones(state.doc, $from.start(), $from.pos)) tr.split($from.pos);
    }
    const from = tr.mapping.map(state.selection.from, 1);
    const to = Math.max(from, tr.mapping.map(state.selection.to, -1));
    tr.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true;
      if (level === 0) {
        if (node.type.name !== 'paragraph') tr.setNodeMarkup(pos, schema.nodes.paragraph);
      } else if (node.type.name !== 'heading' || node.attrs.level !== level) {
        tr.setNodeMarkup(pos, schema.nodes.heading, { level, prefix: leadingMilestones(node) });
      }
      return false;
    });
    if (!tr.docChanged) return false;
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

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

/** Set the leading blank cells (y) of column `line` of a page: the y of its scanbreak, or of the page marker for the first column. */
export function setLineY(page: Page, line: number, y: number): Command {
  return (state, dispatch) => {
    const pos = line === 0 ? page.markerPos : page.lines[line]?.breakPos;
    if (pos == null || y < 0) return false;
    const tr = setNodeAttrs(state.tr, pos, { y: y > 0 ? String(y) : null });
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
