/**
 * Helpers for span marks ({{ }} notes and the like) that work on any
 * ProseMirror Transform, so they are usable from lint, commands and tests.
 */
import type { Mark, MarkType, Node as PMNode } from 'prosemirror-model';
import type { Transform } from 'prosemirror-transform';
import { schema } from './schema';

export const NOTE_TYPES = ['note', 'margin'] as const;
const LAYOUT = new Set(['scanBreak', 'pageBoundary', 'pageStart', 'pageEnd']);

const markOf = (n: PMNode | null | undefined, type: MarkType | string) => n?.marks.find((m) => (typeof type === 'string' ? m.type.name === type : m.type === type));

export interface AdjacentSpans {
  type: string;
  /** document position where the first span ends and the second begins */
  pos: number;
  left: Mark;
  right: Mark;
}

/** Spans of the same kind that touch, e.g. `{{AB}}{{　}}`: cText lays them out as separate notes. */
export function adjacentSpans(doc: PMNode, types: readonly string[] = NOTE_TYPES): AdjacentSpans[] {
  const out: AdjacentSpans[] = [];
  doc.forEach((block, offset) => {
    let pos = offset + 1;
    for (let i = 0; i < block.childCount; i++) {
      const a = block.child(i);
      pos += a.nodeSize;
      const b = i + 1 < block.childCount ? block.child(i + 1) : null;
      if (!b) break;
      for (const t of types) {
        const l = markOf(a, t);
        const r = markOf(b, t);
        if (l && r && !l.eq(r)) out.push({ type: t, pos, left: l, right: r });
      }
    }
  });
  return out;
}

/** Ranges of inline content carrying exactly `mark`. */
function rangesOf(doc: PMNode, mark: Mark): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  doc.descendants((n, pos) => {
    if (!n.isInline) return true;
    if (mark.isInSet(n.marks)) {
      const last = out[out.length - 1];
      if (last && last.to === pos) last.to = pos + n.nodeSize;
      else out.push({ from: pos, to: pos + n.nodeSize });
    }
    return false;
  });
  return out;
}

/** Turn every range carrying `from` into `into` (joins two spans into one). */
export function replaceSpan(tr: Transform, from: Mark, into: Mark): Transform {
  for (const r of rangesOf(tr.doc, from)) tr.removeMark(r.from, r.to, from).addMark(r.from, r.to, into);
  return tr;
}

/** Join the span that starts at `pos` into the one that ends there. */
export function joinAdjacentAt(tr: Transform, pos: number, types: readonly string[] = NOTE_TYPES): boolean {
  const hit = adjacentSpans(tr.doc, types).find((a) => a.pos === pos);
  if (!hit) return false;
  replaceSpan(tr, hit.right, hit.left);
  return true;
}

/** Join all touching notes. Returns the number of joins. */
export function joinAllAdjacent(tr: Transform, types: readonly string[] = NOTE_TYPES): number {
  let n = 0;
  for (let guard = 0; guard < 10000; guard++) {
    const [hit] = adjacentSpans(tr.doc, types);
    if (!hit) break;
    replaceSpan(tr, hit.right, hit.left);
    n++;
  }
  return n;
}

/**
 * Add a span over [from, to). If a span of the same kind touches or overlaps
 * the range, it is extended instead of starting a new one, and spans that end
 * up touching are joined, so marking the space after `{{AB}}` gives
 * `{{AB　}}`, not `{{AB}}{{　}}`.
 */
export function addSpan(tr: Transform, type: MarkType, from: number, to: number, fresh: () => Mark): Transform {
  const doc = tr.doc;
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  let existing = markOf($from.nodeBefore, type) ?? markOf($to.nodeAfter, type);
  if (!existing) {
    doc.nodesBetween(from, to, (n) => {
      existing ??= markOf(n, type);
      return !existing;
    });
  }
  const mark = existing ?? fresh();
  tr.addMark(from, to, mark);
  // join neighbours of the same kind that now touch it
  for (let guard = 0; guard < 100; guard++) {
    const hit = adjacentSpans(tr.doc, [type.name]).find((a) => a.left.eq(mark) || a.right.eq(mark));
    if (!hit) break;
    replaceSpan(tr, hit.left.eq(mark) ? hit.right : hit.left, mark);
  }
  return tr;
}

