/**
 * What changed between the originally pasted text and the current text:
 * a character diff (for review before pasting back to cText) and a summary of
 * structural changes (seq anchors, pages, column breaks) that cText's edit
 * guide asks editors to explain in the edit summary.
 */
import { diffChars } from 'diff';
import type { Node as PMNode } from 'prosemirror-model';
import { buildPageIndex } from './pageIndex';
import { toDoc } from './toDoc';

export interface Hunk {
  /** offset in the original text */
  at: number;
  before: string;
  removed: string;
  added: string;
  after: string;
}

export function textHunks(a: string, b: string, context = 30): Hunk[] {
  const parts = diffChars(a, b);
  const hunks: Hunk[] = [];
  let posA = 0;
  let i = 0;
  while (i < parts.length) {
    const p = parts[i];
    if (!p.added && !p.removed) {
      posA += p.value.length;
      i++;
      continue;
    }
    let removed = '';
    let added = '';
    const at = posA;
    // merge consecutive changes separated by short unchanged runs
    while (i < parts.length) {
      const q = parts[i];
      if (q.removed) {
        removed += q.value;
        posA += q.value.length;
      } else if (q.added) added += q.value;
      else if (q.value.length <= 8 && i + 1 < parts.length && (parts[i + 1].added || parts[i + 1].removed)) {
        removed += q.value;
        added += q.value;
        posA += q.value.length;
      } else break;
      i++;
    }
    hunks.push({ at, before: a.slice(Math.max(0, at - context), at), removed, added, after: a.slice(posA, posA + context) });
  }
  return hunks;
}

export interface StructuralChanges {
  seqMoved: string[];
  pagesAdded: string[];
  pagesRemoved: string[];
  pagesRenumbered: number;
  /** pages whose column breaks changed: key → [before, after] break counts */
  breaksChanged: { key: string; before: number; after: number }[];
}

/** Plain-text offset of each seq anchor (text only, tags excluded). */
function seqOffsets(doc: PMNode): Map<string, number> {
  const out = new Map<string, number>();
  let off = 0;
  doc.descendants((n) => {
    if (n.isText) off += n.text!.length;
    else if (n.type.name === 'seq') out.set(n.attrs.sid, off);
    return true;
  });
  return out;
}

export function structuralChanges(original: string, current: PMNode): StructuralChanges {
  const before = toDoc(original);
  const sa = seqOffsets(before);
  const sb = seqOffsets(current);
  const seqMoved = [...sa].filter(([sid, off]) => sb.get(sid) !== off).map(([sid]) => sid);

  const pa = buildPageIndex(before).filter((p) => p.markerPos !== null);
  const pb = buildPageIndex(current).filter((p) => p.markerPos !== null);
  const ka = new Set(pa.map((p) => p.key));
  const kb = new Set(pb.map((p) => p.key));
  const pagesAdded = pb.filter((p) => !ka.has(p.key)).map((p) => `p.${p.page}`);
  const pagesRemoved = pa.filter((p) => !kb.has(p.key)).map((p) => `p.${p.page}`);
  let pagesRenumbered = 0;
  if (pa.length === pb.length) pa.forEach((p, i) => p.key !== pb[i].key && pagesRenumbered++);

  const breaksA = new Map(pa.map((p) => [p.key, p.lines.length - 1]));
  const breaksChanged = pb
    .filter((p) => breaksA.has(p.key) && breaksA.get(p.key) !== p.lines.length - 1)
    .map((p) => ({ key: p.key, before: breaksA.get(p.key)!, after: p.lines.length - 1 }));

  return { seqMoved, pagesAdded, pagesRemoved, pagesRenumbered, breaksChanged };
}
