/**
 * Plain-text projection of a document, with a map back to document positions.
 *
 * Layout markers (scanbreak, scanskip, page boundaries, seq) are transparent,
 * so a name split across a column break ("英吉利⏎") is still one string.
 * Block boundaries and non-layout atoms (|, collation, ●, other tags) become
 * a separator so matches never cross them.
 */
import type { Node as PMNode } from 'prosemirror-model';

export const SEP = '\u0000';
export const TRANSPARENT: ReadonlySet<string> = new Set(['scanBreak', 'scanSkip', 'pageStart', 'pageEnd', 'pageBoundary', 'seq']);

export interface Projection {
  text: string;
  /** pos[i] = document position of text[i] (−1 for separators) */
  pos: Int32Array;
}

/** `transparent`: inline atom types that do not interrupt the text (default: layout markers). */
export function project(doc: PMNode, transparent: ReadonlySet<string> = TRANSPARENT): Projection {
  let text = '';
  const pos: number[] = [];
  const sep = () => {
    if (text && text[text.length - 1] !== SEP) {
      text += SEP;
      pos.push(-1);
    }
  };
  doc.descendants((node, p) => {
    if (node.isBlock) {
      sep();
      return true;
    }
    if (node.isText) {
      text += node.text!;
      for (let i = 0; i < node.text!.length; i++) pos.push(p + i);
    } else if (!transparent.has(node.type.name)) sep();
    return false;
  });
  return { text, pos: Int32Array.from(pos) };
}

/** Document range covering projection range [start, end). */
export function docRange(pr: Projection, start: number, end: number): { from: number; to: number } {
  return { from: pr.pos[start], to: pr.pos[end - 1] + 1 };
}