/** Character cells a node takes in the original layout. */
function cellsOf(n: PMNode): number {
  if (n.isText) return [...n.text!].length;
  if (n.type.name === 'collation') return n.attrs.kind === 'add' ? 0 : [...String(n.attrs.orig)].length;
  if (n.type.name === 'missing') return 1;
  return 0;
}

export interface NotePart {
  mark: Mark;
  /** the part of the note in the column at `pos` (a note may continue across a column break) */
  from: number;
  to: number;
}

/** The note (or {{{ }}}) at `pos`, limited to the column that holds `pos`. */
export function notePartAt(doc: PMNode, pos: number): NotePart | null {
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.isTextblock) return null;
  const idx = $pos.index();
  const pick = (i: number) => (i >= 0 && i < parent.childCount ? NOTE_TYPES.map((t) => markOf(parent.child(i), t)).find(Boolean) : undefined);
  const ci = pick(idx) ? idx : $pos.textOffset === 0 && pick(idx - 1) ? idx - 1 : -1;
  if (ci < 0) return null;
  const mark = pick(ci)!;
  const inPart = (i: number) => i >= 0 && i < parent.childCount && mark.isInSet(parent.child(i).marks) && !LAYOUT.has(parent.child(i).type.name);
  let i = ci;
  let j = ci;
  while (inPart(i - 1)) i--;
  while (inPart(j + 1)) j++;
  if (!inPart(i)) return null; // cursor on a column break inside the note
  const base = $pos.start();
  let from = base;
  for (let k = 0; k < i; k++) from += parent.child(k).nodeSize;
  let to = from;
  for (let k = i; k <= j; k++) to += parent.child(k).nodeSize;
  return { mark, from, to };
}

/**
 * Pad a note so its text takes only the first of the two small lines:
 * n characters + (n − 1) full-width spaces, e.g. `{{ABCD}}` → `{{ABCD　　　}}`.
 * Existing trailing spaces are replaced. Returns false if nothing changes.
 */
export function padNoteToOneLine(tr: Transform, part: NotePart): boolean {
  const doc = tr.doc;
  // walk back over trailing spaces (they may span several text nodes)
  const nodes: { node: PMNode; pos: number }[] = [];
  doc.nodesBetween(part.from, part.to, (n, pos) => {
    if (n.isInline) nodes.push({ node: n, pos });
    return !n.isInline;
  });
  let spaceFrom = part.to;
  let spaceTo = part.to;
  let k = nodes.length - 1;
  while (k >= 0 && !nodes[k].node.isText && cellsOf(nodes[k].node) === 0) k--; // skip trailing anchors (seq)
  if (k < 0) return false;
  spaceTo = nodes[k].pos + nodes[k].node.nodeSize;
  spaceFrom = spaceTo;
  for (; k >= 0; k--) {
    const { node, pos } = nodes[k];
    if (!node.isText) break;
    const trail = /[ 　]*$/.exec(node.text!)![0].length;
    spaceFrom = pos + node.nodeSize - trail;
    if (trail < node.text!.length) break;
  }
  let cells = 0;
  doc.nodesBetween(part.from, spaceFrom, (n, pos) => {
    if (!n.isInline) return true;
    if (n.isText) cells += [...doc.textBetween(Math.max(pos, part.from), Math.min(pos + n.nodeSize, spaceFrom))].length;
    else cells += cellsOf(n);
    return false;
  });
  if (cells === 0) return false;
  const pad = '　'.repeat(cells - 1);
  if (doc.textBetween(spaceFrom, spaceTo) === pad) return false;
  const marks = doc.resolve(spaceFrom).marks().filter((m) => m.type !== schema.marks.note || m.eq(part.mark));
  const withNote = part.mark.isInSet(marks) ? marks : part.mark.addToSet(marks);
  if (pad) tr.replaceWith(spaceFrom, spaceTo, schema.text(pad, withNote));
  else tr.delete(spaceFrom, spaceTo);
  return true;
}
